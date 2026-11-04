'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 핀 뽑기 퍼즐: 화면·입력·소리. 규칙은 logic.js (LOGIC_PIN).
const P = LOGIC_PIN;
const $ = (id) => document.getElementById(id);
const W = 360, H = 640;
const canvas = $('game'), ctx = canvas.getContext('2d');
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};
const TICK = 0.09;

function loadStars() { try { const a = JSON.parse(store.get('pinpullStars') || '[]'); return P.LEVELS.map((_, i) => (a[i] > 0 ? Math.min(3, a[i] | 0) : 0)); } catch (_) { return P.LEVELS.map(() => 0); } }
let stars = loadStars();
function saveStars() { store.set('pinpullStars', JSON.stringify(stars)); store.set('pinpullBest', String(stars.reduce((a, b) => a + b, 0))); }

let audio = null, muted = store.get('pinpullMuted') === '1';
function ac() { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); return audio; } catch (_) { return null; } }
function tone(freq, dur, type = 'triangle', vol = 0.05, slide = 0) {
  if (muted) return;
  const a = ac(); if (!a) return;
  try {
    const o = a.createOscillator(), g = a.createGain(), t = a.currentTime;
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  } catch (_) {}
}
const sfx = {
  pull() { tone(900, 0.12, 'square', 0.05, -500); },
  star() { tone(880, 0.1, 'sine', 0.06, 400); },
  win() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.18, 'triangle', 0.07), i * 90)); },
  dead() { tone(300, 0.4, 'sawtooth', 0.06, -220); },
  bad() { tone(180, 0.1, 'square', 0.04); },
  undo() { tone(420, 0.08, 'triangle', 0.04, -140); },
};
const vibe = (p) => { try { if (window.arcadeVibe) window.arcadeVibe(p); } catch (_) {} };   // 진동: 로비의 진동 설정을 따른다
function toggleMute() { muted = !muted; store.set('pinpullMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }
$('muteBtn').textContent = muted ? '🔇' : '🔊';

let G = null, levelIdx = 0, mode = 'title', acc = 0, slides = [], hintId = null, hintT = 0, msg = '', msgT = 0, finishT = 0, anim = 0, usedHint = false;

/* @test-hooks:start */
window.__pp = { get G() { return G; }, get mode() { return mode; }, get stars() { return stars; }, P, step: (dt) => update(dt), draw: () => draw(), load: (i) => loadLevel(i), geom: () => geom(), tapPin: (id) => pullPin(id) };
/* @test-hooks:end */

function showOverlay(html, cls = '') {
  const o = $('overlay'); o.innerHTML = html; o.className = cls; $('bar').classList.add('hidden');
  o.querySelectorAll('button[data-level]').forEach((b) => { b.onclick = () => { if (!b.classList.contains('lock')) loadLevel(+b.dataset.level); }; });
  o.querySelectorAll('button[data-act]').forEach((b) => { b.onclick = () => act(b.dataset.act); });
}
function hideOverlay() { $('overlay').className = 'hidden'; $('bar').classList.remove('hidden'); }
function showTitle() {
  mode = 'title'; G = null;
  const total = stars.reduce((a, b) => a + b, 0);
  showOverlay(`<h1>핀 뽑기<br>퍼즐</h1><div class="big">📌 🙂 💰</div>
    <p>핀을 눌러 뽑아서 <b>영웅</b>이 <b>보물</b>까지<br>떨어지게 해 주세요</p>
    <p class="help">🔥 용암에 닿거나 🪨 바위에 깔리면 끝!<br>핀을 뽑는 <b>순서</b>가 열쇠예요</p>
    ${total ? `<p class="note">모은 별 ⭐ ${total} / ${P.LEVELS.length * 3}</p>` : ''}
    <button class="start" data-act="levels">시작하기</button>`);
}
function showLevels() {
  mode = 'levels'; G = null;
  const items = P.LEVELS.map((lv, i) => { const open = i === 0 || stars[i - 1] > 0 || stars[i] > 0; return `<button data-level="${i}" class="${open ? '' : 'lock'}">${open ? lv.id : '🔒'}<small>${'⭐'.repeat(stars[i])}</small></button>`; }).join('');
  showOverlay(`<h2>단계 고르기</h2><div class="grid">${items}</div><p class="note">앞 단계를 깨면 다음 단계가 열려요</p>`);
}
function act(a) {
  if (a === 'levels') showLevels(); else if (a === 'title') showTitle();
  else if (a === 'retry') loadLevel(levelIdx);
  else if (a === 'next') loadLevel(Math.min(P.LEVELS.length - 1, levelIdx + 1));
}
function loadLevel(i) {
  levelIdx = i; G = P.begin(P.LEVELS[i]); mode = 'play'; acc = 0; slides = []; hintId = null; msg = ''; finishT = 0; usedHint = false;
  hideOverlay(); syncBar();
}
function syncBar() {
  if (!G) return;
  $('btnUndo').disabled = !G.seq.length; $('btnHint').disabled = G.over || !G.settled;
}
$('menuBtn').onclick = () => showLevels();
$('btnReset').onclick = () => { if (G) { loadLevel(levelIdx); sfx.undo(); } };
$('btnUndo').onclick = undo;
function undo() {
  if (!G || !G.seq.length) return;
  const seq = G.seq.slice(0, -1), lv = P.LEVELS[levelIdx];
  hideOverlay(); finishT = 0; mode = 'play';
  G = P.begin(lv); for (const id of seq) { P.pull(G, id); P.settle(G); }
  slides = []; hintId = null; msg = ''; sfx.undo(); syncBar();
}
$('btnHint').onclick = () => {
  if (!G || G.over || !G.settled) return;
  const h = P.hint(G); usedHint = true;
  if (h === null) { msg = '이 상태에서는 이길 수 없어요. 되돌려 보세요'; msgT = 3; hintId = null; }
  else { hintId = h; hintT = 3.5; msg = '💡 반짝이는 핀을 뽑아 보세요'; msgT = 3; }
  tone(660, 0.12, 'sine', 0.05, 200);
};

// ---------- 칸과 입력 ----------
function geom() {
  const rows = G ? G.rows : 12, cs = Math.floor(Math.min(40, 470 / rows)), ox = Math.round((W - cs * P.COLS) / 2), oy = 78 + Math.round((470 - cs * rows) / 2);
  return { cs, ox, oy, rows };
}
function pos(e) { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H]; }
function pinAt(x, y) {
  const g = geom(); let best = -1, bd = g.cs * 0.95;
  for (const p of G.level.pins) for (const i of p.cells) {
    if (G.pinOf[i] !== p.id) continue;
    const cx = g.ox + (i % P.COLS + 0.5) * g.cs, cy = g.oy + (Math.floor(i / P.COLS) + 0.5) * g.cs, d = Math.hypot(x - cx, y - cy);
    if (d < bd) { bd = d; best = p.id; }
  }
  return best;
}
canvas.addEventListener('pointerdown', (e) => {
  if (mode !== 'play' || !G || G.over) return;
  const [x, y] = pos(e), id = pinAt(x, y);
  if (id >= 0) pullPin(id); e.preventDefault();
});
function pullPin(id) {
  if (!G || G.over) return;
  if (!G.settled) { sfx.bad(); return; }
  const cells = G.level.pins[id].cells.slice(), g = geom();
  if (!P.pull(G, id)) return;
  const cx = cells.reduce((a, i) => a + (i % P.COLS), 0) / cells.length;
  slides.push({ cells, dir: cx < 4 ? -1 : 1, t: 0 });
  hintId = null; msg = ''; sfx.pull(); tutorialSignal('pull'); syncBar();
}
addEventListener('keydown', (e) => { if (e.key === 'z' || e.key === 'Z') undo(); else if (e.key === 'r' || e.key === 'R') $('btnReset').click(); else if (e.key === 'm' || e.key === 'M') toggleMute(); });
function fit() { const s = Math.min(innerWidth / W, innerHeight / H); canvas.style.width = `${Math.floor(W * s)}px`; canvas.style.height = `${Math.floor(H * s)}px`; $('wrap').style.width = canvas.style.width; $('wrap').style.height = canvas.style.height; }
addEventListener('resize', fit); fit();
$('muteBtn').onclick = toggleMute;

// ---------- 갱신 ----------
const WHY = { lava: '용암에 닿았어요! 🔥', crush: '바위에 깔렸어요! 🪨', stuck: '더 뽑을 핀이 없어요' };
function update(dt) {
  anim += dt;
  if (msgT > 0) { msgT -= dt; if (msgT <= 0) msg = ''; }
  if (hintT > 0) { hintT -= dt; if (hintT <= 0) hintId = null; }
  for (const s of slides) s.t += dt;
  slides = slides.filter((s) => s.t < 0.3);
  if (!G || mode !== 'play') return;
  if (!G.over && !G.settled) {
    acc += dt;
    while (acc >= TICK && !G.settled && !G.over) { acc -= TICK; P.tick(G); }
  }
  while (G.events.length) {
    const ev = G.events.shift();
    if (ev.type === 'star') sfx.star();
    else if (ev.type === 'win') { sfx.win(); vibe([30, 30, 60]); tutorialSignal('win'); onWin(); }
    else if (ev.type === 'dead') { sfx.dead(); vibe([80, 40, 80]); tutorialSignal('dead'); msg = WHY[ev.why] || '실패'; msgT = 2; finishT = 0.9; }
  }
  if (G.over && !G.win && finishT > 0) { finishT -= dt; if (finishT <= 0) showFail(); }
  if (G.settled) syncBar();
}
function onWin() {
  const lv = P.LEVELS[levelIdx], s = P.starsFor(G, lv.par, lv.starTotal);
  if (s > stars[levelIdx]) { stars[levelIdx] = s; saveStars(); }
  mode = 'clear';
  setTimeout(() => { if (mode !== 'clear') return; const last = levelIdx >= P.LEVELS.length - 1;
    showOverlay(`<h2>${last ? '모든 단계 완료! 🎉' : '성공! 🎉'}</h2><div class="big">${'⭐'.repeat(s)}${'☆'.repeat(3 - s)}</div>
      <p class="help">핀 ${G.seq.length}개 (기준 ${lv.par}개)${lv.starTotal ? ` · 별 ${G.got}/${lv.starTotal}` : ''}<br>${s < 3 && lv.starTotal ? '별을 다 모으면서 기준 개수로 풀면 ⭐⭐⭐' : s < 3 ? '기준 개수로 풀면 ⭐⭐⭐' : '완벽해요!'}</p>
      ${last ? '' : '<button data-act="next">다음 단계</button>'}
      <div class="row"><button class="sub" data-act="retry">다시 하기</button><button class="sub" data-act="levels">단계 고르기</button></div>`, 'clear'); }, 900);
}
function showFail() {
  mode = 'fail';
  showOverlay(`<h2>${WHY[G.why] || '실패'}</h2><p class="help">핀을 뽑는 순서를 바꿔 보세요</p>
    <button data-act="retry">다시 하기</button><div class="row"><button class="sub" id="failUndo">↶ 한 수 되돌리기</button><button class="sub" data-act="levels">단계 고르기</button></div>`, 'clear');
  const u = $('failUndo'); if (u) u.onclick = undo;
}

// ---------- 그리기 ----------
function cellXY(i) { const g = geom(); return [g.ox + (i % P.COLS) * g.cs, g.oy + Math.floor(i / P.COLS) * g.cs]; }
function draw() {
  const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#2b2240'); bg.addColorStop(1, '#171126');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  if (!G) return;
  const g = geom(), cs = g.cs;
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(g.ox, g.oy, cs * P.COLS, cs * G.rows);
  for (let i = 0; i < G.grid.length; i++) {
    const t = G.grid[i], [x, y] = cellXY(i);
    if (t === P.WALL) { ctx.fillStyle = '#4b3d6b'; ctx.fillRect(x, y, cs, cs); ctx.fillStyle = '#5d4e82'; ctx.fillRect(x + 1, y + 1, cs - 2, cs / 2 - 1); ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.strokeRect(x + .5, y + .5, cs - 1, cs - 1); }
    else if (t === P.LAVA) { ctx.fillStyle = '#ff6a2a'; ctx.fillRect(x + 1, y + 1, cs - 2, cs - 2); ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.arc(x + cs * (0.35 + 0.3 * Math.sin(anim * 3 + i)), y + cs * 0.4, cs * 0.14, 0, 7); ctx.fill(); }
    else if (t === P.BOULDER) { ctx.fillStyle = '#8d8d98'; ctx.beginPath(); ctx.arc(x + cs / 2, y + cs / 2, cs * 0.46, 0, 7); ctx.fill(); ctx.fillStyle = '#a8a8b4'; ctx.beginPath(); ctx.arc(x + cs * 0.38, y + cs * 0.38, cs * 0.16, 0, 7); ctx.fill(); }
    else if (t === P.TREASURE || t === P.HERO || t === P.STAR) {
      ctx.font = `${Math.round(cs * 0.86)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
      ctx.fillText(t === P.TREASURE ? '💰' : t === P.HERO ? (G.over && !G.win ? '😵' : G.win ? '😎' : '🙂') : '⭐', x + cs / 2, y + cs / 2 + 2);
    }
  }
  // 핀 (뽑는 중인 핀은 옆으로 밀려 나가며 사라진다)
  for (const p of G.level.pins) {
    const live = G.pinOf[p.cells[0]] === p.id;
    if (!live) continue;
    const hint = hintId === p.id, pulse = hint ? 0.5 + 0.5 * Math.sin(anim * 8) : 0;
    const xs = p.cells.map((i) => i % P.COLS), ys = p.cells.map((i) => Math.floor(i / P.COLS));
    const x0 = g.ox + Math.min(...xs) * cs, y0 = g.oy + Math.min(...ys) * cs, w = (Math.max(...xs) - Math.min(...xs) + 1) * cs, h = (Math.max(...ys) - Math.min(...ys) + 1) * cs;
    ctx.fillStyle = hint ? `rgb(${190 + pulse * 60},${200 + pulse * 55},${120})` : '#c9d2dc'; ctx.fillRect(x0 + 1, y0 + cs * 0.22, w - 2, h - cs * 0.44);
    ctx.fillStyle = hint ? '#fff7a8' : '#e8eef4'; ctx.fillRect(x0 + 1, y0 + cs * 0.22, w - 2, (h - cs * 0.44) * 0.4);
    ctx.fillStyle = '#7d8793'; ctx.beginPath(); ctx.arc(x0 + w - cs * 0.3, y0 + h / 2, cs * 0.2, 0, 7); ctx.fill();            // 손잡이
    ctx.fillStyle = '#222'; ctx.font = `800 ${Math.round(cs * 0.4)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(p.label, x0 + w / 2, y0 + h / 2 + 1);
  }
  for (const s of slides) {
    const k = s.t / 0.3; ctx.globalAlpha = 1 - k;
    for (const i of s.cells) { const [x, y] = cellXY(i); ctx.fillStyle = '#c9d2dc'; ctx.fillRect(x + s.dir * k * cs * 3 + 1, y + cs * 0.22, cs - 2, cs * 0.56); }
    ctx.globalAlpha = 1;
  }
  // 위쪽 표시
  const lv = P.LEVELS[levelIdx];
  ctx.fillStyle = 'rgba(8,6,16,.7)'; ctx.fillRect(0, 0, W, 60);
  ctx.fillStyle = '#fff'; ctx.font = '900 16px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(`${lv.id}단계`, 12, 20);
  ctx.font = '700 12px sans-serif'; ctx.fillStyle = '#c4b8d8';
  if (msg) { ctx.font = '800 13px sans-serif'; ctx.fillStyle = '#ffe9a8'; ctx.fillText(msg, 12, 42); }
  else if (G.settled && !G.over && G.seq.length === 0) { ctx.fillStyle = '#ffffff'; ctx.fillText('핀(회색 막대)을 눌러 뽑아요', 12, 42); }
  else ctx.fillText(`핀 ${G.seq.length}개 뽑음 · 기준 ${lv.par}개${lv.starTotal ? ` · ⭐ ${G.got}/${lv.starTotal}` : ''}`, 12, 42);
}
let lastTs = 0;
function frame(ts) { const dt = Math.min(0.05, (ts - (lastTs || ts)) / 1000); lastTs = ts; update(dt); draw(); requestAnimationFrame(frame); }
showTitle();
requestAnimationFrame(frame);
