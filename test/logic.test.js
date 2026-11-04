'use strict';
const test = require('node:test');
const assert = require('node:assert');
const P = require('../logic.js');

const play = (rows, seq) => { const st = P.begin(P.parse(rows)); for (const id of seq) { assert.ok(P.pull(st, id), 'pull ' + id); P.settle(st); } return st; };

test('map parsing reads pins, stars and rejects bad maps', () => {
  const lv = P.parse(['#########', '#..*H...#', '#.11.22.#', '#...T...#', '#########']);
  assert.strictEqual(lv.pins.length, 2);
  assert.deepStrictEqual(lv.pins[0].cells.length, 2);
  assert.strictEqual(lv.stars, 1);
  assert.throws(() => P.parse(['#########', '#.......', '#########']));
  assert.throws(() => P.parse(['#########', '#...X...#']));
});

test('every level starts stable and nothing happens until a pin is pulled', () => {
  for (const lv of P.LEVELS) {
    const st = P.begin(lv);
    assert.ok(st.settled, 'level ' + lv.id);
    assert.strictEqual(st.over, false, 'level ' + lv.id);
    for (let i = 0; i < 20; i++) P.tick(st);
    assert.strictEqual(st.over, false, 'level ' + lv.id);
  }
});

test('hero falls to the treasure when the pin under him is pulled', () => {
  const st = play(P.LEVELS[0].map, [0]);
  assert.ok(st.over && st.win);
});

test('pulling the wrong pin first drops lava on the hero (level 2)', () => {
  const lv = P.LEVELS[1];
  const bad = play(lv.map, [0]);
  assert.ok(bad.over && !bad.win);
  assert.strictEqual(bad.why, 'lava');
  const good = play(lv.map, [1]);
  assert.ok(good.win);
});

test('pins can only be pulled once, only when everything has settled, and ids must exist', () => {
  const st = P.begin(P.parse(['#########', '#...H...#', '#..111..#', '#.......#', '#...T...#', '#########']));
  assert.strictEqual(P.pull(st, 5), false);
  assert.strictEqual(P.pull(st, -1), false);
  assert.strictEqual(P.pull(st, 0.5), false);
  assert.ok(P.pull(st, 0));
  assert.strictEqual(P.pull(st, 0), false);                     // 이미 뽑음
  assert.strictEqual(st.settled, false);
  P.tick(st);
  const lv2 = P.begin(P.LEVELS[3]);
  P.pull(lv2, 0);
  assert.strictEqual(P.pull(lv2, 1), false);                    // 아직 움직이는 중에는 못 뽑음
});

test('boulders crush the hero and lava burns him', () => {
  const crush = play(['#########', '#...B...#', '#..111..#', '#...H...#', '#..222..#', '#...T...#', '#########'], [0]);
  assert.ok(crush.over && !crush.win);
  assert.strictEqual(crush.why, 'crush');
  const burn = play(['#########', '#...L...#', '#..111..#', '#...H...#', '#..222..#', '#...T...#', '#########'], [0]);
  assert.strictEqual(burn.why, 'lava');
});

test('lava slides down diagonally and finally comes to rest', () => {
  const st = play(['#########', '#...L...#', '#...1...#', '#.......#', '#.......#', '#########'], [0]);
  assert.ok(st.settled);
  const cells = []; for (let i = 0; i < st.grid.length; i++) if (st.grid[i] === P.LAVA) cells.push(i);
  assert.strictEqual(cells.length, 1);
  assert.strictEqual(Math.floor(cells[0] / 9), 4);                 // 맨 아래 줄에 닿는다
});

test('stars are collected when the hero touches them and are needed for extra stars', () => {
  const lv = P.LEVELS[2];
  const w = P.solve(lv);
  assert.ok(w.some((x) => x.got >= lv.starTotal), 'all stars can be collected');
  const st = play(lv.map, w.find((x) => x.got >= lv.starTotal).seq);
  assert.ok(st.win);
  assert.strictEqual(P.starsFor(st, lv.par, lv.starTotal), 3);
});

test('running out of pins without reaching the treasure fails', () => {
  const st = play(['#########', '#...H...#', '#...1...#', '#.......#', '###T#####', '#########'], [0]);
  assert.ok(st.over);
});

test('every level can be solved and its stored par is the shortest all-stars solution', () => {
  for (const lv of P.LEVELS) {
    const wins = P.solve(lv);
    assert.ok(wins.length >= 1, 'level ' + lv.id);
    const best = wins.filter((w) => w.got >= lv.starTotal);
    assert.ok(best.length >= 1, 'all stars reachable in level ' + lv.id);
    assert.strictEqual(Math.min(...best.map((w) => w.seq.length)), lv.par, 'par level ' + lv.id);
  }
});

test('levels with two or more pins are not trivial: some pull orders fail', () => {
  for (const lv of P.LEVELS.filter((l) => l.pins.length >= 2)) {
    let lose = 0, total = 0;
    (function go(st) {
      if (st.over) { total++; if (!st.win) lose++; return; }
      for (let id = 0; id < lv.pins.length; id++) { if (st.pulled.has(id)) continue; const s = P.copy(st); P.pull(s, id); P.settle(s); go(s); }
    })(P.begin(lv));
    assert.ok(lose > 0, 'level ' + lv.id);
  }
});

test('hint points at a pin that keeps the win possible', () => {
  for (const lv of P.LEVELS) {
    const st = P.begin(lv), id = P.hint(st);
    assert.ok(id !== null, 'level ' + lv.id);
    const s2 = P.copy(st); P.pull(s2, id); P.settle(s2);
    if (!s2.over) assert.ok(P.hint(s2) !== null);
    else assert.ok(s2.win);
  }
});

test('the same moves always give the same result', () => {
  const lv = P.LEVELS[6], seq = P.solve(lv)[0].seq;
  const a = play(lv.map, seq), b = play(lv.map, seq);
  assert.deepStrictEqual(Array.from(a.grid), Array.from(b.grid));
});
