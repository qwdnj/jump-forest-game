#!/usr/bin/env node
/* 帧率显示 / 画质相关的回归测试。
 *
 * 两个游戏都加了「帧率显示」，它有两个容易写坏的点：
 *   1. 数字必须来自真实帧间隔（不是写死的 60），而且要有平滑，不能一帧掉帧就跳红
 *   2. 三档循环必须能落盘（关 → FPS → FPS+ms），面板开着的时候不能抢点击
 *
 * 用法：node tools/perf-test.js [jump/index.html] [monkey/index.html]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { createEnv, runScript, makeCanvas } = require(path.join(__dirname, 'dom-stub.js'));

const JUMP = process.argv[2] || path.join(__dirname, '..', 'jump', 'index.html');
const MONKEY = process.argv[3] || path.join(__dirname, '..', 'monkey', 'index.html');

let failed = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  ✓ ' + name);
  else { failed++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

function scriptsOf(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (/\bsrc\s*=/.test(m[1])) continue;
    out.push(m[2]);
  }
  return out;
}

function emptyEl() {
  return {
    style: {}, dataset: {}, value: '', textContent: '', innerHTML: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, focus() {}, select() {}, blur() {},
    appendChild() {}, removeChild() {}, remove() {}, click() {},
    setAttribute() {}, getAttribute() { return null; }, querySelector() { return null; },
    querySelectorAll() { return []; },
    getContext() { return null; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 150 }; }
  };
}

function buildEnv(startNow) {
  const env = createEnv({ W: 412, H: 915, dpr: 3 });
  const doc = env.sandbox.document;
  const cache = new Map();
  const byId = doc.getElementById.bind(doc);
  doc.getElementById = (id) => {
    const known = byId(id);
    if (known) return known;
    if (!cache.has(id)) cache.set(id, emptyEl());
    return cache.get(id);
  };
  doc.createElement = (tag) => (tag === 'canvas' ? makeCanvas(300, 150) : emptyEl());
  env.sandbox.location = { protocol: 'file:', href: 'file:///android_asset/x/index.html' };
  env.sandbox.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
  let pending = [];
  env.sandbox.requestAnimationFrame = (fn) => { pending.push(fn); return 1; };
  env.pump = (n, stepMs) => {
    const step = stepMs || 16.7;
    for (let i = 0; i < n; i++) {
      const cbs = pending; pending = [];
      env.now += step;
      for (const cb of cbs) cb(env.now);
    }
  };
  if (startNow) env.now = startNow;
  return env;
}

function run(html, hook, env) {
  const js = scriptsOf(html).join('\n;\n');
  const idx = js.lastIndexOf('})();');
  const src = idx >= 0 ? js.slice(0, idx) + hook + '\n' + js.slice(idx) : js + hook;
  runScript(env, src);
  if (env.errors.length) {
    console.log('  ✗ 脚本执行异常: ' + env.errors[0].msg.split('\n')[0]);
    failed++;
  }
  return env;
}

/* ---------------- 跳一跳 ---------------- */
console.log('跳一跳 · 帧率显示');
{
  const env = buildEnv();
  const hook = `
window.__dbg = {
  fps: function () { return { mode: fpsMode, shown: fpsShown, ms: fpsMsShown, smooth: fpsSmooth }; },
  cycle: function () { setFpsMode((fpsMode + 1) % 3); },
  set: setFpsMode,
  feed: function (ms) { sampleFps(performance.now(), ms / 1000); },
  hits: function () { return uiHits.length; },
  chip: drawFpsChip,
  openPanel: function () { settingsOpen = true; clearHits(); }
};
`;
  const html = fs.readFileSync(JUMP, 'utf8');
  run(html, hook, env);
  const dbg = env.sandbox.__dbg;
  ok('默认打开帧率显示', dbg.fps().mode === 1, JSON.stringify(dbg.fps()));

  // 连续喂 60fps 的帧间隔
  for (let i = 0; i < 40; i++) { env.now += 17; dbg.feed(16.7); }
  const f60 = dbg.fps();
  ok('60fps 时读数接近 60', f60.shown >= 55 && f60.shown <= 65, f60.shown + ' FPS');
  ok('毫秒读数接近 16.7', Math.abs(f60.ms - 16.7) < 3, f60.ms.toFixed(1) + 'ms');

  // 改成 30fps 的帧间隔，读数应该往下走
  for (let i = 0; i < 40; i++) { env.now += 34; dbg.feed(33.4); }
  const f30 = dbg.fps();
  ok('掉到 30fps 时读数跟着降', f30.shown >= 25 && f30.shown <= 40, f30.shown + ' FPS');

  // 三档循环 + 落盘
  dbg.cycle();
  ok('1 → 2（带毫秒）', dbg.fps().mode === 2);
  dbg.cycle();
  ok('2 → 0（隐藏）', dbg.fps().mode === 0);
  ok('选择写进了 localStorage', env.store.get('jf_fps_v1') === '0', env.store.get('jf_fps_v1'));
  dbg.cycle();
  ok('0 → 1 循环回来', dbg.fps().mode === 1);

  // 隐藏时不该再注册可点区域
  dbg.set(0);
  dbg.openPanel();
  dbg.chip();
  ok('隐藏后不画也不抢点击', dbg.hits() === 0, 'hits=' + dbg.hits());

  // 面板开着时不画胶囊（避免挡住面板）
  dbg.set(1);
  dbg.chip();
  const hitsPanel = dbg.hits();
  ok('面板开着时胶囊让位', hitsPanel === 0, 'hits=' + hitsPanel);
}

/* ---------------- 海滩猴子大冒险 ---------------- */
console.log('海滩猴子 · 帧率显示');
{
  const env = buildEnv();
  const hook = `
window.__dbg = {
  fps: function () { return { mode: fpsMode, shown: Math.round(fpsSmooth), ms: fpsFrameMs }; },
  chip: function () { return fpsChip ? { text: fpsChip.textContent, display: fpsChip.style.display, color: fpsChip.style.color } : null; },
  feed: sampleFps,
  set: function (m) { fpsMode = m; paintFpsChip(); },
  settings: function () { openSettings(); return panelContent.innerHTML; }
};
`;
  const html = fs.readFileSync(MONKEY, 'utf8');
  run(html, hook, env);
  const dbg = env.sandbox.__dbg;
  ok('默认打开帧率显示', dbg.fps().mode === 1, JSON.stringify(dbg.fps()));

  const startText = dbg.chip() && dbg.chip().text;
  ok('胶囊上有 FPS 字样', /FPS/.test(startText || ''), startText);

  for (let i = 0; i < 40; i++) dbg.feed(1 / 60);
  const chip60 = dbg.chip();
  ok('60fps 时贴的是真实读数', /^5[5-9] FPS$|^6[0-5] FPS$/.test(chip60.text), chip60.text);
  ok('读数高时是绿色', chip60.color === '#9ef07a', chip60.color);

  for (let i = 0; i < 40; i++) dbg.feed(1 / 30);
  const chip30 = dbg.chip();
  ok('掉帧后读数变黄/红', chip30.color === '#ffd93b' || chip30.color === '#ff8a72', chip30.text + ' ' + chip30.color);

  dbg.set(2);
  ok('第二档带毫秒', /ms$/.test(dbg.chip().text), dbg.chip().text);
  dbg.set(0);
  ok('第三档隐藏胶囊', dbg.chip().display === 'none', dbg.chip().display);
  dbg.set(1);

  const html2 = dbg.settings();
  ok('设置面板里有帧率开关', /帧率显示/.test(html2 || ''));
  ok('设置面板里说明了胶囊也能点', /胶囊/.test(html2 || ''));
}

console.log('');
if (failed) { console.log('✗ 失败 ' + failed + ' 项'); process.exit(1); }
console.log('✓ 帧率显示相关的断言全部通过');
