# 01_threshold.py — 층화분할 70:30 후 학습셋에서 2단 임계(주의/경보) 산출
import pandas as pd, numpy as np
from sklearn.model_selection import train_test_split

df = pd.read_csv('data/ai4i2020.csv')

# 파생 변수: 온도차(방열 여유), 전력, 과부하 지표
df['dT']    = df['Process temperature'] - df['Air temperature']          # [K]
df['Power'] = df['Torque'] * df['Rotational speed'] * 2*np.pi/60         # [W]
df['OS']    = df['Tool wear'] * df['Torque']                             # [minNm]

# 층화분할: 고장 라벨 비율 유지 (fail 3.39%로 희소하므로 필수)
tr, te = train_test_split(df, test_size=0.30, random_state=42, stratify=df['Machine failure'])
print(f'학습 {len(tr)}행 (고장 {tr["Machine failure"].sum()}건, {tr["Machine failure"].mean()*100:.2f}%)')
print(f'검증 {len(te)}행 (고장 {te["Machine failure"].sum()}건, {te["Machine failure"].mean()*100:.2f}%)')

# 주의 임계는 "정상군"에서만 산출 (고장 데이터가 섞이면 한계가 벌어짐)
ok = tr[tr['Machine failure'] == 0]
print(f'\n정상군 {len(ok)}행 기준 ±3시그마 관리한계')
print(f'{"변수":14s} {"평균":>9s} {"표준편차":>9s} {"-3σ":>9s} {"+3σ":>9s}  {"정규성":>6s}')
for c, u in [('dT','K'), ('Power','W'), ('Torque','Nm'), ('Rotational speed','rpm'), ('Tool wear','min')]:
    m, s = ok[c].mean(), ok[c].std()
    # 첨도로 정규분포 근사 여부 판단 (정규분포면 0에 가까움)
    kurt = ok[c].kurtosis()
    flag = 'O' if abs(kurt) < 1 else 'X'
    print(f'{c:14s} {m:9.1f} {s:9.1f} {m-3*s:9.1f} {m+3*s:9.1f}  {flag:>6s} (첨도{kurt:+.2f})')
