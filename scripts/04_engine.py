# 04_engine.py — 판정 엔진
# 파이프라인: 조건별 독립 채널 판정 -> 채터링 억제/디바운스 -> 센서 헬스 게이트 -> 상관 그룹핑 -> 조치 분기
# 판정은 전부 결정론적 룰이다. LLM은 서술 생성에만 관여하며 판정에 개입하지 않는다.
import pandas as pd, numpy as np, json, os
from sklearn.model_selection import train_test_split
from datetime import datetime, timedelta

df = pd.read_csv('data/ai4i2020.csv')
df['dT']    = df['Process temperature'] - df['Air temperature']
df['Power'] = df['Torque'] * df['Rotational speed'] * 2*np.pi/60
_, te = train_test_split(df, test_size=0.30, random_state=42, stratify=df['Machine failure'])

DAYS, PTS, STEP, WEAR_RATE, GAP = 7, 100, 6, 40, 3
EQPS  = [('DCS-01','L'), ('DCS-02','L'), ('DCS-03','M')]
OSLIM = {'L':11000, 'M':12000}
WEAR0 = {1:{'DCS-01':40,'DCS-02':62,'DCS-03':55},   2:{'DCS-01':170,'DCS-02':48,'DCS-03':158},
         3:{'DCS-01':82,'DCS-02':95,'DCS-03':70},   4:{'DCS-01':120,'DCS-02':132,'DCS-03':145},
         5:{'DCS-01':166,'DCS-02':98,'DCS-03':175}, 6:{'DCS-01':18,'DCS-02':35,'DCS-03':25},
         7:{'DCS-01':100,'DCS-02':112,'DCS-03':92}}
INJECT = {(3,'DCS-02'): ('stuck','proc', 42, 68),      # 공정온도 고착 (가정치)
          (7,'DCS-01'): ('drift','air',  30, 99)}      # 공기온도 편류 (가정치)

RULES = {
 'TWF_CRIT': dict(ko='블레이드 마모 한계', grade='CRIT', auto=False, act='설비 정지 후 블레이드 교체', why='마모 200min 이상 — 교체는 비가역 조치라 자동 실행 불가'),
 'TWF_WARN': dict(ko='블레이드 수명 임박', grade='MAJ',  auto=True,  act='주간 교체 작업 예약 등록',   why='마모 180min 도달 — 예약 등록은 설비에 영향 없음'),
 'PWF_HIGH': dict(ko='스핀들 과전력',      grade='CRIT', auto=False, act='안전 정지 후 점검',          why='9000W 초과 — 자동 조작 시 설비 손상 위험'),
 'PWF_LOW':  dict(ko='스핀들 저전력',      grade='MIN',  auto=True,  act='절삭 부하 재분배',           why='3500W 미만 — 파라미터 원복 가능'),
 'HDF':      dict(ko='절삭부 방열 불량',   grade='MIN',  auto=True,  act='냉각수 유량 증대',           why='방열 여유 8.6K 미만 — 파라미터 원복 가능'),
 'OSF':      dict(ko='스핀들 과부하',      grade='MAJ',  auto=True,  act='이송 속도 하향',             why='마모x토크 임계 초과 — 파라미터 원복 가능'),
 'SNSR':     dict(ko='센서 이상 의심',     grade='SNSR', auto=False, act='자동조치 차단, 센서 점검 요청', why='센서값 신뢰 불가 — 오조치 방지를 위해 차단'),
}
# 알람 코드가 의존하는 센서 채널 — 해당 채널이 고장나면 그 알람은 신뢰할 수 없다
DEPS = {'HDF':{'air','proc','rpm'}, 'PWF_HIGH':{'torque','rpm'}, 'PWF_LOW':{'torque','rpm'},
        'OSF':{'torque'}, 'TWF_CRIT':set(), 'TWF_WARN':set()}
PRI = {'SNSR':0, 'TWF_CRIT':1, 'PWF_HIGH':2, 'TWF_WARN':3, 'OSF':4, 'HDF':5, 'PWF_LOW':6}

pool = {t: te[te['Type']==t].sort_values('Tool wear').reset_index(drop=True) for t in 'LM'}
def pick(t, targets):
    p = pool[t]; used=set(); out=[]
    for w in targets:
        d = (p['Tool wear'] - w).abs().to_numpy().copy(); d[list(used)] = np.inf
        i = int(d.argmin()); used.add(i); out.append(p.iloc[i])
    return pd.DataFrame(out).reset_index(drop=True)

def spans(mask, gap=GAP):
    """불리언 마스크 -> 구간 리스트. gap 이내 단절은 같은 구간으로 병합(디바운스)"""
    out=[]; i=0; n=len(mask)
    while i < n:
        if not mask[i]: i+=1; continue
        j=i
        while j+1 < n and mask[j+1]: j+=1
        if out and i - out[-1][1] <= gap: out[-1] = (out[-1][0], j, out[-1][2]+j-i+1)
        else:                             out.append((i, j, j-i+1))
        i=j+1
    return out

os.makedirs('data/scenarios', exist_ok=True)
BASE = datetime(2026, 8, 12, 22, 0)
stat_all=[]

for day in range(1, DAYS+1):
    d0 = BASE + timedelta(days=day-1)
    eqs, alarms, actions = [], [], []
    raw_count = 0

    # --- 1패스: 3대 시계열을 먼저 생성한다 (설비 간 교차검증에 필요) ---
    raw = {}
    for eid, t in EQPS:
        wear = np.linspace(WEAR0[day][eid], WEAR0[day][eid]+WEAR_RATE, PTS)
        s_ = pick(t, wear)
        air  = s_['Air temperature'].to_numpy().copy();  proc = s_['Process temperature'].to_numpy().copy()
        rpm  = s_['Rotational speed'].to_numpy().copy(); trq  = s_['Torque'].to_numpy().copy()
        inj = INJECT.get((day, eid))
        if inj:
            kind, chn, a, b = inj
            if kind=='stuck': proc[a:b] = proc[a]
            else:             air[a:b] += np.linspace(0, 15.0, b-a)
        raw[eid] = dict(t=t, wear=wear, air=air, proc=proc, rpm=rpm, trq=trq, rnf=s_['RNF'].to_numpy())

    # --- 설비 간 교차검증: 같은 팹 환경이므로 3대의 온도는 서로 가까워야 한다.
    #     중앙값에서 3시그마(공기온도 표준편차 2K 기준 6K) 이상 벗어난 센서를 이상으로 본다. ---
    XSIG = 3 * 2.0
    cross = {eid: {} for eid,_ in EQPS}
    for chn in ('air','proc'):
        M = np.vstack([raw[eid][chn] for eid,_ in EQPS])
        med = np.median(M, axis=0)
        for k,(eid,_) in enumerate(EQPS): cross[eid][chn] = np.abs(M[k]-med) > XSIG

    for eid, t in EQPS:
        R = raw[eid]
        wear, air, proc, rpm, trq = R['wear'], R['air'], R['proc'], R['rpm'], R['trq']
        s = pd.DataFrame({'RNF': R['rnf']})
        power = trq * rpm * 2*np.pi/60;  dT = proc - air;  os_ix = wear * trq

        # --- 센서 헬스 판정: 고착 / 열역학 위배 / 설비 간 편차 / 원인불명 라벨 ---
        stuck = np.zeros(PTS, bool)
        for i in range(5, PTS):
            if np.ptp(proc[i-5:i+1])==0 or np.ptp(air[i-5:i+1])==0: stuck[i]=True
        viol = air > proc                                    # 열역학적 불가 (공기온도 > 공정온도)
        xair, xproc = cross[eid]['air'], cross[eid]['proc']
        sensor_bad = stuck | viol | xair | xproc | (s['RNF'].to_numpy()==1)

        # 어느 채널이 고장났는지 기록 -> 그 채널에 의존하는 알람은 하루 전체를 신뢰 불가로 본다
        bad_ch = set()
        if (xair | (viol & ~stuck)).sum()  >= 3: bad_ch.add('air')
        if (xproc | stuck).sum()           >= 3: bad_ch.add('proc')

        # --- 조건별 독립 채널 판정 (배타 아님) ---
        ch = {'TWF_CRIT': wear>=200,
              'TWF_WARN': (wear>=180)&(wear<200),
              'PWF_HIGH': power>9000,
              'PWF_LOW' : power<3500,
              'OSF'     : os_ix>OSLIM[t],
              'HDF'     : (dT<8.6)&(rpm<1380),
              'SNSR'    : sensor_bad}
        raw_count += int(sum(m.sum() for m in ch.values()))

        ev=[]
        for code, m in ch.items():
            for si, ei, rep in spans(m): ev.append(dict(code=code, s=si, e=ei, rep=rep))
        ev.sort(key=lambda x: (x['s'], PRI[x['code']]))

        # --- 상관 그룹핑: 시간이 겹치는 알람을 근본원인 1건으로 (OS = 마모x토크 이므로 종속 관계) ---
        groups=[]
        for e in ev:
            hit=None
            for g in groups:
                if not (e['e'] < g['s'] or e['s'] > g['e']) and (e['code']=='SNSR')==(g['root']['code']=='SNSR'):
                    hit=g; break
            if hit is None: groups.append(dict(s=e['s'], e=e['e'], root=e, sub=[]))
            else:
                hit['s'], hit['e'] = min(hit['s'],e['s']), max(hit['e'],e['e'])
                if PRI[e['code']] < PRI[hit['root']['code']]: hit['sub'].append(hit['root']); hit['root']=e
                else:                                        hit['sub'].append(e)

        snsr_spans = [(g['s'], g['e']) for g in groups if g['root']['code']=='SNSR']
        for g in groups:
            code = g['root']['code']; r = RULES[code]; si, ei = g['s'], g['e']
            # --- 센서 헬스 게이트: 센서 이상 구간과 겹치는 공정 알람은 자동조치를 차단한다 ---
            overlap = any(not (ei<a or si>b) for a,b in snsr_spans)
            dep_bad = bool(DEPS.get(code, set()) & bad_ch)      # 의존 채널이 고장난 경우
            blocked = code!='SNSR' and (overlap or dep_bad)
            aid = f'A{day}-{eid[-2:]}-{len(alarms)+1:02d}'
            ts  = d0 + timedelta(minutes=si*STEP)
            val = {'TWF_CRIT':f'{wear[si]:.0f}min','TWF_WARN':f'{wear[si]:.0f}min','PWF_HIGH':f'{power[si]:.0f}W',
                   'PWF_LOW':f'{power[si]:.0f}W','HDF':f'{dT[si]:.1f}K','OSF':f'{os_ix[si]:.0f}minNm','SNSR':'-'}[code]
            alarms.append(dict(id=aid, time=ts.strftime('%H:%M'), end=(d0+timedelta(minutes=ei*STEP)).strftime('%H:%M'),
                               eqp=eid, code=code, ko=r['ko'], grade='SNSR' if blocked else r['grade'],
                               value=val, repeat=g['root']['rep'], blocked=blocked,
                               sub=[dict(code=x['code'], ko=RULES[x['code']]['ko'], repeat=x['rep']) for x in g['sub']]))
            auto = r['auto'] and not blocked
            actions.append(dict(alarm_id=aid, time=(ts+timedelta(minutes=STEP)).strftime('%H:%M'), eqp=eid,
                                act='자동조치 차단 — 센서 점검 후 재판정' if blocked else r['act'],
                                auto=auto, grade='SNSR' if blocked else r['grade'],
                                why=('의존 센서(' + ','.join(sorted(DEPS.get(code,set()) & bad_ch)) + ') 고장 — 측정값 신뢰 불가'
                                     if blocked and dep_bad else
                                     '동시간대 센서 이상 감지 — 측정값 신뢰 불가로 자동조치를 막음' if blocked else r['why']),
                                result='조건 해제 확인' if ei < PTS-1 else '야간 종료 시점 지속'))

        eqs.append(dict(id=eid, type=t, series=dict(
            t=[(d0+timedelta(minutes=k*STEP)).strftime('%H:%M') for k in range(PTS)],
            air=air.round(1).tolist(), proc=proc.round(1).tolist(), rpm=rpm.round(0).tolist(),
            torque=trq.round(1).tolist(), power=power.round(0).tolist(), wear=wear.round(1).tolist())))

    auto = sum(1 for a in actions if a['auto'])
    blk  = sum(1 for a in alarms  if a['blocked'])
    man  = len(actions)-auto
    stat_all.append((day, raw_count, len(alarms), auto, man, blk))
    json.dump(dict(day=day, date=d0.strftime('%Y-%m-%d'), equipments=eqs, alarms=alarms, actions=actions,
                   stats=dict(raw=raw_count, grouped=len(alarms), auto=auto, manual=man, blocked=blk)),
              open(f'data/scenarios/day-{day}.json','w'), ensure_ascii=False)

print(f'{"":5s}{"원시":>7s}{"집약":>6s}{"자동조치":>9s}{"사람필요":>9s}{"센서차단":>9s}   압축률')
for d,r,g,a,m,b in stat_all:
    print(f'day{d}{r:7d}{g:6d}{a:9d}{m:9d}{b:9d}   {(1-g/max(r,1))*100:5.1f}%')
T=[sum(x[i] for x in stat_all) for i in range(1,6)]
print(f'합계 {T[0]:6d}{T[1]:6d}{T[2]:9d}{T[3]:9d}{T[4]:9d}   {(1-T[1]/T[0])*100:5.1f}%')
