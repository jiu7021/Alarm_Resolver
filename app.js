// app.js — 시나리오 렌더링. 차트는 외부 라이브러리 없이 SVG로 직접 그린다.
const S = window.SCENARIOS;
const $ = s => document.querySelector(s);
let day = 0, eqp = 0, logv = 'alarm';

const GRADE_KO = {CRIT:'긴급', MAJ:'중요', MIN:'주의', SNSR:'센서의심', INFO:'정보'};
const COL = {CRIT:'#ff5252', MAJ:'#ff9f40', MIN:'#ffd23f', SNSR:'#4dabf7', INFO:'#51cf66'};
const OSLIM = {L:11000, M:12000};

// ── 차트 ──────────────────────────────────────────────
const W = 760, H = 88, PL = 46, PR = 10, PT = 8, PB = 15;
const path = (xs, ys) => xs.map((x,i) => (i?'L':'M') + x.toFixed(1) + ' ' + ys[i].toFixed(1)).join(' ');

function chart({label, unit, series, limits = [], marks = [], fills = []}) {
  const n = series[0].v.length;
  let lo = Math.min(...series.flatMap(s => s.v)), hi = Math.max(...series.flatMap(s => s.v));
  // 임계선이 데이터 범위 근처면 스케일에 포함한다(멀면 그래프가 납작해지므로 제외)
  const shown = limits.filter(l => l.v >= lo - (hi-lo)*0.6 && l.v <= hi + (hi-lo)*0.6);
  shown.forEach(l => { lo = Math.min(lo, l.v); hi = Math.max(hi, l.v); });
  const pad = (hi - lo) * 0.12 || 1; lo -= pad; hi += pad;
  const X = i => PL + i * (W - PL - PR) / (n - 1);
  const Y = v => PT + (hi - v) * (H - PT - PB) / (hi - lo);
  const xs = Array.from({length:n}, (_,i) => X(i));
  let g = '';

  fills.forEach(f => { const x0 = X(f[0]), x1 = X(f[1]);
    g += `<rect x="${x0}" y="${PT}" width="${Math.max(x1-x0,1.5)}" height="${H-PT-PB}" fill="${f[2]}" opacity=".13"/>`; });
  marks.forEach(m => { const x = X(m[0]);
    g += `<line x1="${x}" y1="${PT}" x2="${x}" y2="${H-PB}" stroke="${m[1]}" stroke-width="1" opacity=".55"/>`; });
  shown.forEach(l => { const y = Y(l.v);
    g += `<line x1="${PL}" y1="${y}" x2="${W-PR}" y2="${y}" stroke="${l.c}" stroke-width="1" stroke-dasharray="3 3" opacity=".75"/>`
       + `<text x="${W-PR}" y="${y-3}" fill="${l.c}" font-size="9" text-anchor="end" opacity=".9">${l.t}</text>`; });
  series.forEach(s => {
    if (s.dyn) g += `<path d="${path(xs, s.v.map(Y))}" fill="none" stroke="${s.c}" stroke-width="1" stroke-dasharray="4 3" opacity=".8"/>`;
    else       g += `<path d="${path(xs, s.v.map(Y))}" fill="none" stroke="${s.c}" stroke-width="1.4"/>`;
  });
  g += `<text x="${PL-6}" y="${Y(hi)+8}" fill="#8b94a3" font-size="9" text-anchor="end">${hi.toFixed(0)}</text>`
     + `<text x="${PL-6}" y="${Y(lo)}" fill="#8b94a3" font-size="9" text-anchor="end">${lo.toFixed(0)}</text>`;
  [0, .25, .5, .75, 1].forEach(f => { const i = Math.round(f*(n-1));
    g += `<text x="${X(i)}" y="${H-3}" fill="#8b94a3" font-size="9" text-anchor="${f===0?'start':f===1?'end':'middle'}">${series[0].t[i]}</text>`; });

  const leg = series.filter(s => s.name).map(s =>
    `<span style="color:${s.c}">■</span> ${s.name}`).join(' &nbsp;');
  return `<div class="ch"><div class="ch-head"><b>${label}</b><em>${leg || ''} &nbsp;${unit}</em></div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px">${g}</svg></div>`;
}

// ── 렌더 ──────────────────────────────────────────────
function renderCharts() {
  const d = S[day], e = d.equipments[eqp], s = e.series, lim = OSLIM[e.type];
  const idx = t => s.t.indexOf(t);
  const my = d.alarms.filter(a => a.eqp === e.id);
  const marks = my.map(a => [Math.max(idx(a.time), 0), COL[a.grade]]);
  const fills = my.filter(a => a.end !== a.time).map(a => [idx(a.time), idx(a.end), COL[a.grade]]);
  const dT = s.proc.map((p, i) => p - s.air[i]);
  const hot = dT.map((v, i) => v < 8.6 && s.rpm[i] < 1380 ? i : -1).filter(i => i >= 0);

  $('#charts').innerHTML = [
    chart({label:'절삭부 온도', unit:'[K] · 두 선의 간격이 방열 여유', series:[
      {t:s.t, v:s.proc, c:'#ff9f40', name:'공정온도'}, {t:s.t, v:s.air, c:'#4dabf7', name:'공기온도'}],
      fills: hot.map(i => [i, i+1, '#ffd23f']), marks}),
    chart({label:'스핀들 회전수', unit:'[rpm]', series:[{t:s.t, v:s.rpm, c:'#e6e9ef'}],
      limits:[{v:1380, c:'#ffd23f', t:'1380 방열 판정선'}], marks, fills}),
    chart({label:'스핀들 부하 토크', unit:'[Nm] · 점선은 마모에 따라 내려가는 허용 한계', series:[
      {t:s.t, v:s.torque, c:'#e6e9ef'}, {t:s.t, v:s.wear.map(w => lim / w), c:'#ff9f40', dyn:1, name:'허용 한계'}], marks, fills}),
    chart({label:'스핀들 소비전력', unit:'[W]', series:[{t:s.t, v:s.power, c:'#e6e9ef'}],
      limits:[{v:9000, c:'#ff5252', t:'9000 상한'}, {v:3500, c:'#ffd23f', t:'3500 하한'}], marks, fills}),
    chart({label:'블레이드 마모 누적', unit:'[min]', series:[{t:s.t, v:s.wear, c:'#e6e9ef'}],
      limits:[{v:200, c:'#ff5252', t:'200 경보'}, {v:180, c:'#ff9f40', t:'180 주의'}], marks, fills}),
  ].join('');
}

function renderLog() {
  const d = S[day];
  const legend = `<div class="legend">` + Object.entries(GRADE_KO).map(([k,v]) =>
    `<span><i style="background:${COL[k]}"></i>${v} (${k})</span>`).join('') + `</div>`;
  let rows;
  if (logv === 'alarm') {
    rows = d.alarms.map(a => {
      const sub = a.sub.length ? `<p>파생 알람 ${a.sub.length}건 동반 — ${[...new Set(a.sub.map(x => x.ko))].join(', ')}</p>` : '';
      const blk = a.blocked ? ` <span class="pill blk">센서 신뢰 불가</span>` : '';
      return `<div class="row"><span class="led ${a.grade}"></span><span class="tm">${a.time}</span>
        <span class="t"><b>${a.ko}</b><i>${a.eqp}</i>${blk}${sub}</span>
        <span class="r">${a.value} · ${a.repeat}회 지속<br>~${a.end}</span></div>`;
    }).join('');
  } else {
    rows = d.actions.map(c => {
      const a = d.alarms.find(x => x.id === c.alarm_id);
      return `<div class="row"><span class="led ${c.grade}"></span><span class="tm">${c.time}</span>
        <span class="t"><b>${c.act}</b><i>${c.eqp}</i>
        <span class="pill ${c.auto ? 'auto' : 'man'}">${c.auto ? '자동 실행' : '사람 확인 필요'}</span>
        <p>${c.why}</p><p>연결 알람 ${a ? a.ko : ''} · ${c.alarm_id}</p></span>
        <span class="r">${c.result}</span></div>`;
    }).join('');
  }
  $('#log').innerHTML = legend + rows;
  $('#na').textContent = d.alarms.length; $('#nc').textContent = d.actions.length;
}

function render() {
  const d = S[day], st = d.stats;
  document.querySelectorAll('#days button').forEach((b,i) => b.classList.toggle('on', i === day));
  $('#title').textContent = `${d.date} · ${d.title}`;
  $('#brief').textContent = d.brief;
  $('#kpi').innerHTML = [
    ['원시 알람', st.raw, '임계 초과 시점 전체'],
    ['근본원인 집약', st.grouped, `압축률 ${(100 - st.grouped/st.raw*100).toFixed(0)}%`],
    ['자동조치 완료', st.auto, '가역 조치만 실행'],
    ['사람 확인 필요', st.manual, '비가역·손상 위험'],
    ['센서 이상 차단', st.blocked, '오조치 방지'],
  ].map(([k,v,s]) => `<div><span>${k}</span><b>${v}</b><small>${s}</small></div>`).join('');
  $('#eqps').innerHTML = d.equipments.map((e,i) =>
    `<button class="${i===eqp?'on':''}" data-i="${i}">${e.id} <span style="opacity:.6">(${e.type}등급)</span></button>`).join('');
  renderCharts(); renderLog();
}

// ── 초기화 ────────────────────────────────────────────
$('#days').innerHTML = S.map((d,i) =>
  `<button data-i="${i}"><b>${d.date.slice(5)}</b><span>${d.title}</span></button>`).join('');
$('#days').onclick = e => { const b = e.target.closest('button'); if (!b) return; day = +b.dataset.i; eqp = 0; render(); };
$('#eqps').onclick = e => { const b = e.target.closest('button'); if (!b) return; eqp = +b.dataset.i;
  document.querySelectorAll('#eqps button').forEach((x,i) => x.classList.toggle('on', i === eqp)); renderCharts(); };
$('#logtabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; logv = b.dataset.v;
  document.querySelectorAll('#logtabs button').forEach(x => x.classList.toggle('on', x === b)); renderLog(); };
render();
