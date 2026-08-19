# 03_scenario.py — 검증셋(30%)을 야간 시계열로 재구성
# 원본은 로트 단위 독립 스냅샷이다. 블레이드 마모는 단조 누적되는 유일한 시간성 변수이므로
# 마모를 시간축으로 삼아 정렬 배치하고, 나머지 센서값은 해당 행의 실측값을 그대로 쓴다(평활화 없음).
import pandas as pd, numpy as np, json, os
from sklearn.model_selection import train_test_split

df = pd.read_csv('data/ai4i2020.csv')
df['dT']    = df['Process temperature'] - df['Air temperature']
df['Power'] = df['Torque'] * df['Rotational speed'] * 2*np.pi/60
df['OS']    = df['Tool wear'] * df['Torque']
_, te = train_test_split(df, test_size=0.30, random_state=42, stratify=df['Machine failure'])

DAYS, PTS, STEP = 7, 100, 6           # 7일 / 대당 100포인트 / 6분 간격 = 600분(22:00~08:00)
WEAR_RATE = 40                        # 야간 600분 동안 진행되는 마모량 [min] (가정치)
EQPS = [('DCS-01','L'), ('DCS-02','L'), ('DCS-03','M')]

# 날짜별 각 설비의 야간 시작 마모값 — 설비 운용 상황이므로 설정 가능한 값
WEAR0 = {
 1: {'DCS-01': 40, 'DCS-02': 62, 'DCS-03': 55},
 2: {'DCS-01':170, 'DCS-02': 48, 'DCS-03':158},
 3: {'DCS-01': 82, 'DCS-02': 95, 'DCS-03': 70},
 4: {'DCS-01':120, 'DCS-02':132, 'DCS-03':145},
 5: {'DCS-01':166, 'DCS-02': 98, 'DCS-03':175},
 6: {'DCS-01': 18, 'DCS-02': 35, 'DCS-03': 25},
 7: {'DCS-01':100, 'DCS-02':112, 'DCS-03': 92},
}

rng = np.random.default_rng(42)
pool = {t: te[te['Type']==t].sort_values('Tool wear').reset_index(drop=True) for t in 'LM'}
os.makedirs('data/scenarios', exist_ok=True)

def pick(t, targets):
    """등급 t 풀에서 목표 마모값 각각에 가장 가까운 행을 비복원 추출(같은 날 안에서만)"""
    p = pool[t]; used=set(); out=[]
    for w in targets:
        d = (p["Tool wear"] - w).abs().to_numpy().copy()
        d[list(used)] = np.inf
        i = int(d.argmin()); used.add(i); out.append(p.iloc[i])
    return pd.DataFrame(out).reset_index(drop=True)

summary=[]
for day in range(1, DAYS+1):
    eq_out=[]
    for eid, t in EQPS:
        w0 = WEAR0[day][eid]
        targets = np.linspace(w0, w0+WEAR_RATE, PTS)          # 마모 선형 누적
        s = pick(t, targets)
        s['wear_t'] = targets                                  # 시간축으로 쓴 마모 목표값
        eq_out.append((eid, t, s))
    # 이 날짜에 실제로 걸린 조건 집계
    cnt={'HDF':0,'PWF':0,'OSF':0,'TWF_warn':0,'TWF_crit':0,'RNF':0}
    for eid,t,s in eq_out:
        lim = {'L':11000,'M':12000}[t]
        cnt['HDF'] += int(((s['dT']<8.6)&(s['Rotational speed']<1380)).sum())
        cnt['PWF'] += int(((s['Power']<3500)|(s['Power']>9000)).sum())
        cnt['OSF'] += int(((s['wear_t']*s['Torque'])>lim).sum())
        cnt['TWF_warn'] += int(((s['wear_t']>=180)&(s['wear_t']<200)).sum())
        cnt['TWF_crit'] += int((s['wear_t']>=200).sum())
        cnt['RNF'] += int(s['RNF'].sum())
    summary.append((day,cnt))
    print(f'day{day}  ' + '  '.join(f'{k}:{v:3d}' for k,v in cnt.items()))

print('\n합계  ' + '  '.join(f'{k}:{sum(c[k] for _,c in summary):4d}' for k in summary[0][1]))
