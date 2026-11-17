'use strict';
/** 重新產生分享圖：node dev/render-og.js → assets/og-image.png（1200 × 630，需要已安裝 Google Chrome） */
const { execFileSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const chrome = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const out = path.join(root, 'assets', 'og-image.png');

execFileSync(chrome, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--force-device-scale-factor=1', '--window-size=1200,630',
  '--virtual-time-budget=10000',
  '--screenshot=' + out,
  'file://' + path.join(root, 'dev', 'og.html')
], { stdio: 'inherit' });
console.log('已輸出', out);
