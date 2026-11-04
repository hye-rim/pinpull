'use strict';
// 핀 뽑기 퍼즐: 규칙만 (DOM 없음). 화면·입력·소리는 game.js.
// 영웅과 용암·바위가 핀에 막혀 있다. 핀을 뽑는 순서를 정해 영웅이 용암에 닿지 않고 보물까지 떨어지게 한다.
// 칸 단위로 천천히 떨어지는 단순한 물리라서, 같은 순서로 뽑으면 항상 같은 결과가 나온다(풀이를 계산으로 검증할 수 있다).
(function (root) {
  const COLS = 9;
  const EMPTY = 0, WALL = 1, PIN = 2, HERO = 3, TREASURE = 4, LAVA = 5, BOULDER = 6, STAR = 7;
  const CH = { '#': WALL, '.': EMPTY, H: HERO, T: TREASURE, L: LAVA, B: BOULDER, '*': STAR };
  const MAX_TICKS = 500;

  // 단계: 풀이 계산으로 모두 풀 수 있음을 확인한 판 (par = 별을 다 모으며 이기는 가장 짧은 핀 수)
  const LEVEL_DATA = [
  { par: 1, stars: 0, rows: ["#########", "#...H...#", "#..111..#", "#.......#", "#.......#", "#...T...#", "#########"] },
  { par: 1, stars: 0, rows: ["#########", "#.LL....#", "#.222...#", "#...H...#", "#..111..#", "#.......#", "#...T...#", "#########"] },
  { par: 1, stars: 2, rows: ["#########", "#...*...#", "#...H...#", "#..111..#", "#.......#", "#.......#", "#..*.T..#", "#########"] },
  { par: 2, stars: 1, rows: ["#########", "#....L..#", "#..H..L.#", "##1122###", "#.*.....#", "#L......#", "#333#####", "#.T.....#", "#########"] },
  { par: 2, stars: 2, rows: ["#########", "#...*.L.#", "#.L.H...#", "####111##", "#..*....#", "#LL...B.#", "####22###", "#..T....#", "#########"] },
  { par: 2, stars: 2, rows: ["#########", "#....*..#", "#L.LBH..#", "####111##", "#....*..#", "#.......#", "###222###", "#...T...#", "#########"] },
  { par: 3, stars: 1, rows: ["#########", "#.......#", "#.LL.BH.#", "#####111#", "#.......#", "#L.L...B#", "###33222#", "#....*..#", "#...L...#", "####5544#", "#......T#", "#########"] },
  { par: 3, stars: 1, rows: ["#########", "#.......#", "#.H.....#", "##111####", "#.......#", "#.......#", "#22######", "#.*..L..#", "#...BLL.#", "##333####", "#T......#", "#########"] },
  { par: 3, stars: 2, rows: ["#########", "#...*...#", "#...H...#", "###111###", "#.......#", "#B......#", "##222####", "#..*....#", "#....BL.#", "#44#33###", "#..T....#", "#########"] },
  { par: 3, stars: 2, rows: ["#########", "#.......#", "#.H....L#", "#111#####", "#.*.....#", "#......L#", "##22#####", "#*......#", "#..BL...#", "#333#####", "#T......#", "#########"] },
  { par: 4, stars: 3, rows: ["#########", "#..*..L.#", "#..HBL..#", "##11122##", "#...*...#", "#....L.L#", "###33####", "#.......#", "#.......#", "##444####", "#.*.....#", "#.......#", "###55####", "#.T.....#", "#########"] },
  { par: 4, stars: 1, rows: ["#########", "#.......#", "#..L..HB#", "#####111#", "#..L...*#", "#..LL..B#", "#####22##", "#.......#", "#.L.....#", "#####33##", "#.......#", "#......B#", "####444##", "#....T..#", "#########"] }
  ];

  // ---------- 지도 읽기 ----------
  // 줄마다 9글자. #벽 .빈칸 H영웅 T보물 L용암 B바위 *별 1~9 핀(같은 숫자가 이어진 칸이 한 핀)
  function parse(rows) {
    const R = rows.length, grid = new Uint8Array(COLS * R), pinOf = new Int8Array(COLS * R).fill(-1), pins = [];
    const ids = new Map();
    rows.forEach((row, y) => {
      if (row.length !== COLS) throw new Error('row ' + y + ' length ' + row.length);
      for (let x = 0; x < COLS; x++) {
        const c = row[x], i = y * COLS + x;
        if (c >= '1' && c <= '9') { grid[i] = PIN; if (!ids.has(c)) { ids.set(c, pins.length); pins.push({ id: pins.length, label: c, cells: [] }); } const p = ids.get(c); pinOf[i] = p; pins[p].cells.push(i); }
        else if (CH[c] !== undefined) grid[i] = CH[c]; else throw new Error('bad char ' + c);
      }
    });
    const stars = Array.from(grid).filter((v) => v === STAR).length;
    return { cols: COLS, rows: R, grid, pinOf, pins, stars };
  }
  const clone = (lv) => ({ grid: Uint8Array.from(lv.grid), pinOf: Int8Array.from(lv.pinOf) });

  function newGame(level) {
    const c = clone(level), hero = c.grid.indexOf(HERO);
    return { level, cols: COLS, rows: level.rows, grid: c.grid, pinOf: c.pinOf, pulled: new Set(), seq: [], got: 0, over: false, win: false, why: null, settled: false, ticks: 0, events: [], hero };
  }
  const idx = (x, y) => y * COLS + x;
  const inb = (st, x, y) => x >= 0 && x < COLS && y >= 0 && y < st.rows;
  const at = (st, x, y) => (inb(st, x, y) ? st.grid[idx(x, y)] : WALL);

  // 핀을 뽑는다. 다 멈춘 뒤에만 뽑을 수 있다.
  function pull(st, id) {
    if (st.over || !st.settled || !Number.isInteger(id) || id < 0 || id >= st.level.pins.length || st.pulled.has(id)) return false;
    for (const i of st.level.pins[id].cells) { st.grid[i] = EMPTY; st.pinOf[i] = -1; }
    st.pulled.add(id); st.seq.push(id); st.settled = false; st.events.push({ type: 'pull', id });
    return true;
  }
  // 한 칸씩 떨어뜨린다. 움직임이 있었는지 알려 준다.
  function tick(st) {
    if (st.over) return false;
    st.ticks++;
    const R = st.rows, moved = new Uint8Array(COLS * R); let any = false;
    const heroIdx = () => st.grid.indexOf(HERO);
    const die = (why) => { if (!st.over) { st.over = true; st.why = why; st.events.push({ type: 'dead', why }); } };
    for (let y = R - 2; y >= 0; y--) for (let x = 0; x < COLS; x++) {
      const i = idx(x, y), t = st.grid[i];
      if (moved[i] || (t !== HERO && t !== BOULDER && t !== LAVA)) continue;
      const below = at(st, x, y + 1), bi = idx(x, y + 1);
      if (t === HERO) {
        if (below === EMPTY || below === STAR) { if (below === STAR) { st.got++; st.events.push({ type: 'star' }); } st.grid[bi] = HERO; st.grid[i] = EMPTY; moved[bi] = 1; any = true; }
        else if (below === LAVA) die('lava');
      } else if (t === BOULDER) {
        if (below === EMPTY) { st.grid[bi] = BOULDER; st.grid[i] = EMPTY; moved[bi] = 1; any = true; }
        else if (below === HERO && moved[i] !== 2) { die('crush'); }
      } else {                                                                   // 용암
        if (below === EMPTY) { st.grid[bi] = LAVA; st.grid[i] = EMPTY; moved[bi] = 1; any = true; }
        else if (below === HERO) die('lava');
        else {
          const order = ((x + y + st.ticks) & 1) ? [-1, 1] : [1, -1];
          for (const dx of order) {
            if (at(st, x + dx, y) === EMPTY && at(st, x + dx, y + 1) === EMPTY) { const ni = idx(x + dx, y + 1); st.grid[ni] = LAVA; st.grid[i] = EMPTY; moved[ni] = 1; any = true; break; }
          }
        }
      }
    }
    // 영웅 주변 확인: 용암이 붙어 있으면 타고, 보물이 붙어 있으면 이긴다
    const h = heroIdx();
    if (h >= 0 && !st.over) {
      const hx = h % COLS, hy = Math.floor(h / COLS);
      st.hero = h;
      const near = [at(st, hx - 1, hy), at(st, hx + 1, hy), at(st, hx, hy - 1), at(st, hx, hy + 1)];
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { const nx = hx + dx, ny = hy + dy; if (inb(st, nx, ny) && st.grid[idx(nx, ny)] === STAR) { st.grid[idx(nx, ny)] = EMPTY; st.got++; st.events.push({ type: 'star' }); } }
      if (near.includes(LAVA)) die('lava');
      else if (near.includes(TREASURE)) { st.over = true; st.win = true; st.events.push({ type: 'win', got: st.got, pulls: st.seq.length }); }
    }
    if (!any && !st.over) {
      st.settled = true;
      if (st.pulled.size >= st.level.pins.length) { st.over = true; st.why = 'stuck'; st.events.push({ type: 'dead', why: 'stuck' }); }
    }
    return any;
  }
  // 다 멈출 때까지 돌린다 (시험·풀이용)
  function settle(st) { for (let i = 0; i < MAX_TICKS && !st.settled && !st.over; i++) tick(st); return st; }
  // 시작 직후 한 번 돌려서 멈춘 상태로 만든다
  function begin(level) { const st = newGame(level); settle(st); return st; }

  // ---------- 풀이: 핀을 뽑는 모든 순서를 시험 ----------
  function copy(st) { return { level: st.level, cols: COLS, rows: st.rows, grid: Uint8Array.from(st.grid), pinOf: Int8Array.from(st.pinOf), pulled: new Set(st.pulled), seq: st.seq.slice(), got: st.got, over: st.over, win: st.win, why: st.why, settled: st.settled, ticks: st.ticks, events: [], hero: st.hero }; }
  function solve(level, limit = 200000) {
    const start = begin(level), wins = [], all = { n: 0 };
    (function go(st) {
      if (all.n++ > limit) return;
      if (st.over) { if (st.win) wins.push({ seq: st.seq.slice(), got: st.got }); return; }
      for (let id = 0; id < level.pins.length; id++) {
        if (st.pulled.has(id)) continue;
        const s2 = copy(st); pull(s2, id); settle(s2); go(s2);
      }
    })(start);
    return wins;
  }
  // 다음에 뽑으면 이기는 길이 이어지는 핀 (힌트)
  function hint(st) {
    if (st.over || !st.settled) return null;
    let best = null;
    for (let id = 0; id < st.level.pins.length; id++) {
      if (st.pulled.has(id)) continue;
      const s2 = copy(st); pull(s2, id); settle(s2);
      const wins = []; (function go(s) { if (s.over) { if (s.win) wins.push(s.seq.length); return; } for (let k = 0; k < s.level.pins.length; k++) { if (s.pulled.has(k)) continue; const t = copy(s); pull(t, k); settle(t); go(t); } })(s2);
      if (wins.length) { const m = Math.min(...wins); if (!best || m < best.len) best = { id, len: m }; }
    }
    return best ? best.id : null;
  }
  const starsFor = (st, par, allStars) => (!st.win ? 0 : 1 + (st.got >= allStars ? 1 : 0) + (st.seq.length <= par && st.got >= allStars ? 1 : 0));

  const LEVELS = LEVEL_DATA.map((d, i) => Object.assign({ id: i + 1, map: d.rows }, parse(d.rows), { par: d.par, starTotal: d.stars }));
  const api = { LEVELS, COLS, EMPTY, WALL, PIN, HERO, TREASURE, LAVA, BOULDER, STAR, parse, newGame, begin, pull, tick, settle, copy, solve, hint, starsFor, at, idx };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LOGIC_PIN = api;
})(typeof window !== 'undefined' ? window : globalThis);
