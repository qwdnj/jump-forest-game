/* 生成 192x192 调色板 PNG 图标（不依赖任何图像库）
   和原来那张真彩色 PNG 画面完全一致，只是编码成 8bit 索引色，体积小一大截。 */
const zlib = require('zlib');
const fs = require('fs');

const W = 192, H = 192;
const px = Buffer.alloc(W * H * 4);

function set(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  const sa = a / 255;
  px[i] = Math.round(px[i] * (1 - sa) + r * sa);
  px[i + 1] = Math.round(px[i + 1] * (1 - sa) + g * sa);
  px[i + 2] = Math.round(px[i + 2] * (1 - sa) + b * sa);
  px[i + 3] = Math.max(px[i + 3], a);
}

const R = 44;
function insideRound(x, y) {
  const cx = Math.min(Math.max(x, R), W - R);
  const cy = Math.min(Math.max(y, R), H - R);
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= R * R;
}

for (let y = 0; y < H; y++) {
  const t = y / (H - 1);
  const r = Math.round(58 + (16 - 58) * t);
  const g = Math.round(166 + (74 - 166) * t);
  const b = Math.round(112 + (54 - 112) * t);
  for (let x = 0; x < W; x++) {
    if (!insideRound(x, y)) continue;
    const hl = Math.max(0, 1 - Math.hypot(x - 48, y - 34) / 120) * 0.20;
    set(x, y,
      Math.min(255, r + 255 * hl),
      Math.min(255, g + 255 * hl),
      Math.min(255, b + 255 * hl), 255);
  }
}

function tri(scale, alpha, ox, oy) {
  const cx = 96 + 6 + ox, cy = 96 + oy;
  const k = scale;
  const ax = cx - 26 * k, ay = cy - 34 * k;
  const bx = cx - 26 * k, by = cy + 34 * k;
  const ex = cx + 30 * k, ey = cy;
  for (let y = Math.floor(cy - 36 * k); y <= Math.ceil(cy + 36 * k); y++) {
    for (let x = Math.floor(cx - 30 * k); x <= Math.ceil(cx + 34 * k); x++) {
      const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by);
      const d2 = (x - ex) * (by - ey) - (bx - ex) * (y - ey);
      const d3 = (x - ax) * (ey - ay) - (ex - ax) * (y - ay);
      const neg = (d1 < 0) || (d2 < 0) || (d3 < 0);
      const pos = (d1 > 0) || (d2 > 0) || (d3 > 0);
      if (!(neg && pos)) set(x, y, 255, 255, 255, alpha);
    }
  }
}
tri(1.0, 255, 0, 0);

for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const d = Math.hypot(x - 148, y - 148);
  if (d < 15) set(x, y, 255, 196, 84, 235);
}

/* ---------- 中位切分量化到 ≤256 色 ---------- */
const HAS_TRANS = true; // 图标四角是透明的，调色板要给透明色留一格
const MAXC = 255;
function medianCut(pixels) {
  let boxes = [pixels];
  while (boxes.length < MAXC) {
    // 找像素最多、且可分的最大的盒子
    let bi = -1, best = 0;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.length < 2) continue;
      let rmin = 255, rmax = 0, gmin = 255, gmax = 0, bmin = 255, bmax = 0;
      for (const p of b) {
        if (p[0] < rmin) rmin = p[0]; if (p[0] > rmax) rmax = p[0];
        if (p[1] < gmin) gmin = p[1]; if (p[1] > gmax) gmax = p[1];
        if (p[2] < bmin) bmin = p[2]; if (p[2] > bmax) bmax = p[2];
      }
      const range = Math.max(rmax - rmin, gmax - gmin, bmax - bmin) * Math.sqrt(b.length);
      if (range > best) { best = range; bi = i; }
    }
    if (bi < 0 || best <= 0) break;
    const b = boxes[bi];
    let rmin = 255, rmax = 0, gmin = 255, gmax = 0, bmin = 255, bmax = 0;
    for (const p of b) {
      if (p[0] < rmin) rmin = p[0]; if (p[0] > rmax) rmax = p[0];
      if (p[1] < gmin) gmin = p[1]; if (p[1] > gmax) gmax = p[1];
      if (p[2] < bmin) bmin = p[2]; if (p[2] > bmax) bmax = p[2];
    }
    const dr = rmax - rmin, dg = gmax - gmin, db = bmax - bmin;
    const ch = (dr >= dg && dr >= db) ? 0 : (dg >= db ? 1 : 2);
    b.sort((p, q) => p[ch] - q[ch]);
    const mid = b.length >> 1;
    boxes.splice(bi, 1, b.slice(0, mid), b.slice(mid));
  }
  return boxes.map(b => {
    let r = 0, g = 0, bl = 0;
    for (const p of b) { r += p[0]; g += p[1]; bl += p[2]; }
    const n = b.length;
    return [Math.round(r / n), Math.round(g / n), Math.round(bl / n)];
  });
}

// 去重后的颜色表（含 alpha=0 的透明色，单独放最后一个）
const seen = new Map();
const opaque = [];
for (let i = 0; i < W * H; i++) {
  const o = i * 4;
  if (px[o + 3] === 0) { px[o] = px[o + 1] = px[o + 2] = 0; continue; }
  const key = (px[o] << 16) | (px[o + 1] << 8) | px[o + 2];
  if (!seen.has(key)) { seen.set(key, 1); opaque.push([px[o], px[o + 1], px[o + 2]]); }
}
const palette = medianCut(opaque);
palette.push([0, 0, 0]);          // 透明色索引放最后
const transIdx = palette.length - 1;

// 最近色查找（带缓存）
const cache = new Map();
function nearest(r, g, b) {
  const key = (r << 16) | (g << 8) | b;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let bi = 0, bd = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const dr = p[0] - r, dg = p[1] - g, db = p[2] - b;
    const d = dr * dr + dg * dg + db * db;
    if (d < bd) { bd = d; bi = i; }
  }
  cache.set(key, bi);
  return bi;
}

const idx = Buffer.alloc(W * H);
for (let i = 0; i < W * H; i++) {
  const o = i * 4;
  idx[i] = px[o + 3] === 0 ? transIdx : nearest(px[o], px[o + 1], px[o + 2]);
}

/* ---------- PNG 编码 ---------- */
const table = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length >>> 0);
  const t = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0);
  return Buffer.concat([len, t, data, crcBuf]);
}

// 逐行挑最省字节的滤波（0=None / 1=Sub / 2=Up / 4=Paeth），索引色也算得过来
function filterRow(type, cur, prev, bpp) {
  const out = Buffer.alloc(W + 1);
  out[0] = type;
  for (let x = 0; x < W; x++) {
    const a = x >= bpp ? cur[x - bpp] : 0;
    const b = prev ? prev[x] : 0;
    const c = (prev && x >= bpp) ? prev[x - bpp] : 0;
    let v;
    if (type === 0) v = cur[x];
    else if (type === 1) v = cur[x] - a;
    else if (type === 2) v = cur[x] - b;
    else {
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      v = cur[x] - pr;
    }
    out[x + 1] = v & 0xFF;
  }
  return out;
}

const raw = Buffer.alloc((W + 1) * H);
for (let y = 0; y < H; y++) {
  const cur = idx.subarray(y * W, (y + 1) * W);
  const prev = y > 0 ? idx.subarray((y - 1) * W, y * W) : null;
  let best = null;
  for (const t of [0, 1, 2, 4]) {
    const row = filterRow(t, cur, prev, 1);
    if (!best) { best = row; continue; }
    // 用行内非零字节数估个代价，够用
    let cost = 0, bcost = 0;
    for (let i = 1; i < row.length; i++) { if (row[i]) cost += 1 + (row[i] < 8 ? 1 : 0); if (best[i]) bcost += 1 + (best[i] < 8 ? 1 : 0); }
    if (cost < bcost) best = row;
  }
  best.copy(raw, y * (W + 1));
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 3; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const plte = Buffer.alloc(palette.length * 3);
palette.forEach((p, i) => { plte[i * 3] = p[0]; plte[i * 3 + 1] = p[1]; plte[i * 3 + 2] = p[2]; });
const trns = Buffer.alloc(palette.length);
trns.fill(255);
trns[transIdx] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr),
  chunk('PLTE', plte),
  chunk('tRNS', trns),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9, memLevel: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

const out = process.argv[2] || 'icon.png';
fs.writeFileSync(out, png);
console.log(out, png.length, 'bytes,', palette.length, 'colors, cache', cache.size);
