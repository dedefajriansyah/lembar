// Membuat ikon PNG dari public/icons/*.svg memakai Chrome yang terpasang.
// Jalankan ulang (npm run icons) setelah mengubah SVG-nya.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { DEFAULT_CHROME } from '../lib/pdf.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const TARGETS = [
  // [svg sumber, file hasil, ukuran px]
  ['icon.svg', 'icon-192.png', 192],
  ['icon.svg', 'icon-512.png', 512],
  ['icon.svg', 'favicon-32.png', 32],
  ['icon-maskable.svg', 'icon-maskable-512.png', 512],
  // apple-touch-icon harus tanpa transparansi, jadi pakai varian berlatar penuh.
  ['icon-maskable.svg', 'apple-touch-icon.png', 180],
];

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || DEFAULT_CHROME, headless: true });
try {
  const page = await browser.newPage();
  for (const [src, out, size] of TARGETS) {
    const svg = await fs.readFile(path.join(DIR, src), 'utf8');
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(`<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: path.join(DIR, out), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    console.log(`${out} (${size}×${size})`);
  }
} finally {
  await browser.close();
}
