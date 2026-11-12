/* 本地冒烟 / 回归：把页面里的 <script> 抠出来，丢进 node 打桩环境真的跑起来。
 *
 * 干三件事：
 *   1. 加载期不报错（语法错误、引用了不存在的 DOM 之类）
 *   2. 手动泵帧：把 requestAnimationFrame 接管掉，一帧一帧往前推
 *   3. 模拟操作：点开始、点屏幕蓄力起跳、切后台，看会不会炸
 *
 * 用法：node tools/smoke.js src/index.html src/jump/index.html src/monkey/index.html
 *      加 --frames=1200 可以多推几帧（默认 600）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const HARNESS = path.join(__dirname, 'dom-stub.js');
const { createEnv, runScript, makeCanvas } = require(HARNESS);

const FRAMES = (() => {
  const a = process.argv.find(s => s.startsWith('--frames='));
  return a ? Number(a.split('=')[1]) : 600;
})();

function scriptsOf(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (/\bsrc\s*=/.test(m[1])) continue;      // 外链脚本不归这里管
    out.push(m[2]);
  }
  return out;
}

/* 一个够用的假 DOM 元素：记下监听器，方便测试里主动触发 */
function makeEl(id) {
  const ls = {};
  const el = {
    id, tagName: 'DIV', style: {}, dataset: {}, value: '', textContent: '', innerHTML: '',
    scrollTop: 0, scrollHeight: 0, offsetWidth: 300, offsetHeight: 150,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, on) { (on === undefined ? !this._s.has(c) : on) ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    },
    addEventListener(t, f) { (ls[t] = ls[t] || []).push(f); },
    removeEventListener(t, f) { ls[t] = (ls[t] || []).filter(x => x !== f); },
    dispatch(t, ev) { for (const f of (ls[t] || []).slice()) f(ev || {}); },
    focus() {}, select() {}, blur() {}, click() { el.dispatch('click', {}); },
    appendChild(c) { return c; }, removeChild(c) { return c; }, remove() {},
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 150, right: 300, bottom: 150 }; },
    getContext() { return null; }
  };
  return el;
}

function buildEnv() {
  const env = createEnv({ W: 412, H: 915, dpr: 3 });
  const doc = env.sandbox.document;
  const cache = new Map();

  // 自动创建任何 getElementById 要的元素
  const origGet = doc.getElementById.bind(doc);
  doc.getElementById = (id) => {
    const known = origGet(id);
    if (known) return known;
    if (!cache.has(id)) cache.set(id, makeEl(id));
    return cache.get(id);
  };

  // 让已知 canvas（id=game）也能被触发
  const gc = env.gameCanvas;
  gc._ls = {};
  gc.addEventListener = (t, f) => { (gc._ls[t] = gc._ls[t] || []).push(f); };
  gc.removeEventListener = () => {};
  gc.dispatch = (t, ev) => { for (const f of (gc._ls[t] || []).slice()) f(ev || {}); };
  gc.click = () => gc.dispatch('click', {});
  gc.getBoundingClientRect = () => ({ left: 0, top: 0, width: 412, height: 915, right: 412, bottom: 915 });

  const mk = (key) => { if (!cache.has(key)) cache.set(key, makeEl(key)); return cache.get(key); };
  doc.querySelector = (sel) => (sel === '.apk' || sel === 'footer' ? mk(sel) : (cache.get(sel) || null));
  doc.querySelectorAll = () => [];
  env.sandbox.__newCanvas = () => makeCanvas(300, 150);
  doc.createElement = (tag) => (tag === 'canvas' ? env.sandbox.__newCanvas() : makeEl('new-' + tag));

  env.sandbox.location = { protocol: 'file:', href: 'file:///android_asset/index.html' };
  env.sandbox.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {}, removeListener() {} });
  env.sandbox.innerWidth = 412;
  env.sandbox.innerHeight = 915;
  env.sandbox.devicePixelRatio = 3;
  env.sandbox.Image = function () { this.onload = null; this.onerror = null; this.src = ''; };

  const node = () => ({
    gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} },
    frequency: { value: 440, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
    Q: { value: 1 }, type: '', buffer: null,
    connect() {}, disconnect() {}, start() {}, stop() {}
  });
  const FakeAC = function () {
    return {
      state: 'running', currentTime: 0, sampleRate: 48000, destination: {},
      resume() { return Promise.resolve(); }, suspend() { return Promise.resolve(); },
      createGain: node, createOscillator: node, createBiquadFilter: node,
      createDynamicsCompressor: node, createBufferSource: node, createStereoPanner: node,
      createBuffer: () => ({ getChannelData: () => new Float32Array(64) })
    };
  };
  env.sandbox.AudioContext = FakeAC;
  env.sandbox.webkitAudioContext = FakeAC;
  env.sandbox.Audio = function () {
    return { play: () => Promise.resolve(), pause() {}, currentTime: 0, volume: 1, addEventListener() {} };
  };

  // 接管 requestAnimationFrame：手动泵帧
  let rafId = 0;
  let pending = [];
  env.sandbox.requestAnimationFrame = (fn) => { pending.push(fn); return ++rafId; };
  env.sandbox.cancelAnimationFrame = () => { pending = []; };
  env.pump = (frames, ms) => {
    for (let i = 0; i < frames; i++) {
      const cbs = pending;
      pending = [];
      env.now += (ms || 16.7);
      for (const cb of cbs) {
        try { cb(env.now); } catch (e) { env.errors.push({ type: 'raf', msg: (e && e.stack) || String(e) }); }
      }
    }
  };
  return env;
}

let bad = 0;
const files = process.argv.slice(2).filter(s => !s.startsWith('--'));
for (const file of files) {
  const html = fs.readFileSync(file, 'utf8');
  const parts = scriptsOf(html);
  const env = buildEnv();
  const label = path.basename(path.dirname(file)) + '/' + path.basename(file);

  try {
    runScript(env, parts.join('\n;\n'));
  } catch (e) {
    env.errors.push({ type: 'load', msg: (e && e.stack) || String(e) });
  }

  env.pump(5);   // 先把首页画出来

  // 点一下所有「开始」类按钮，把游戏跑起来
  const doc = env.sandbox.document;
  for (const id of ['startBtn', 'start', 'startGame', 'playBtn', 'btnStart']) {
    const el = doc.getElementById(id);
    if (el && el.dispatch) el.dispatch('click', { preventDefault() {}, stopPropagation() {} });
  }

  // 模拟操作：按下十几帧再松开，反复几轮
  const canvas = env.gameCanvas;
  const ev = (x, y) => ({
    preventDefault() {}, stopPropagation() {}, isPrimary: true,
    clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', touches: [], changedTouches: [],
    code: 'Space', button: 0, target: canvas
  });
  for (let round = 0; round < 6; round++) {
    try { canvas.dispatch('pointerdown', ev(206, 700)); } catch (e) { env.errors.push({ type: 'pd', msg: String(e && e.stack) }); }
    env.pump(12);
    env.fire('document', 'pointerup', ev(206, 700));
    env.pump(8);
  }

  // 切后台 / 切回来
  env.sandbox.document.hidden = true;
  env.fire('document', 'visibilitychange', {});
  env.pump(2);
  env.sandbox.document.hidden = false;
  env.fire('document', 'visibilitychange', {});
  env.pump(FRAMES);   // 再空推一批，逼出越界/空指针之类的偶发错误

  const errs = env.errors;
  if (errs.length) {
    bad++;
    console.log('✗ ' + label + '  ' + errs.length + ' 个错误');
    const seen = new Set();
    for (const e of errs) {
      const key = String(e.msg).split('\n')[0];
      if (seen.has(key)) continue;
      seen.add(key);
      console.log('   [' + e.type + '] ' + String(e.msg).split('\n').slice(0, 4).join('\n      '));
      if (seen.size >= 4) break;
    }
  } else {
    console.log('✓ ' + label + '  脚本 ' + parts.length + ' 段 · 泵了 ' + (FRAMES + 100) + ' 帧 · 无异常');
  }
}
console.log(bad ? '\n共 ' + bad + ' 个页面有问题' : '\n全部通过');
process.exit(bad ? 1 : 0);
