#!/usr/bin/env node
/* 勋章系统回归测试。
 *
 * 勋章有两块最容易写错的地方：
 *   1. 分数线：两种模式的门槛不一样，off-by-one 会让「刚好 25 分」拿不到银章
 *   2. 落盘：等级章是阶梯（拿到钻石，下面几级也该亮），特别章各管各的，
 *      重开页面之后必须还在
 *
 * 用法：node tools/medal-test.js [jump/index.html]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { createEnv, runScript, makeCanvas } = require(path.join(__dirname, 'dom-stub.js'));

const FILE = process.argv[2] || path.join(__dirname, '..', 'jump', 'index.html');

const HOOK = `
window.__dbg = {
  set: function (o) {
    if (o.mode) modeKey = o.mode;
    if (typeof o.score === 'number') score = o.score;
    if (typeof o.jumps === 'number') jumpCount = o.jumps;
    if (typeof o.perfects === 'number') perfectCount = o.perfects;
    if (typeof o.springs === 'number') springCount = o.springs;
    dailyKey = o.daily || null;
  },
  grade: runMedalGrade,
  need: medalNeedOf,
  award: awardMedals,
  state: function () { return JSON.parse(JSON.stringify(medalState)); },
  count: medalCount,
  total: medalTotal,
  last: function () { return lastRunMedal; },
  fresh: function () { return lastMedalNew.length; },
  openMedals: function () { gameState = 'paused'; medalOpen = true; drawMedals(); },
  openOver: function () { gameState = 'over'; drawOver(); },
  openSettings: function () { gameState = 'paused'; settingsOpen = true; drawSettings(); }
};
`;

function buildEnv(seed) {
  const env = createEnv({ W: 412, H: 915, dpr: 3 });
  const doc = env.sandbox.document;
  const emptyEl = () => ({
    style: {}, dataset: {}, value: '', textContent: '', innerHTML: '',
    classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, focus() {}, select() {}, blur() {},
    appendChild() {}, removeChild() {}, click() {},
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
  if (cond) { return; }
  bad++;
  console.log('  ✗ ' + msg + (extra === undefined ? '' : '  → ' + JSON.stringify(extra)));
}

const html = fs.readFileSync(FILE, 'utf8');
const label = path.basename(path.dirname(FILE)) + '/' + path.basename(FILE);

/* 1. 分数线 */
{
  const env = load(html);
  const d = env.sandbox.__dbg;

  const easy = [[0, 0], [9, 0], [10, 1], [24, 1], [25, 2], [44, 2], [45, 3], [79, 3], [80, 4], [119, 4], [120, 5], [999, 5]];
  for (const [sc, want] of easy) {
    d.set({ mode: 'easy', score: sc });
    ok(d.grade() === want, '简单 ' + sc + ' 分 → ' + want + ' 级', d.grade());
  }
  const hard = [[0, 0], [5, 0], [6, 1], [14, 1], [15, 2], [29, 2], [30, 3], [54, 3], [55, 4], [89, 4], [90, 5]];
  for (const [sc, want] of hard) {
    d.set({ mode: 'hard', score: sc });
    ok(d.grade() === want, '困难 ' + sc + ' 分 → ' + want + ' 级', d.grade());
  }
  d.set({ mode: 'easy', score: 0 });
  ok(d.need(1) === 10 && d.need(3) === 45, 'medalNeedOf 简单模式：铜 10 / 金 45', [d.need(1), d.need(3)]);
  d.set({ mode: 'hard', score: 0 });
  ok(d.need(1) === 6 && d.need(3) === 30, 'medalNeedOf 困难模式：铜 6 / 金 30', [d.need(1), d.need(3)]);
  ok(d.total() === 9, '一共 9 枚勋章（5 等级 + 4 特别）', d.total());
  ok(!env.errors.length, '分数线阶段无异常', env.errors.slice(0, 1).map(e => e.msg));
}

/* 2. 发奖：等级是阶梯，拿到金章下面两枚一起亮 */
{
  const env = load(html);
  const d = env.sandbox.__dbg;
  d.set({ mode: 'easy', score: 45, jumps: 20, perfects: 6, springs: 1 });
  const g = d.award();
  ok(g === 3, '45 分评为金章', g);
  const st = d.state();
  ok(st.grades.bronze && st.grades.silver && st.grades.gold, '铜银金三枚一起点亮', st.grades);
  ok(!st.grades.platinum && !st.grades.diamond, '铂金 / 钻石还是灰的', st.grades);
  ok(st.best.easy === 3 && st.best.hard === 0, '最高等级按模式分开记', st.best);
  ok(d.count() === 3, '计数器 = 3', d.count());

  // 再打一局更低的，不该把最高等级冲掉
  d.set({ mode: 'easy', score: 11, jumps: 3, perfects: 0 });
  d.award();
  ok(d.state().best.easy === 3, '低分局不会覆盖最高等级', d.state().best.easy);

  // 困难模式单独立账
  d.set({ mode: 'hard', score: 30, jumps: 12, perfects: 1 });
  d.award();
  ok(d.state().best.hard === 3, '困难 30 分 = 金章', d.state().best.hard);
  ok(!env.errors.length, '发奖阶段无异常', env.errors.slice(0, 1).map(e => e.msg));
}

/* 3. 特别勋章 */
{
  const env = load(html);
  const d = env.sandbox.__dbg;

  d.set({ mode: 'easy', score: 12, jumps: 30, perfects: 3, springs: 5 });
  d.award();
  ok(!!d.state().special.spring5, '弹簧收藏家：单局 5 个弹簧柱');
  ok(!d.state().special.perfect_run, '完美主义者不该被误触发', d.state().special);

  d.set({ mode: 'easy', score: 12, jumps: 12, perfects: 8, springs: 0 });
  d.award();
  ok(!!d.state().special.perfect_run, '完美主义者：12 跳 + 完美率 66%');

  // 完美率不够就不给
  d.set({ mode: 'easy', score: 12, jumps: 12, perfects: 5, springs: 0 });
  const before = d.state().special.perfect_run;
  ok(!!before, '完美主义者一旦点亮就保持');

  d.set({ mode: 'easy', score: 45, jumps: 10, perfects: 1, springs: 0, daily: '2026-11-13' });
  d.award();
  ok(!!d.state().special.daily_gold, '每日勇者：每日挑战拿金章');

  d.set({ mode: 'hard', score: 30, jumps: 10, perfects: 1, springs: 0 });
  d.award();
  const st = d.state();
  ok(st.best.easy >= 3 && st.best.hard >= 3, '两种模式都有金章', st.best);
  ok(!!st.special.both_gold, '双面高手：两个模式都拿过金章');
  ok(!env.errors.length, '特别勋章阶段无异常', env.errors.slice(0, 1).map(e => e.msg));
}

/* 4. 落盘：重开一个环境，勋章还在 */
{
  const env1 = load(html);
  const d1 = env1.sandbox.__dbg;
  d1.set({ mode: 'easy', score: 80, jumps: 30, perfects: 20, springs: 6 });
  d1.award();
  const saved = env1.store.get('jf_medals_v1');
  ok(!!saved, '勋章写进了 localStorage', saved && saved.slice(0, 40));

  const env2 = load(html, { jf_medals_v1: saved });
  const d2 = env2.sandbox.__dbg;
  ok(d2.count() === d1.count(), '重载后数量一致', [d1.count(), d2.count()]);
  ok(d2.state().best.easy === 4, '重载后最高等级还在', d2.state().best.easy);
  ok(!!d2.state().grades.platinum, '重载后铂金章还在');
}

/* 5. 面板 / 结算页不炸（带勋章数据画一遍） */
{
  const env = load(html, { jf_medals_v1: JSON.stringify({ best: { easy: 5, hard: 2 }, grades: { bronze: '2026-11-01', silver: '2026-11-02', gold: '2026-11-03', platinum: '2026-11-04', diamond: '2026-11-05' }, special: { spring5: '2026-11-02' } }) });
  const d = env.sandbox.__dbg;
  d.openMedals();
  d.openOver();
  d.openSettings();
  ok(!env.errors.length, '面板绘制无异常', env.errors.slice(0, 1).map(e => e.msg));
}

console.log('');
if (bad) { console.log('✗ ' + label + '  勋章系统 ' + bad + ' 项失败'); process.exit(1); }
console.log('✓ ' + label + '  勋章系统 分数线 · 阶梯发奖 · 特别勋章 · 落盘 · 面板 全部正常');
