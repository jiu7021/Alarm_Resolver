# 06_tree.py — 결정트리가 물리 규칙을 스스로 복원하는지 확인 (AI4I는 본래 XAI 연구용 데이터셋)
# 두 조건을 비교한다: 원본 센서 5종만 준 경우 vs 물리 파생변수를 함께 준 경우
import pandas as pd, numpy as np, json
from sklearn.tree import DecisionTreeClassifier, export_text
from sklearn.model_selection import train_test_split
from sklearn.metrics import precision_score, recall_score

df = pd.read_csv('data/ai4i2020.csv')
RAW = ['Air temperature','Process temperature','Rotational speed','Torque','Tool wear']
df['dT']    = df['Process temperature'] - df['Air temperature']   # 방열 여유 [K]
df['Power'] = df['Torque'] * df['Rotational speed'] * 2*np.pi/60  # 전력 [W] = 토크 x 각속도
df['OS']    = df['Tool wear'] * df['Torque']                      # 과부하 지표 [minNm]
DER = RAW + ['dT','Power','OS']
tr, te = train_test_split(df, test_size=0.30, random_state=42, stratify=df['Machine failure'])

DOC = {'HDF':'방열여유 < 8.6K 이고 회전수 < 1380rpm', 'PWF':'전력 < 3500W 또는 > 9000W',
       'OSF':'마모 x 토크 > 등급별 임계(11000/12000/13000)', 'TWF':'마모 200~240min'}
out = []
for lab in ['HDF','PWF','OSF','TWF']:
    row = {'code': lab, 'doc': DOC[lab]}
    for tag, feats, depth in [('raw', RAW, 4), ('der', DER, 3)]:
        m = DecisionTreeClassifier(max_depth=depth, class_weight='balanced', random_state=42)
        m.fit(tr[feats], tr[lab])
        p = m.predict(te[feats])
        row[tag] = {
            'precision': round(precision_score(te[lab], p, zero_division=0)*100, 1),
            'recall':    round(recall_score(te[lab], p, zero_division=0)*100, 1),
            'tree': export_text(m, feature_names=list(feats), max_depth=depth).strip(),
        }
        # 트리가 실제로 쓴 분기 변수와 임계값
        used = [(feats[m.tree_.feature[i]], round(float(m.tree_.threshold[i]), 1))
                for i in range(m.tree_.node_count) if m.tree_.feature[i] >= 0]
        row[tag]['splits'] = used
    out.append(row)
    print(f"[{lab}] 문서: {DOC[lab]}")
    print(f"  원본만  정밀도 {row['raw']['precision']:5.1f}% 재현율 {row['raw']['recall']:5.1f}%  분기 {row['raw']['splits'][:3]}")
    print(f"  파생포함 정밀도 {row['der']['precision']:5.1f}% 재현율 {row['der']['recall']:5.1f}%  분기 {row['der']['splits'][:3]}")
    print()

json.dump(out, open('data/tree.json','w'), ensure_ascii=False, indent=1)
print('data/tree.json 저장')
