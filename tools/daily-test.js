#!/usr/bin/env node
/* 每日挑战 / 成就 / 暂停快照 的回归测试。
 *
 * 和 mode-test.js 同一套打桩 DOM，只是钩子多挂了几个口子：
 *  - startDaily(key)：直接指定日期，避免测试依赖「今天几号」
 *  - plats()：把平台序列（位置/宽度/弹簧/摆动）导出来做等比断言
 *  - landSpring()：造一根弹簧柱直接调 doLand()，测弹簧分支的连击统计
 *  - over()：直接结束一局，测成就和每日成绩落盘
 *
 * 用法：node tools/daily-test.js [jump/index.html]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { createEnv, runScript, makeCanvas, counters } = require(path.join(__dirname, 'dom-stub.js'));

const FILE = process.argv[2] || path.join(__dirname, '..', 'jump', 'index.html');

const HOOK = `
window.__dbg = {
  today: todayKey,
  startDaily: startDaily,
  daily: function () { return { key: dailyKey, mode: modeKey, best: dailyBest }; },
  plats: function () {
    return platforms.map(function (p) {
      return [Math.round(p.baseX), Math.round(p.w), p.spring ? 1 : 0, p.sway ? 1 : 0];
    });
  },
  score: function () { return score; },
  best: function () { return best; },
  stats: function () {
    return { runs: STATS.runs, perfects: STATS.perfects, springs: STATS.springs,
             rescues: STATS.rescues, dailyRuns: STATS.dailyRuns };
  },
  ach: function (id) { return !!achUnlocked[id]; },
  achCount: achCount,
  achTotal: function () { return ACHS.length; },
  landSpring: function (perfect) {
    const p = { x: 100, baseX: 100, w: 100, squash: 0, spring: true, sway: null,
                sprite: null, spriteH: 0, glow: 0 };
    platforms.push(p);
    player.x = perfect ? p.x + p.w / 2 : p.x + 6;
    player.state = 'jump';
    doLand(p, topY(), false);
    return { combo: combo, maxCombo: maxCombo, springCount: springCount, score: score };
  },
  over: function () { gameOver(); },
  pause: togglePause,
  snap: function () { return { gs: gameState, snapshot: !!pauseSnap }; }
};
`;

function buildEnv(seed) {
  const env = createEnv({ W: 412, H: 915, dpr: 3 });
  const doc = env.sandbox.document;
  const emptyEl = () => ({
    style: {}, classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, focus() {}, select() {}, blur() {},
    value: '', appendChild() {}, removeChild() {}, click() {},
    getContext() { return null; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 150 }; }
  });
  const cache = new Map();
  const byId = doc.getElementById.bind(doc);
  doc.getElementById = (id) => {
    const known = byId(id);
    if (known) return known;
    if (!cache.has(id)) cache.set(id, emptyEl());
    return cache.get(id);
  };
  doc.createElement = (tag) => (tag === 'canvas' ? makeCanvas(300, 150) : emptyEl());
  env.sandbox.location = { protocol: 'file:', href: 'file:///android_asset/jump/index.html' };
  env.sandbox.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
  let pending = [];
  env.sandbox.requestAnimationFrame = (fn) => { pending.push(fn); return 1; };
  env.pump = (n) => {
    for (let i = 0; i < n; i++) {
      const cbs = pending; pending = [];
      env.now += 16.7;
      for (const cb of cbs) cb(env.now);
    }
  };
  if (seed) for (const k in seed) env.store.set(k, String(seed[k]));
  return env;
}

function load(html, seed) {
  const env = buildEnv(seed);
  let js = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(m => !/\bsrc\s*=/.test(m[1])).map(m => m[2]).join('\n;\n');
  const patched = js.replace(/\}\)\(\);\s*$/, HOOK + '\n})();');
  runScript(env, patched === js ? js + '\n;' + HOOK : patched);
  env.pump(4);
  return env;
}

let bad = 0;
function ok(cond, msg, extra) {
  if (cond) return;
  bad++;
  console.log('  ✗ ' + msg + (extra === undefined ? '' : '  → ' + JSON.stringify(extra)));
}

const html = fs.readFileSync(FILE, 'utf8');
const label = path.basename(path.dirname(FILE)) + '/' + path.basename(FILE);

/* 1. 同一个日期 → 同一套平台；换日期 → 换一套 */
{
  const a = load(html); a.sandbox.__dbg.startDaily('2026-11-13'); a.pump(2);
  const b = load(html); b.sandbox.__dbg.startDaily('2026-11-13'); b.pump(2);
  const pa = a.sandbox.__dbg.plats();
  const pb = b.sandbox.__dbg.plats();
  ok(pa.length >= 5, '开局至少铺 5 根柱子', pa.length);
  ok(JSON.stringify(pa) === JSON.stringify(pb), '同一天两次开局，平台序列一模一样', { pa, pb });

  const c = load(html); c.sandbox.__dbg.startDaily('2026-11-14'); c.pump(2);
  ok(JSON.stringify(c.sandbox.__dbg.plats()) !== JSON.stringify(pa), '换一天平台就换一套');
  ok(!a.errors.length && !b.errors.length && !c.errors.length, '每日挑战无异常',
    a.errors.concat(b.errors, c.errors).slice(0, 1).map(e => e.msg));
}

/* 2. 难度跟着日期走（日期数字之和的奇偶），不是随机 */
{
  const a = load(html); a.sandbox.__dbg.startDaily('2026-11-13');      // 2+0+2+6+1+1+1+3 = 16 → 偶 → 简单
  const b = load(html); b.sandbox.__dbg.startDaily('2026-11-14');      // 17 → 奇 → 困难
  ok(a.sandbox.__dbg.daily().mode === 'easy', '偶数日和 = 简单模式', a.sandbox.__dbg.daily());
  ok(b.sandbox.__dbg.daily().mode === 'hard', '奇数日和 = 困难模式', b.sandbox.__dbg.daily());
}

/* 3. 每日成绩单独记，不动普通模式的最高分 */
{
  const env = load(html, { jf_best_easy: 50, jf_best_hard: 7 });
  const d = env.sandbox.__dbg;
  const today = d.today();
  d.startDaily(today);
  ok(d.daily().key === today, '进的是今天的挑战', d.daily());
  d.landSpring(true);
  d.over();
  env.pump(2);
  const sc = d.score();
  ok(sc > 0, '这局拿到了分', sc);
  ok(d.daily().best === sc, '今日最高分记上了', { best: d.daily().best, sc });
  const rec = JSON.parse(env.store.get('jf_daily_v1') || 'null');
  ok(rec && rec.d === today && rec.b === sc, '每日成绩写进了 localStorage', rec);
  ok(d.best() === 50, '普通模式最高分没被每日成绩带跑', d.best());
  ok(env.store.get('jf_best_easy') === '50', 'jf_best_easy 仍是 50', env.store.get('jf_best_easy'));
  ok(d.stats().dailyRuns === 1, '每日挑战次数 +1', d.stats());
}

/* 4. 弹簧上的完美落地也要计入最高连击（v1.3.0 修的 bug） */
{
  const env = load(html);
  const d = env.sandbox.__dbg;
  const r = d.landSpring(true);
  ok(r.springCount === 1, '弹簧柱计数 +1', r.springCount);
  ok(r.combo === 1, '完美落地连击 1', r.combo);
  ok(r.maxCombo === 1, '最高连击记到 1（以前这里漏了）', r);
  const r2 = d.landSpring(false);
  ok(r2.combo === 0, '歪着落弹簧会断连击', r2);
  const r3 = d.landSpring(true);
  ok(r3.springCount === 3, '踩满 3 个弹簧柱', r3.springCount);
  ok(d.ach('spring3'), '「弹簧信使」解锁', d.achCount());
  ok(d.stats().springs === 3, '累计弹簧数也在涨', d.stats());
}

/* 5. 成就：结束时判定、落盘、重载还在 */
{
  const env = load(html);
  const d = env.sandbox.__dbg;
  ok(d.achCount() === 0, '初始一个成就都没有', d.achCount());
  ok(d.achTotal() === 10, '一共 10 个成就', d.achTotal());
  d.over();
  env.pump(2);
  ok(d.ach('first_run'), '完成一局解锁「初来乍到」');
  ok(d.stats().runs === 1, '跨局统计 recorded', d.stats());
  const saved = JSON.parse(env.store.get('jf_ach_v1') || '[]');
  ok(saved.indexOf('first_run') >= 0, '成就写进了 localStorage', saved);

  const seed = {};
  seed.jf_ach_v1 = env.store.get('jf_ach_v1');
  seed.jf_stats_v1 = env.store.get('jf_stats_v1');
  const env2 = load(html, seed);
  ok(env2.sandbox.__dbg.ach('first_run'), '重载后成就还在');
  ok(env2.sandbox.__dbg.achCount() === d.achCount(), '重载后成就数量对得上');
  ok(!env2.errors.length, '重载无异常', env2.errors.slice(0, 1).map(e => e.msg));
}

/* 6. 暂停：走整屏快照，绘制量应该明显低于游戏中 */
{
  const env = load(html);
  const d = env.sandbox.__dbg;
  env.pump(4);
  const before = counters.drawImage;
  env.pump(12);
  const playing = counters.drawImage - before;

  d.pause();
  env.pump(1);
  ok(d.snap().gs === 'paused', '暂停成功', d.snap());
  ok(d.snap().snapshot === true, '暂停时存了整屏快照', d.snap());

  const before2 = counters.drawImage;
  env.pump(24);
  const paused = counters.drawImage - before2;
  ok(playing > 20, '游戏中 12 帧有足够的绘制量', playing);
  ok(paused * 4 < playing, '暂停后绘制量大幅下降（快照 + 30fps）', { playing, paused });
  ok(!env.errors.length, '暂停无异常', env.errors.slice(0, 1).map(e => e.msg));
}

if (bad) {
  console.log('✗ ' + label + '  ' + bad + ' 项失败');
  process.exit(1);
}
console.log('✓ ' + label + '  每日挑战种子 · 日期难度 · 成绩隔离 · 弹簧连击 · 成就落盘 · 暂停快照 全部正常');
