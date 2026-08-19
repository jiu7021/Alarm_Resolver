# 02_margin.py — 주의 임계를 경보 임계에서 역산. 여유율 스윕으로 근거 확보
import pandas as pd, numpy as np
from sklearn.model_selection import train_test_split

df = pd.read_csv('data/ai4i2020.csv')
df['dT']    = df['Process temperature'] - df['Air temperature']
df['Power'] = df['Torque'] * df['Rotational speed'] * 2*np.pi/60
df['OS']    = df['Tool wear'] * df['Torque']
df['OSlim'] = df['Type'].map({'L':11000,'M':12000,'H':13000})
tr, _ = train_test_split(df, test_size=0.30, random_state=42, stratify=df['Machine failure'])

print(f'{"여유율":>5s} | {"HDF 주의":>28s} | {"PWF 주의":>28s} | {"OSF 주의":>28s}')
print(f'{"":>5s} | {"임계   주의건수  적중  정밀도":>28s} | {"임계   주의건수  적중  정밀도":>28s} | {"임계   주의건수  적중  정밀도":>28s}')
print('-'*100)

for a in [0.05, 0.10, 0.15, 0.20, 0.30]:
    row = f'{a*100:4.0f}% |'
    # HDF: dT가 8.6K 밑으로 내려가면 경보 -> 주의는 그보다 위(느슨)
    warn = 8.6*(1+a)
    m = (tr['dT'] < warn) & (tr['dT'] >= 8.6)           # 주의 구간(경보 아님)
    hit = (m & (tr['HDF']==0)).sum()                     # 아직 고장 아님 = 조기포착 성공
    row += f' {warn:5.1f}K {m.sum():7d} {hit:6d} {hit/max(m.sum(),1)*100:6.1f}% |'
    # PWF: 9000W 위로 올라가면 경보 -> 주의는 그보다 아래
    warn = 9000*(1-a)
    m = (tr['Power'] > warn) & (tr['Power'] <= 9000)
    hit = (m & (tr['PWF']==0)).sum()
    row += f' {warn:5.0f}W {m.sum():7d} {hit:6d} {hit/max(m.sum(),1)*100:6.1f}% |'
    # OSF: 등급별 임계 초과면 경보 -> 주의는 그 아래
    warn = tr['OSlim']*(1-a)
    m = (tr['OS'] > warn) & (tr['OS'] <= tr['OSlim'])
    hit = (m & (tr['OSF']==0)).sum()
    row += f' {(1-a)*100:4.0f}% {m.sum():7d} {hit:6d} {hit/max(m.sum(),1)*100:6.1f}% |'
    print(row)

print('\n[TWF] 공구마모 주의 임계 (경보 200min)')
for w in [150, 160, 170, 180, 190]:
    m = (tr['Tool wear'] >= w) & (tr['Tool wear'] < 200)
    print(f'  {w}min 이상: 주의 {m.sum():4d}건, 이 중 실제고장 {(m & (tr["TWF"]==1)).sum():2d}건')
