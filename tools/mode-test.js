#!/usr/bin/env node
/* 难度模式 / 皮肤回归测试。
 *
 * 跟 smoke.js 是同一套思路（把 <script> 抠出来丢进打桩 DOM 里跑），
 * 区别在于：这里在 IIFE 结尾偷偷塞一个 __dbg 钩子，好从外面查内部状态，
 * 于是可以断言「困难模式到底有没有抛物线」这种只看截图看不出来的事。
 *
 * 用法：node tools/mode-test.js [jump/index.html]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { createEnv, runScript, makeCanvas } = require(path.join(__dirname, 'dom-stub.js'));

const FILE = process.argv[2] || path.join(__dirname, '..', 'jump', 'index.html');

/* 钩子会被插到 IIFE 内部（最后一行的 })(); 之前），所以能摸到里面的变量 */
const HOOK = `
window.__dbg = {
  snap: function () {
    return { gs: gameState, ps: player.state, x: player.x, y: player.y, ty: topY(),
      vy: player.vy, score: score, mode: modeKey, skin: skinId, best: best,
      bests: [bestEasy, bestHard], settings: settingsOpen, plats: platforms.length };
  },
  applyMode: applyMode, applySkin: applySkin, skinById: skinById,
  unlocked: function (id) { return skinUnlocked(skinById(id)); },
  pause: togglePause,
  bricks: function () {
    return platforms.map(function (p) {
      return { brick: !!p.brick, spring: !!p.spring, sway: !!p.sway, w: Math.round(p.w) };
    });
  },
  hits: function () { return uiHits.length; },
  click: function (x, y) { onDown({ preventDefault: function () {}, isPrimary: true, clientX: x, clientY: y }); },
  up: function () { onUp({ preventDefault: function () {} }); }
};
`;

function buildEnv() {
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
  return env;
}

function load(html, seed) {
  const env = buildEnv();
  if (seed) for (const k in seed) env.store.set(k, String(seed[k]));
  let js = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(m => !/\bsrc\s*=/.test(m[1])).map(m => m[2]).join('\n;\n');
  const patched = js.replace(/\}\)\(\);\s*$/, HOOK + '\n})();');
  runScript(env, patched === js ? js + '\n;' + HOOK : patched);
  env.pump(6);
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

/* 1. 简单模式：抛物线 */
{
  const env = load(html);
  const s = () => env.sandbox.__dbg.snap();
  ok(s().mode === 'easy', '默认应该是简单模式', s().mode);
  env.sandbox.__dbg.click(206, 700);
  env.pump(10);
  env.sandbox.__dbg.up();
  env.pump(1);
  const a = s();
  ok(a.ps === 'jump', '简单模式起跳后状态是 jump', a.ps);
  ok(a.vy < -100, '简单模式有向上的竖直初速', a.vy);
  let minY = a.y;
  for (let i = 0; i < 26; i++) { env.pump(1); minY = Math.min(minY, s().y); }
  ok(minY < a.ty - 20, '简单模式会升空（抛物线）');
  ok(!env.errors.length, '简单模式无异常', env.errors.slice(0, 1).map(e => e.msg));
}

/* 2. 困难模式：直线、零竖直速度、全程等高 */
{
  const env = load(html, { jf_mode: 'hard' });
  const s = () => env.sandbox.__dbg.snap();
  ok(s().mode === 'hard', '读档进入困难模式', s().mode);
  env.sandbox.__dbg.click(206, 700);
  env.pump(10);
  env.sandbox.__dbg.up();
  env.pump(1);
  const a = s();
  ok(a.ps === 'glide', '困难模式起跳后状态是 glide', a.ps);
  ok(a.vy === 0, '困难模式竖直速度为 0（没有抛物线）', a.vy);
  ok(Math.abs(a.y - a.ty) < 0.001, '起跳瞬间就在柱顶高度', { y: a.y, ty: a.ty });
  let maxDy = 0, moved = 0;
  for (let i = 0; i < 20; i++) {
    env.pump(1);
    const t = s();
    if (t.ps !== 'glide') break;
    maxDy = Math.max(maxDy, Math.abs(t.y - t.ty));
    moved = Math.max(moved, Math.abs(t.x - a.x));
  }
  ok(maxDy < 0.001, '整段冲刺 y 保持不变（直线）', maxDy);
  ok(moved > 10, '冲刺过程中 x 在推进', moved);
  for (let i = 0; i < 90; i++) env.pump(1);
  const b = s();
  ok(b.ps === 'idle' || b.ps === 'fall' || b.ps === 'dead', '冲刺结束后落地或掉落', b.ps);
  ok(!env.errors.length, '困难模式无异常', env.errors.slice(0, 1).map(e => e.msg));
}

/* 3. 两种模式的最高分互不覆盖 */
{
  const env = load(html, { jf_best_easy: 33, jf_best_hard: 12 });
  const d = env.sandbox.__dbg;
  ok(d.snap().best === 33, '简单模式最高分 33', d.snap().best);
  d.applyMode('hard');
  env.pump(2);
  ok(d.snap().best === 12, '切到困难后显示 12', d.snap().best);
  ok(d.snap().mode === 'hard' && d.snap().score === 0, '切难度会重开一局');
  d.applyMode('easy');
  env.pump(2);
  ok(d.snap().best === 33, '切回简单仍是 33', d.snap().best);
  ok(!env.errors.length, '切模式无异常');
}

/* 3b. 柱子材质：隔一根石砖（弹簧/摆柱不参与轮换） */
{
  const env = load(html);
  const d = env.sandbox.__dbg;
  const list = d.bricks();
  ok(list.length >= 5, '开局至少有 5 根柱子', list.length);
  ok(!list[0].brick, '第一根（出生点）是木柱', list[0]);

  let plainPairs = 0, bad = 0;
  for (let i = 0; i + 1 < list.length; i++) {
    const a = list[i], b = list[i + 1];
    if (a.spring || a.sway || b.spring || b.sway) continue;
    plainPairs++;
    if (a.brick === b.brick) bad++;
  }
  ok(plainPairs > 0, '开局有相邻的普通柱子', plainPairs);
  ok(bad === 0, '相邻的普通柱子必须一木一砖', { pairs: plainPairs, bad: bad });

  // 弹簧 / 摆柱 用的是自己的材质，不该被标成石砖
  const special = list.filter(p => p.spring || p.sway);
  ok(special.every(p => !p.brick), '弹簧柱 / 摆柱不会被标成石砖', special,);
  ok(!env.errors.length, '加石砖柱后无异常', env.errors.slice(0, 1).map(e => e.msg));
}

/* 4. 皮肤：解锁 / 换装 / 锁定 */
{
  const env = load(html, { jf_best_easy: 100 });
  const d = env.sandbox.__dbg;
  ok(d.snap().skin === 'orange', '默认皮肤是森林橘', d.snap().skin);
  ok(d.unlocked('gold') === true, '100 分时黄金甲已解锁');
  d.applySkin(d.skinById('gold'));
  env.pump(2);
  ok(d.snap().skin === 'gold', '能换成黄金甲', d.snap().skin);
  ok(env.store.get('jf_skin') === 'gold', '皮肤写进了 localStorage');
  ok(!env.errors.length, '换皮肤无异常', env.errors.slice(0, 1).map(e => e.msg));
}
{
  const env = load(html, { jf_best_easy: 0 });
  const d = env.sandbox.__dbg;
  ok(d.unlocked('bee') === false, '0 分时小蜜蜂锁着');
  d.applySkin(d.skinById('bee'));
  env.pump(2);
  ok(d.snap().skin === 'orange', '锁着的皮肤换不上', d.snap().skin);
  ok(!env.errors.length, '锁定提示无异常');
}

/* 5. 暂停面板/设置面板能注册可点区域 */
{
  const env = load(html);
  const d = env.sandbox.__dbg;
  d.pause();
  env.pump(1);
  ok(d.snap().gs === 'paused', '能暂停');
  ok(d.hits() > 0, '暂停面板注册了可点区域', d.hits());
  d.click(4, 4);
  env.pump(1);
  ok(d.snap().gs === 'playing', '点空白处继续游戏');
  ok(!env.errors.length, '面板交互无异常');
}

if (bad) {
  console.log('✗ ' + label + '  ' + bad + ' 项失败');
  process.exit(1);
}
console.log('✓ ' + label + '  难度模式 2 套 · 皮肤 6 款 · 最高分隔离 · 面板交互 全部正常');
