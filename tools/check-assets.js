#!/usr/bin/env node
/*
 * 构建前自检：assets 里每个页面引用的本地资源都必须真的存在，且不能写成目录形式。
 *
 * 起因：app 里跑的是 file:///android_asset/…，没有服务器帮着补 index.html，
 * 页面里写 <a href="./jump/"> 在 GitHub Pages 上正常，打进 APK 就变成
 * file:///android_asset/jump/ → net::ERR_FILE_NOT_FOUND（网页无法打开）。
 * 这个脚本把这种错挡在构建之前。
 *
 * 用法：node tools/check-assets.js [assets 目录]
 *      默认 android/app/src/main/assets
 */
'use strict';

const fs = require('fs');
const path = require('path');

const assetsDir = path.resolve(process.argv[2] || 'android/app/src/main/assets');

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** file:// 之外的绝对地址不归我们管 */
function isExternal(url) {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//') || url.startsWith('#');
}

/** 去掉 ?query 和 #hash */
function bare(url) {
  return url.split('#')[0].split('?')[0];
}

function main() {
  if (!fs.existsSync(assetsDir)) {
    console.error('✗ 找不到 assets 目录：' + assetsDir);
    process.exit(2);
  }

  const files = walk(assetsDir, []);
  const pages = files.filter(f => /\.html?$/i.test(f));
  if (pages.length === 0) {
    console.error('✗ assets 里没有 html 页面：' + assetsDir);
    process.exit(2);
  }

  const missing = [];
  const dirLike = [];
  let checked = 0;

  for (const page of pages) {
    const relPage = path.relative(assetsDir, page).split(path.sep).join('/');
    const html = fs.readFileSync(page, 'utf8');
    const re = /\b(?:href|src)\s*=\s*["']([^"']+)["']/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      const url = m[1].trim();
      if (!url || isExternal(url)) continue;
      const clean = bare(url);
      if (!clean) continue;
      checked++;

      if (clean.endsWith('/')) {
        dirLike.push(relPage + '  →  ' + url);
        continue;
      }
      const target = path.resolve(path.dirname(page), clean);
      if (!fs.existsSync(target)) {
        missing.push(relPage + '  →  ' + url);
      }
    }
  }

  console.log('检查 ' + pages.length + ' 个页面、' + checked + ' 条本地链接（' + assetsDir + '）');

  if (dirLike.length) {
    console.error('\n✗ 这些链接指向目录，APK 里会 404（改成 xxx/index.html）：');
    for (const d of dirLike) console.error('   ' + d);
  }
  if (missing.length) {
    console.error('\n✗ 这些链接指向的文件在 assets 里不存在：');
    for (const d of missing) console.error('   ' + d);
  }
  if (dirLike.length || missing.length) {
    console.error('\n共 ' + (dirLike.length + missing.length) + ' 处问题。');
    process.exit(1);
  }
  console.log('✓ 链接全部落在真实文件上');
}

main();
