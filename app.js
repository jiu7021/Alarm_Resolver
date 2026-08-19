// app.js — 야간 재생 시뮬레이터. 차트는 외부 라이브러리 없이 SVG로 직접 그린다.
const S = window.SCENARIOS;
const $ = s => document.querySelector(s);

const GRADE_KO = {CRIT:'긴급', MAJ:'중요', MIN:'주의', SNSR:'센서의심', INFO:'정보'};
const COL = {CRIT:'#ff5252', MAJ:'#ff9f40', MIN:'#ffd23f', SNSR:'#4dabf7', INFO:'#51cf66'};
const OSLIM = {L:11000, M:12000};
const SPEED = {1:2000, 5:400, 20:100, 50:40};   // 배속 -> 1스텝(6분) 표시 간격 [ms]

let day = 0, eqp = 0, logv = 'alarm';
let cur = 99, playing = false, speed = 20, timer = null;
let queue = [], saved = null;                   // 판단 대기 큐 / 강등 전 배속
let live = {}, dIdx = {}, halt = {}, alarmAt = {}, wearOff = {}, replaced = {};
const STEP_MIN = 6;                             // 1스텝 = 6분
const TAU = 12;                                 // 정지 후 공정온도 냉각 시정수 [min] (가정치)
let decided = {};                               // 사람이 판단한 조치: key -> '승인' | '보류'
const key = c => c.alarm_id + (c.esc ? '#esc' : '');

const N = () => S[day].equipments[0].series.t.length;
const nowT = () => S[day].equipments[0].series.t[Math.max(cur, 0)];
const stepOf = a => a.step, endOf = a => a.endStep;

// ── 실시간 시계열 ─────────────────────────────────────
// 설비가 정지하면 원본 데이터 소비가 멈춘다(가공을 안 하므로). 그동안의 값은 물리 거동으로 만든다.
function resetLive() {
  live = {}; dIdx = {}; halt = {}; alarmAt = {};
  S[day].equipments.forEach(e => {
    live[e.id] = {air:[], proc:[], rpm:[], torque:[], power:[], wear:[], halt:[]};
    dIdx[e.id] = -1; halt[e.id] = false; wearOff[e.id] = 0; replaced[e.id] = false;
  });
}
function stepLive(k) {
  S[day].equipments.forEach(e => {
    const L = live[e.id], s = e.series, n = L.proc.length;
    if (halt[e.id]) {
      const air = s.air[Math.min(k, s.air.length-1)];             // 환경온도는 설비와 무관하게 계속 측정된다
      const prev = n ? L.proc[n-1] : air;
      L.air.push(air);
      L.proc.push(+(air + (prev - air) * Math.exp(-STEP_MIN/TAU)).toFixed(1));
      L.rpm.push(0); L.torque.push(0); L.power.push(0);           // 구동 정지 -> 부하와 전력 소멸
      L.wear.push(n ? L.wear[n-1] : 0);                           // 가공 정지 -> 마모 누적 정지
      L.halt.push(1);
    } else {
      const i = Math.min(++dIdx[e.id], s.air.length-1);
      L.air.push(s.air[i]); L.proc.push(s.proc[i]); L.rpm.push(s.rpm[i]);
      L.torque.push(s.torque[i]); L.power.push(s.power[i]);
      L.wear.push(+(s.wear[i] + wearOff[e.id]).toFixed(1));
      L.halt.push(0);
    }
  });
  // 이번 스텝에 새로 드러난 알람의 화면 위치(시계 기준)를 기록한다
  S[day].alarms.forEach(a => {
    if (alarmAt[a.id] !== undefined || dIdx[a.eqp] < a.step) return;
    if (replaced[a.eqp] && a.code.startsWith('TWF')) return;      // 교체 후 마모 알람은 무효
    alarmAt[a.id] = k;
  });
}
function fillAll() { resetLive(); for (let k = 0; k < N(); k++) stepLive(k); }
const haltSteps = () => S[day].equipments.reduce((t,e) => t + (live[e.id] ? live[e.id].halt.reduce((x,y)=>x+y,0) : 0), 0);

// ── 차트 ──────────────────────────────────────────────
const W = 760, H = 88, PL = 46, PR = 10, PT = 8, PB = 15;

function chart({label, unit, series, limits = [], marks = [], fills = [], base}) {
  const n = series[0].t.length, c = cur;
  const ref = base || series.flatMap(s => s.v);
  let lo = Math.min(...ref), hi = Math.max(...ref);
  const shown = limits.filter(l => l.v >= lo - (hi-lo)*0.6 && l.v <= hi + (hi-lo)*0.6);
  shown.forEach(l => { lo = Math.min(lo, l.v); hi = Math.max(hi, l.v); });
  const pad = (hi - lo) * 0.12 || 1; const floor0 = Math.min(...ref) >= 0;
  lo -= pad; hi += pad;
  if (floor0 && lo < 0) lo = 0;                       // 회전수·토크·전력·마모는 음수가 될 수 없다
  const X = i => PL + i * (W - PL - PR) / (n - 1);
  const Y = v => PT + (hi - v) * (H - PT - PB) / (hi - lo);
  const line = vs => vs.slice(0, c+1).map((v,i) => (i?'L':'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join(' ');
  let g = '';

  fills.filter(f => f[0] <= c).forEach(f => { const x0 = X(f[0]), x1 = X(Math.min(f[1], c));
    g += `<rect x="${x0}" y="${PT}" width="${Math.max(x1-x0,1.5)}" height="${H-PT-PB}" fill="${f[2]}" opacity=".13"/>`; });
  marks.filter(m => m[0] <= c).forEach(m => { const x = X(m[0]);
    g += `<line x1="${x}" y1="${PT}" x2="${x}" y2="${H-PB}" stroke="${m[1]}" stroke-width="1" opacity=".55"/>`; });
  shown.forEach(l => { const y = Y(l.v);
    g += `<line x1="${PL}" y1="${y}" x2="${W-PR}" y2="${y}" stroke="${l.c}" stroke-width="1" stroke-dasharray="3 3" opacity=".75"/>`
       + `<text x="${W-PR}" y="${y-3}" fill="${l.c}" font-size="9" text-anchor="end" opacity=".9">${l.t}</text>`; });
  series.forEach(s => { if (s.dyn) s = {...s, v: s.v.map(v => Math.min(Math.max(v, lo), hi))};
    g += `<path d="${line(s.v)}" fill="none" stroke="${s.c}" stroke-width="${s.dyn?1:1.4}"${s.dyn?' stroke-dasharray="4 3" opacity=".8"':''}/>`; });

  if (c < n-1) {                                              // 재생 커서
    const x = X(c);
    g += `<line x1="${x}" y1="${PT}" x2="${x}" y2="${H-PB}" stroke="#e6e9ef" stroke-width="1" opacity=".5"/>`;
    series.filter(s => !s.dyn).forEach(s => g += `<circle cx="${x}" cy="${Y(s.v[c])}" r="2.4" fill="${s.c}"/>`);
  }
  g += `<text x="${PL-6}" y="${Y(hi)+8}" fill="#8b94a3" font-size="9" text-anchor="end">${hi.toFixed(0)}</text>`
     + `<text x="${PL-6}" y="${Y(lo)}" fill="#8b94a3" font-size="9" text-anchor="end">${lo.toFixed(0)}</text>`;
  [0,.25,.5,.75,1].forEach(f => { const i = Math.round(f*(n-1));
    g += `<text x="${X(i)}" y="${H-3}" fill="#8b94a3" font-size="9" text-anchor="${f===0?'start':f===1?'end':'middle'}">${series[0].t[i]}</text>`; });

  const leg = series.filter(s => s.name).map(s => `<span style="color:${s.c}">■</span> ${s.name}`).join(' &nbsp;');
  return `<div class="ch"><div class="ch-head"><b>${label}</b><em>${leg} &nbsp;${unit}</em></div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px">${g}</svg></div>`;
}

function renderCharts() {
  const d = S[day], e = d.equipments[eqp], L = live[e.id], s = e.series, lim = OSLIM[e.type];
  const my = d.alarms.filter(a => a.eqp === e.id && alarmAt[a.id] !== undefined);
  const marks = my.map(a => [alarmAt[a.id], COL[a.grade]]);
  const fills = [];
  L.halt.forEach((h,i) => { if (h) fills.push([i, i+1, '#ff5252']); });      // 정지 구간
  const hot = L.proc.map((p,i) => !L.halt[i] && (p - L.air[i]) < 8.6 && L.rpm[i] < 1380 ? i : -1).filter(i => i >= 0);
  const stopped = L.halt.some(h => h);
  const bs = arr => stopped ? arr.concat([0]) : arr;                 // 정지가 있으면 0을 스케일에 포함

  $('#charts').innerHTML = [
    chart({label:'절삭부 온도', unit:'[K] · 두 선의 간격이 방열 여유', series:[
      {t:s.t, v:L.proc, c:'#ff9f40', name:'공정온도'}, {t:s.t, v:L.air, c:'#4dabf7', name:'공기온도'}],
      base: s.proc.concat(s.air), fills: fills.concat(hot.map(i => [i, i+1, '#ffd23f'])), marks}),
    chart({label:'스핀들 회전수', unit:'[rpm]', series:[{t:s.t, v:L.rpm, c:'#e6e9ef'}],
      limits:[{v:1380, c:'#ffd23f', t:'1380 방열 판정선'}], base: bs(s.rpm), marks, fills}),
    chart({label:'스핀들 부하 토크', unit:'[Nm] · 점선은 마모에 따라 내려가는 허용 한계', series:[
      {t:s.t, v:L.torque, c:'#e6e9ef'}, {t:s.t, v:L.wear.map(w => lim/Math.max(w,1)), c:'#ff9f40', dyn:1, name:'허용 한계'}], base: bs(s.torque), marks, fills}),
    chart({label:'스핀들 소비전력', unit:'[W]', series:[{t:s.t, v:L.power, c:'#e6e9ef'}],
      limits:[{v:9000, c:'#ff5252', t:'9000 상한'}, {v:3500, c:'#ffd23f', t:'3500 하한'}], base: bs(s.power), marks, fills}),
    chart({label:'블레이드 마모 누적', unit:'[min]', series:[{t:s.t, v:L.wear, c:'#e6e9ef'}],
      limits:[{v:200, c:'#ff5252', t:'200 경보'}, {v:180, c:'#ff9f40', t:'180 주의'}], base: s.wear, marks, fills}),
  ].join('');
}

// ── 이력 ──────────────────────────────────────────────
// 알람은 설비별로 생성되므로 화면에는 발생 시각순으로 정렬해 보여준다
const seen = () => S[day].alarms.filter(a => alarmAt[a.id] !== undefined).sort((x,y) => alarmAt[x.id] - alarmAt[y.id]);
const seenAct = () => S[day].actions.filter(c => dIdx[c.eqp] >= c.step).sort((x,y) => x.step - y.step);

function renderLog() {
  const d = S[day], vis = seen();
  const legend = `<div class="legend">` + Object.entries(GRADE_KO).map(([k,v]) =>
    `<span><i style="background:${COL[k]}"></i>${v} (${k})</span>`).join('') + `</div>`;
  let rows;
  if (logv === 'alarm') {
    rows = vis.slice().reverse().map(a => {
      const sub = a.sub.length ? `<p>파생 알람 ${a.sub.length}건 동반 — ${[...new Set(a.sub.map(x=>x.ko))].join(', ')}</p>` : '';
      const blk = a.blocked ? ` <span class="pill blk">센서 신뢰 불가</span>` : '';
      const end = dIdx[a.eqp] < endOf(a) ? '진행 중' : '~' + a.end;
      return `<div class="row"><span class="led ${a.grade}"></span><span class="tm">${a.time}</span>
        <span class="t"><b>${a.ko}</b><i>${a.eqp}</i>${blk}${sub}</span>
        <span class="r">${a.value} · ${a.repeat}회 지속<br>${end}</span></div>`;
    }).join('');
  } else {
    rows = seenAct().reverse().map(c => {
      const a = d.alarms.find(x => x.id === c.alarm_id);
      const dec = decided[key(c)];
      const pill = c.auto ? `<span class="pill auto">자동 실행</span>`
                 : dec ? `<span class="pill ${dec==='승인'?'auto':'man'}">사람 판단: ${dec}</span>`
                 : c.esc ? `<span class="pill man">에스컬레이션 · 대기</span>`
                       : `<span class="pill man">승인 대기</span>`;
      return `<div class="row"><span class="led ${c.grade}"></span><span class="tm">${c.time}</span>
        <span class="t"><b>${c.act}</b><i>${c.eqp}</i> ${pill}
        <p>${c.why}</p><p>연결 알람 ${a?a.ko:''} · ${c.alarm_id}</p></span>
        <span class="r">${c.result}</span></div>`;
    }).join('');
  }
  $('#log').innerHTML = legend + (rows || '<p class="empty">아직 발생한 항목이 없습니다.</p>');
  $('#na').textContent = vis.length;
  $('#nc').textContent = seenAct().length;
}

// ── 재생 ──────────────────────────────────────────────
function renderKpi() {
  const d = S[day], vis = seen(), act = seenAct();
  const auto = act.filter(c => c.auto).length;
  const prog = Math.max(...S[day].equipments.map(e => dIdx[e.id]));
  const raw = d.raw_cum[Math.max(prog, 0)];                    // 가공이 진행된 만큼의 임계 초과 횟수
  const hs = haltSteps();
  $('#kpi').innerHTML = [
    ['원시 알람', raw, '임계 초과 시점'],
    ['근본원인 집약', vis.length, vis.length ? `압축률 ${(100 - vis.length/Math.max(raw,1)*100).toFixed(0)}%` : '—'],
    ['자동조치 완료', auto, '가역 조치만 실행'],
    ['사람 확인 필요', act.length - auto, '비가역·손상 위험'],
    ['센서 이상 차단', vis.filter(a => a.blocked).length, '오조치 방지'],
    ['정지 손실', hs*STEP_MIN + '분', hs ? '판단 대기 중 생산 중단' : '정지 없음'],
  ].map(([k,v,s]) => `<div><span>${k}</span><b>${v}</b><small>${s}</small></div>`).join('');
}

function renderBar() {
  const done = cur >= N()-1;
  $('#play').textContent = playing ? '⏸ 일시정지' : done ? '↺ 다시 재생' : '▶ 재생';
  $('#play').classList.toggle('on', playing);
  $('#clock').textContent = nowT();
  $('#bar').classList.toggle('alert', queue.length > 0);
  const hl = S[day].equipments.filter(e => halt[e.id]).map(e => e.id);
  $('#slow').textContent = hl.length ? `${hl.join(', ')} 정지 중 · 배속 x1` : '야간 진행';
  $('#prog').style.width = (cur+1)/N()*100 + '%';
  document.querySelectorAll('#spd button').forEach(b => b.classList.toggle('on', +b.dataset.s === speed));
}

function renderHold() {
  if (!queue.length) { $('#hold').innerHTML = ''; $('#hold').classList.remove('show'); return; }
  $('#hold').classList.add('show');
  $('#hold').innerHTML = queue.map(c => {
    const a = S[day].alarms.find(x => x.id === c.alarm_id);
    return `<div class="hold-in">
      <div class="hold-h"><span class="led CRIT"></span><b>${c.time} · ${c.eqp} — ${a.ko}</b>
        <span class="pill man">${c.esc ? '자동조치 실패 · 사람 판단 대기' : '자동조치 불가 · 사람 판단 대기'}</span></div>
      <p><b>측정값</b> ${a.value} &nbsp;·&nbsp; <b>필요 조치</b> ${c.act}</p>
      <p class="why">${c.why}</p>
      <p class="why">정지 중: 회전수·토크·전력 0, 공정온도 하강, 마모 누적 정지. 가공이 멈춰 야간 생산이 밀립니다.</p>
      <div class="hold-b"><button data-k="${key(c)}" data-d="승인">조치 완료 · 재가동</button>
        <button class="ghost" data-k="${key(c)}" data-d="보류">정지 유지</button></div>
    </div>`; }).join('');
}

function step() {
  if (cur >= N()-1) { stop(); return; }
  cur++; stepLive(cur);
  // 긴급 건은 해당 설비를 정지시키고 판단 큐에 쌓는다. 시계는 계속 가고 배속만 x1로 낮춘다.
  const hits = S[day].actions.filter(c => !c.auto && c.grade === 'CRIT'
                && dIdx[c.eqp] === c.step && !decided[key(c)] && !queue.includes(c));
  if (hits.length) {
    hits.forEach(c => halt[c.eqp] = true);
    if (saved === null) saved = speed;
    speed = 1; queue.push(...hits); renderHold();
  }
  paint();
  timer = setTimeout(step, SPEED[speed]);
}
function play() {
  if (cur >= N()-1) { cur = 0; decided = {}; queue = []; saved = null; resetLive(); stepLive(0); }
  playing = true; renderBar(); timer = setTimeout(step, SPEED[speed]);
}
function pause() { playing = false; clearTimeout(timer); renderBar(); }
function stop()  { playing = false; clearTimeout(timer); renderBar(); }

function paint() { paintTabs(); renderCharts(); renderLog(); renderKpi(); renderBar(); }

function paintTabs() {
  $('#eqps').innerHTML = S[day].equipments.map((e,i) =>
    `<button class="${i===eqp?'on':''}${halt[e.id]?' halted':''}" data-i="${i}">${e.id}
      <span style="opacity:.6">(${e.type}등급)</span>${halt[e.id]?'<b class="stopdot">정지 중</b>':''}</button>`).join('');
}
function render() {
  const d = S[day];
  if (!live[d.equipments[0].id]) fillAll();
  document.querySelectorAll('#days button').forEach((b,i) => b.classList.toggle('on', i === day));
  $('#title').textContent = `${d.date} · ${d.title}`;
  $('#brief').textContent = d.brief;
  paintTabs();
  renderHold(); paint();
}

// ── 초기화 ────────────────────────────────────────────
$('#days').innerHTML = S.map((d,i) => `<button data-i="${i}"><b>${d.date.slice(5)}</b><span>${d.title}</span></button>`).join('');
$('#spd').innerHTML = [1,5,20,50].map(s => `<button data-s="${s}">x${s}</button>`).join('');

$('#days').onclick = e => { const b = e.target.closest('button'); if (!b) return;
  stop(); day = +b.dataset.i; eqp = 0; cur = N()-1; queue = []; saved = null; decided = {}; fillAll(); render(); };
$('#eqps').onclick = e => { const b = e.target.closest('button'); if (!b) return; eqp = +b.dataset.i;
  document.querySelectorAll('#eqps button').forEach((x,i) => x.classList.toggle('on', i === eqp)); renderCharts(); };
$('#logtabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; logv = b.dataset.v;
  document.querySelectorAll('#logtabs button').forEach(x => x.classList.toggle('on', x === b)); renderLog(); };
$('#play').onclick = () => playing ? pause() : play();
$('#rst').onclick  = () => { stop(); cur = 0; queue = []; saved = null; decided = {}; resetLive(); stepLive(0); paint(); renderHold(); };
$('#end').onclick  = () => { stop(); cur = N()-1; queue = []; saved = null; decided = {}; fillAll(); paint(); renderHold(); };
$('#spd').onclick  = e => { const b = e.target.closest('button'); if (!b) return;
  speed = +b.dataset.s; saved = null; renderBar(); };          // 수동 변경 시 자동 복귀는 해제
$('#hold').onclick = e => { const b = e.target.closest('button'); if (!b) return;
  const c = queue.find(x => key(x) === b.dataset.k);
  decided[b.dataset.k] = b.dataset.d;
  if (b.dataset.d === '승인' && c) {
    halt[c.eqp] = false;                                          // 조치 완료 -> 재가동
    const a = S[day].alarms.find(x => x.id === c.alarm_id);
    if (a && a.code === 'TWF_CRIT') {                             // 블레이드 교체 -> 마모 0부터 재누적
      const e = S[day].equipments.find(x => x.id === c.eqp);
      wearOff[c.eqp] = -e.series.wear[Math.max(dIdx[c.eqp], 0)];
      replaced[c.eqp] = true;
    }
  }
  queue = queue.filter(x => key(x) !== b.dataset.k);
  if (!queue.length && saved !== null) { speed = saved; saved = null; }   // 마지막 건을 처리하면 원래 배속으로
  renderHold(); paint(); };

// 검증용 상태 조회 훅 (개발자 도구에서 __state() 호출)
window.__state = () => ({cur, live, dIdx, halt, wearOff, replaced, queue, speed});
fillAll();
render();
