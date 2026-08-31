# 07_figures.py — 대시보드용 그림 생성. 모든 수치는 앞선 스크립트의 실제 산출값이다.
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt, numpy as np, pandas as pd, json, glob
from matplotlib import rcParams
from sklearn.model_selection import train_test_split

rcParams['font.family'] = 'Apple SD Gothic Neo'
rcParams['axes.unicode_minus'] = False
BG, FG, MUT, GRID = '#12151a', '#e6e9ef', '#8b94a3', '#242a33'
OK, WARN, BAD, INFO = '#51cf66', '#ff9f40', '#ff5252', '#4dabf7'

def style(ax):
    ax.set_facecolor(BG)
    for s in ax.spines.values(): s.set_color(GRID)
    ax.tick_params(colors=MUT, labelsize=9)
    ax.grid(True, color=GRID, lw=.7, alpha=.6); ax.set_axisbelow(True)
    ax.xaxis.label.set_color(MUT); ax.yaxis.label.set_color(MUT)
    ax.title.set_color(FG)

def save(fig, name):
    fig.patch.set_facecolor(BG)
    fig.savefig(f'docs/img/{name}.png', dpi=170, bbox_inches='tight', facecolor=BG)
    plt.close(fig); print(f'  docs/img/{name}.png')

# ── 1. 알람이 어떻게 줄어드는가 (7일 합계) ─────────────────────
days = [json.load(open(f)) for f in sorted(glob.glob('data/scenarios/day-*.json'),
                                           key=lambda x:int(x.split('-')[-1][:-5]))]
raw   = sum(d['stats']['raw'] for d in days)
grp   = sum(d['stats']['grouped'] for d in days)
auto  = sum(d['stats']['auto'] for d in days)
man   = sum(d['stats']['manual'] for d in days)
blk   = sum(d['stats']['blocked'] for d in days)

fig, ax = plt.subplots(figsize=(8.6, 3.1))
stages = [('원시 알람', '임계를 넘은 시점 전체', raw, '#3a4250'),
          ('근본 원인', '중복·연쇄를 묶은 뒤',   grp, INFO),
          ('자동 처리', '되돌릴 수 있는 조치',   auto, OK),
          ('사람 확인', '되돌릴 수 없거나 센서 의심', man, WARN)]
xs = np.arange(len(stages))
ax.bar(xs, [t[2] for t in stages], color=[t[3] for t in stages], width=.5)
for x, (lab, sub, v, c) in zip(xs, stages):
    ax.text(x, v + raw*.035, f'{v}', ha='center', color=FG, fontsize=15, fontweight='bold')
    ax.text(x, -raw*.075, lab, ha='center', color=FG,  fontsize=10.5, fontweight='bold')
    ax.text(x, -raw*.145, sub, ha='center', color=MUT, fontsize=8.5)
ax.annotate('', xy=(0.88, grp + raw*.10), xytext=(0.12, raw + raw*.02),
            arrowprops=dict(arrowstyle='->', color=INFO, lw=1.5,
                            connectionstyle='arc3,rad=-.18'))
ax.text(0.5, raw*.72, f'{(1-grp/raw)*100:.1f}% 축소', ha='center',
        color=INFO, fontsize=11.5, fontweight='bold')
ax.set_ylim(0, raw*1.16); ax.set_xlim(-.6, len(stages)-.4)
ax.set_xticks([]); ax.set_yticks([])
for sp in ax.spines.values(): sp.set_visible(False)
ax.set_facecolor(BG)
save(fig, 'flow')

# ── 2. 3시그마가 조기경보로 쓸 수 없었던 이유 ──────────────────
df = pd.read_csv('data/ai4i2020.csv')
df['dT'] = df['Process temperature'] - df['Air temperature']
tr, _ = train_test_split(df, test_size=.30, random_state=42, stratify=df['Machine failure'])
ok = tr[tr['Machine failure']==0]
m, s = ok['dT'].mean(), ok['dT'].std()

fig, ax = plt.subplots(figsize=(8.4, 2.9))
ax.hist(ok['dT'], bins=60, color='#2b3440', edgecolor='none')
ax.axvline(m-3*s, color=INFO, ls='--', lw=1.6)
ax.axvline(8.6,  color=BAD,  ls='-',  lw=1.8)
ax.text(m-3*s, ax.get_ylim()[1]*.92, f'  정상군 -3시그마 = {m-3*s:.1f} K\n  (주의를 걸려던 자리)',
        color=INFO, fontsize=9, va='top')
ax.text(8.6, ax.get_ylim()[1]*.55, '  실제 경보 = 8.6 K  ',
        color=BAD, fontsize=9, va='top', fontweight='bold')
ax.annotate('', xy=(m-3*s, ax.get_ylim()[1]*.30), xytext=(8.6, ax.get_ylim()[1]*.30),
            arrowprops=dict(arrowstyle='<->', color=WARN, lw=1.3))
ax.text((m-3*s+8.6)/2, ax.get_ylim()[1]*.34, '경보가 먼저 울린다', ha='center',
        color=WARN, fontsize=9, fontweight='bold')
ax.set_xlabel('방열 여유 = 공정온도 - 공기온도  [K]'); ax.set_ylabel('로트 수')
ax.set_xlim(6.8, 13.5); style(ax)
save(fig, 'sigma')

# ── 3. 공구 마모: 임계를 넘어도 대부분 고장 나지 않는다 ─────────
fig, ax = plt.subplots(figsize=(8.4, 2.9))
bins = np.arange(0, 260, 10)
h_all,_  = np.histogram(df['Tool wear'], bins=bins)
h_fail,_ = np.histogram(df[df['TWF']==1]['Tool wear'], bins=bins)
ctr = (bins[:-1]+bins[1:])/2
ax.bar(ctr, h_all,  width=9, color='#2b3440', label='전체 로트')
ax.bar(ctr, h_fail, width=9, color=BAD,       label='실제 고장')
ax.axvline(180, color=WARN, ls='--', lw=1.6); ax.axvline(200, color=BAD, ls='--', lw=1.6)
ax.text(181, ax.get_ylim()[1]*.95, ' 180분\n 조기 개입', color=WARN, fontsize=9, va='top')
ax.text(201, ax.get_ylim()[1]*.72, ' 200분\n 고장 구간', color=BAD, fontsize=9, va='top')
ax.set_xlabel('공구 마모 누적  [분]'); ax.set_ylabel('로트 수')
leg = ax.legend(facecolor=BG, edgecolor=GRID, labelcolor=FG, fontsize=9, loc='upper left')
style(ax)
save(fig, 'wear')

# ── 4. 물리 파생변수를 주면 모델이 규칙을 되찾는다 ──────────────
T = json.load(open('data/tree.json'))
KO = {'HDF':'방열 불량','PWF':'전력 이상','OSF':'과부하','TWF':'공구 마모'}
fig, ax = plt.subplots(figsize=(8.4, 2.9))
x = np.arange(len(T)); w = .36
r = [t['raw']['precision'] for t in T]; d = [t['der']['precision'] for t in T]
ax.bar(x-w/2, r, w, color='#3a4250', label='센서가 잰 값만 그대로 사용')
ax.bar(x+w/2, d, w, color=OK,        label='물리식으로 계산한 값을 함께 제공')
for i,(a,b) in enumerate(zip(r,d)):
    ax.text(i-w/2, a+2, f'{a:.1f}', ha='center', color=MUT, fontsize=9)
    ax.text(i+w/2, b+2, f'{b:.1f}', ha='center', color=FG, fontsize=9, fontweight='bold')
ax.set_xticks(x); ax.set_xticklabels([KO[t['code']] for t in T])
ax.set_ylabel('정밀도  [%]'); ax.set_ylim(0, 118)
ax.legend(facecolor=BG, edgecolor=GRID, labelcolor=FG, fontsize=9, loc='upper left')
style(ax); ax.grid(axis='x', visible=False)
save(fig, 'tree')

print(f'\n합계 확인: 원시 {raw} / 집약 {grp} / 자동 {auto} / 사람 {man} / 센서차단 {blk}')
