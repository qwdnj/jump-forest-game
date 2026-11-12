/* 最小 DOM / Canvas 打桩：让浏览器游戏脚本能在 node 里跑起来，
   用来在 CI 里做冒烟测试（加载期异常 + 泵帧 + 模拟操作）。
   只补游戏真正用到的那部分 API，故意不追求完整。 */
const vm = require('vm');

const counters = { canvas: 0, canvasPx: 0, fill: 0, stroke: 0, drawImage: 0, fillText: 0, strokeText: 0, grad: 0, path: 0, save: 0 };

function makeGrad() { counters.grad++; return { addColorStop() {} }; }

function makeCtx() {
  const ctx = {
    canvas: null,
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
    font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic',
    setTransform() {}, resetTransform() {}, setLineDash() {},
    clearRect() {}, fillRect() {}, strokeRect() {},
    beginPath() { counters.path++; }, closePath() {}, moveTo() {}, lineTo() {},
    arc() {}, arcTo() {}, ellipse() {}, quadraticCurveTo() {}, bezierCurveTo() {}, rect() {},
    fill() { counters.fill++; }, stroke() { counters.stroke++; }, clip() {},
    save() { counters.save++; }, restore() {}, translate() {}, rotate() {}, scale() {},
    drawImage() { counters.drawImage++; }, fillText() { counters.fillText++; }, strokeText() { counters.strokeText++; },
    measureText(s) { return { width: String(s == null ? '' : s).length * 8 }; },
    createLinearGradient: makeGrad,
    createRadialGradient: makeGrad,
    createPattern() { return {}; },
    putImageData() {}, getImageData() { return { data: [] }; }
  };
  return ctx;
}

function makeCanvas(w, h) {
  return {
    width: w || 300, height: h || 150,
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    _ctx: null,
    getContext() {
      if (!this._ctx) { this._ctx = makeCtx(); this._ctx.canvas = this; }
      return this._ctx;
    },
    addEventListener() {}, removeEventListener() {},
    toDataURL() { return 'data:,'; },
    getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; }
  };
}

function makeEl(id) {
  return {
    id, style: {}, dataset: {}, value: '', textContent: '', innerHTML: '',
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    addEventListener() {}, removeEventListener() {}, focus() {}, select() {}, blur() {},
    appendChild() {}, removeChild() {}, setAttribute() {}, querySelectorAll() { return []; }
  };
}

function createEnv(opts) {
  opts = opts || {};
  const W = opts.W || 412, H = opts.H || 915;
  const listeners = { window: {}, document: {} };
  const gameCanvas = makeCanvas(300, 150);
  const els = new Map();
  els.set('game', gameCanvas);
  els.set('nameInput', makeEl('nameInput'));

  const store = new Map();
  const localStorage = {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
    clear() { store.clear(); }
  };

  function addL(map, type, fn) { (map[type] = map[type] || []).push(fn); }

  const errors = [];
  let nowMs = (opts.start || 1600000000000);
  const sandbox = {
    console,
    Math, Date, JSON, Object, Array, String, Number, Boolean, isFinite, isNaN, parseInt, parseFloat, Map, Set, Promise,
    performance: { now: () => nowMs },
    localStorage,
    navigator: { vibrate() { return true; }, userAgent: 'node-harness' },
    screen: { orientation: { lock() { return Promise.resolve(); }, unlock() {}, addEventListener() {} } },
    getComputedStyle() { return { getPropertyValue() { return '0px'; } }; },
    requestAnimationFrame(fn) { return 1; },
    cancelAnimationFrame() {},
    setTimeout() { return 1; }, clearTimeout() {},
    AbortController: function () { this.signal = {}; this.abort = () => {}; },
    fetch: undefined,
    innerWidth: W, innerHeight: H, devicePixelRatio: opts.dpr || 3,
    addEventListener(t, f) { addL(listeners.window, t, f); },
    removeEventListener() {},
    document: {
      getElementById(id) { return els.get(id) || null; },
      createElement(tag) { if (tag === 'canvas') { counters.canvas++; } return tag === 'canvas' ? makeCanvas(1, 1) : makeEl(tag); },
      addEventListener(t, f) { addL(listeners.document, t, f); },
      removeEventListener() {},
      documentElement: makeEl('html'),
      body: makeEl('body'),
      hidden: false,
      activeElement: null,
      fullscreenElement: null,
      exitFullscreen() { return Promise.resolve(); }
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  return {
    sandbox, gameCanvas, localStorage, store, errors,
    get now() { return nowMs; },
    set now(v) { nowMs = v; },
    fire(target, type, ev) {
      const map = target === 'document' ? listeners.document : listeners.window;
      for (const fn of (map[type] || []).slice()) {
        try { fn(ev || {}); } catch (e) { errors.push({ type, msg: (e && e.stack) || String(e) }); }
      }
    },
    listeners
  };
}

function runScript(env, src) {
  const ctx = vm.createContext(env.sandbox);
  try { vm.runInContext(src, ctx, { filename: 'game.js' }); }
  catch (e) { env.errors.push({ type: 'load', msg: (e && e.stack) || String(e) }); }
  return ctx;
}

module.exports = { createEnv, runScript, makeCanvas, counters };
