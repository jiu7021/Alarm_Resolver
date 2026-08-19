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
let decided = {};                               // 사람이 판단한 조치: key -> '승인' | '보류'
const key = c => c.alarm_id + (c.esc ? '#esc' : '');

const N = () => S[day].equipments[0].series.t.length;
const nowT = () => S[day].equipments[0].series.t[Math.max(cur, 0)];
const stepOf = a => a.step, endOf = a => a.endStep;

// ── 차트 ──────────────────────────────────────────────
const W = 760, H = 88, PL = 46, PR = 10, PT = 8, PB = 15;

function chart({label, unit, series, limits = [], marks = [], fills = []}) {
  const n = series[0].v.length, c = cur;
  let lo = Math.min(...series.flatMap(s => s.v)), hi = Math.max(...series.flatMap(s => s.v));
  const shown = limits.filter(l => l.v >= lo - (hi-lo)*0.6 && l.v <= hi + (hi-lo)*0.6);
  shown.forEach(l => { lo = Math.min(lo, l.v); hi = Math.max(hi, l.v); });
  const pad = (hi - lo) * 0.12 || 1; lo -= pad; hi += pad;
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
  series.forEach(s => g += `<path d="${line(s.v)}" fill="none" stroke="${s.c}" stroke-width="${s.dyn?1:1.4}"${s.dyn?' stroke-dasharray="4 3" opacity=".8"':''}/>`);

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
  const d = S[day], e = d.equipments[eqp], s = e.series, lim = OSLIM[e.type];
  const idx = t => s.t.indexOf(t);
  const my = d.alarms.filter(a => a.eqp === e.id);
  const marks = my.map(a => [Math.max(idx(a.time), 0), COL[a.grade]]);
  const fills = my.filter(a => a.end !== a.time).map(a => [idx(a.time), idx(a.end), COL[a.grade]]);
  const hot = s.proc.map((p,i) => (p - s.air[i]) < 8.6 && s.rpm[i] < 1380 ? i : -1).filter(i => i >= 0);

  $('#charts').innerHTML = [
    chart({label:'절삭부 온도', unit:'[K] · 두 선의 간격이 방열 여유', series:[
      {t:s.t, v:s.proc, c:'#ff9f40', name:'공정온도'}, {t:s.t, v:s.air, c:'#4dabf7', name:'공기온도'}],
      fills: hot.map(i => [i, i+1, '#ffd23f']), marks}),
    chart({label:'스핀들 회전수', unit:'[rpm]', series:[{t:s.t, v:s.rpm, c:'#e6e9ef'}],
      limits:[{v:1380, c:'#ffd23f', t:'1380 방열 판정선'}], marks, fills}),
    chart({label:'스핀들 부하 토크', unit:'[Nm] · 점선은 마모에 따라 내려가는 허용 한계', series:[
      {t:s.t, v:s.torque, c:'#e6e9ef'}, {t:s.t, v:s.wear.map(w => lim/w), c:'#ff9f40', dyn:1, name:'허용 한계'}], marks, fills}),
    chart({label:'스핀들 소비전력', unit:'[W]', series:[{t:s.t, v:s.power, c:'#e6e9ef'}],
      limits:[{v:9000, c:'#ff5252', t:'9000 상한'}, {v:3500, c:'#ffd23f', t:'3500 하한'}], marks, fills}),
    chart({label:'블레이드 마모 누적', unit:'[min]', series:[{t:s.t, v:s.wear, c:'#e6e9ef'}],
      limits:[{v:200, c:'#ff5252', t:'200 경보'}, {v:180, c:'#ff9f40', t:'180 주의'}], marks, fills}),
  ].join('');
}

// ── 이력 ──────────────────────────────────────────────
// 알람은 설비별로 생성되므로 화면에는 발생 시각순으로 정렬해 보여준다
const seen = () => S[day].alarms.filter(a => stepOf(a) <= cur).sort((x,y) => stepOf(x) - stepOf(y));

function renderLog() {
  const d = S[day], vis = seen();
  const legend = `<div class="legend">` + Object.entries(GRADE_KO).map(([k,v]) =>
    `<span><i style="background:${COL[k]}"></i>${v} (${k})</span>`).join('') + `</div>`;
  let rows;
  if (logv === 'alarm') {
    rows = vis.slice().reverse().map(a => {
      const sub = a.sub.length ? `<p>파생 알람 ${a.sub.length}건 동반 — ${[...new Set(a.sub.map(x=>x.ko))].join(', ')}</p>` : '';
      const blk = a.blocked ? ` <span class="pill blk">센서 신뢰 불가</span>` : '';
      const end = endOf(a) > cur ? '진행 중' : '~' + a.end;
      return `<div class="row"><span class="led ${a.grade}"></span><span class="tm">${a.time}</span>
        <span class="t"><b>${a.ko}</b><i>${a.eqp}</i>${blk}${sub}</span>
        <span class="r">${a.value} · ${a.repeat}회 지속<br>${end}</span></div>`;
    }).join('');
  } else {
    rows = d.actions.filter(c => c.step <= cur).sort((x,y) => x.step - y.step).reverse().map(c => {
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
  $('#nc').textContent = d.actions.filter(c => c.step <= cur).length;
}

// ── 재생 ──────────────────────────────────────────────
function renderKpi() {
  const d = S[day], vis = seen();
  const act = d.actions.filter(c => c.step <= cur);
  const auto = act.filter(c => c.auto).length;
  const raw = d.raw_cum[cur];                                  // 시점까지 실제로 발생한 임계 초과 횟수
  $('#kpi').innerHTML = [
    ['원시 알람', raw, '임계 초과 시점'],
    ['근본원인 집약', vis.length, vis.length ? `압축률 ${(100 - vis.length/Math.max(raw,1)*100).toFixed(0)}%` : '—'],
    ['자동조치 완료', auto, '가역 조치만 실행'],
    ['사람 확인 필요', act.length - auto, '비가역·손상 위험'],
    ['센서 이상 차단', vis.filter(a => a.blocked).length, '오조치 방지'],
  ].map(([k,v,s]) => `<div><span>${k}</span><b>${v}</b><small>${s}</small></div>`).join('');
}

function renderBar() {
  const done = cur >= N()-1;
  $('#play').textContent = playing ? '⏸ 일시정지' : done ? '↺ 다시 재생' : '▶ 재생';
  $('#play').classList.toggle('on', playing);
  $('#clock').textContent = nowT();
  $('#bar').classList.toggle('alert', queue.length > 0);
  $('#slow').textContent = queue.length ? `판단 대기 ${queue.length}건 · 배속 x1` : '야간 진행';
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
      <div class="hold-b"><button data-k="${key(c)}" data-d="승인">조치 승인</button>
        <button class="ghost" data-k="${key(c)}" data-d="보류">보류</button></div>
    </div>`; }).join('');
}

function step() {
  if (cur >= N()-1) { stop(); return; }
  cur++;
  // 사람 판단이 필요한 긴급 건은 큐에 쌓고 배속만 x1로 낮춘다. 설비는 멈추지 않으므로 시간은 계속 간다.
  const hits = S[day].actions.filter(c => c.step === cur && !c.auto && c.grade === 'CRIT' && !decided[key(c)]);
  if (hits.length) { if (saved === null) saved = speed; speed = 1; queue.push(...hits); renderHold(); }
  paint();
  timer = setTimeout(step, SPEED[speed]);
}
function play() {
  if (cur >= N()-1) { cur = -1; decided = {}; queue = []; saved = null; }
  playing = true; renderBar(); timer = setTimeout(step, SPEED[speed]);
}
function pause() { playing = false; clearTimeout(timer); renderBar(); }
function stop()  { playing = false; clearTimeout(timer); renderBar(); }

function paint() { renderCharts(); renderLog(); renderKpi(); renderBar(); }

function render() {
  const d = S[day];
  document.querySelectorAll('#days button').forEach((b,i) => b.classList.toggle('on', i === day));
  $('#title').textContent = `${d.date} · ${d.title}`;
  $('#brief').textContent = d.brief;
  $('#eqps').innerHTML = d.equipments.map((e,i) =>
    `<button class="${i===eqp?'on':''}" data-i="${i}">${e.id} <span style="opacity:.6">(${e.type}등급)</span></button>`).join('');
  renderHold(); paint();
}

// ── 초기화 ────────────────────────────────────────────
$('#days').innerHTML = S.map((d,i) => `<button data-i="${i}"><b>${d.date.slice(5)}</b><span>${d.title}</span></button>`).join('');
$('#spd').innerHTML = [1,5,20,50].map(s => `<button data-s="${s}">x${s}</button>`).join('');

$('#days').onclick = e => { const b = e.target.closest('button'); if (!b) return;
  stop(); day = +b.dataset.i; eqp = 0; cur = N()-1; queue = []; saved = null; decided = {}; render(); };
$('#eqps').onclick = e => { const b = e.target.closest('button'); if (!b) return; eqp = +b.dataset.i;
  document.querySelectorAll('#eqps button').forEach((x,i) => x.classList.toggle('on', i === eqp)); renderCharts(); };
$('#logtabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; logv = b.dataset.v;
  document.querySelectorAll('#logtabs button').forEach(x => x.classList.toggle('on', x === b)); renderLog(); };
$('#play').onclick = () => playing ? pause() : play();
$('#rst').onclick  = () => { stop(); cur = 0; queue = []; saved = null; decided = {}; paint(); renderHold(); };
$('#end').onclick  = () => { stop(); cur = N()-1; queue = []; saved = null; paint(); renderHold(); };
$('#spd').onclick  = e => { const b = e.target.closest('button'); if (!b) return;
  speed = +b.dataset.s; saved = null; renderBar(); };          // 수동 변경 시 자동 복귀는 해제
$('#hold').onclick = e => { const b = e.target.closest('button'); if (!b) return;
  decided[b.dataset.k] = b.dataset.d;
  queue = queue.filter(c => key(c) !== b.dataset.k);
  if (!queue.length && saved !== null) { speed = saved; saved = null; }   // 마지막 건을 처리하면 원래 배속으로
  renderHold(); paint(); };

render();
