// Ekspor catatan ke PDF memakai Google Chrome yang sudah terpasang (puppeteer-core).
// Chrome baru dijalankan saat ada ekspor, dipakai ulang, lalu ditutup setelah menganggur
// supaya tidak terus memakan RAM. Satu ekspor berjalan pada satu waktu.

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import puppeteer from 'puppeteer-core';
import MarkdownIt from 'markdown-it';
import { createRenderer } from './render.js';
import { safeFilename } from './text.js';
import { NoteError, TZ } from './notes.js';

export const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FONTS = [
  // [family, style, weight, file]
  ['Figtree', 'normal', '400 700', 'figtree-var.woff2'],
  ['Literata', 'normal', '400 700', 'literata-var.woff2'],
  ['Literata', 'italic', '400', 'literata-italic-var.woff2'],
  ['JetBrains Mono', 'normal', '400 500', 'jetbrainsmono-var.woff2'],
];

const { render } = createRenderer(MarkdownIt, { internalLinks: false });
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const dateFmt = new Intl.DateTimeFormat('id-ID', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('id-ID', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const wib = d => `${dateFmt.format(d)} pukul ${timeFmt.format(d)} WIB`;

// Halaman cetak tidak butuh skrip; CSP ini juga menahan apa pun yang lolos dari renderer.
// Gambar http(s) boleh dimuat (dibatasi waktu di bawah), selain itu hanya data: dari template.
const CSP = "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data: http: https:";

// Ukuran area isi A4 (210×297 mm dikurangi margin) dalam px CSS (96 dpi).
const MARGIN = { top: 18, bottom: 20, left: 18, right: 18 }; // mm
const mmToPx = mm => (mm / 25.4) * 96;
const CONTENT_W = Math.floor(mmToPx(210 - MARGIN.left - MARGIN.right));
const CONTENT_H = Math.floor(mmToPx(297 - MARGIN.top - MARGIN.bottom));

const FOOTER = `<div style="width:100%;margin:0 18mm;display:flex;gap:12px;justify-content:space-between;font:7.5pt -apple-system,'Helvetica Neue',sans-serif;color:#8A948F">
  <span class="title" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
  <span style="white-space:nowrap">Halaman <span class="pageNumber"></span> dari <span class="totalPages"></span></span>
</div>`;

let assetsP;
function loadAssets() {
  assetsP ??= (async () => {
    const faces = await Promise.all(FONTS.map(async ([family, style, weight, file]) => {
      const b64 = (await fs.readFile(path.join(ROOT, 'public', 'fonts', file))).toString('base64');
      return `@font-face{font-family:"${family}";font-style:${style};font-weight:${weight};src:url(data:font/woff2;base64,${b64}) format("woff2")}`;
    }));
    const css = await fs.readFile(path.join(ROOT, 'lib', 'print.css'), 'utf8');
    return faces.join('\n') + '\n' + css;
  })();
  return assetsP;
}

/** HTML lengkap untuk dicetak. `note` = hasil store.get(). */
export async function buildPrintHtml(note) {
  const css = await loadAssets();
  const meta = [
    `Dibuat ${wib(new Date(note.created))}`,
    `Diubah ${wib(new Date(note.updated))}`,
    ...(note.tags.length ? [note.tags.map(t => `<span class="tag">#${esc(t)}</span>`).join(' ')] : []),
  ].join(' · ');
  let body = render(note.body);
  // Baris metadata diletakkan tepat di bawah judul kalau catatan diawali heading.
  const m = body.match(/^<h1>[\s\S]*?<\/h1>\n/);
  body = m
    ? m[0] + `<p class="meta">${meta}</p>\n` + body.slice(m[0].length)
    : `<p class="meta">${meta}</p>\n` + body;
  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>${esc(note.title)}</title>
<style>${css}</style>
</head><body><article class="prose">${body}</article></body></html>`;
}

/**
 * Dijalankan di halaman cetak (lewat CDP; skrip halaman sendiri diblokir CSP).
 * Elemen "jangan terbelah" yang lebih tinggi dari satu halaman diberi kelas .long.
 * (Baris kode sudah dibungkus <span class="line"> oleh renderer.)
 */
function prepareForPrint(pageHeight) {
  for (const el of document.querySelectorAll('.prose pre, .prose blockquote, .prose table, .prose li')) {
    if (el.getBoundingClientRect().height > pageHeight * 0.95) el.classList.add('long');
  }
}

/** Nama file dari judul, aman untuk header Content-Disposition. */
export const pdfFilename = title => safeFilename(title, 'pdf');
export function contentDisposition(title, type = 'inline') {
  const name = pdfFilename(title);
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

const PROFILE_PREFIX = 'lembar-chrome-';

/**
 * Bereskan sisa server Lembar yang mati mendadak (crash / kill -9): Chrome-nya tidak sempat ditutup
 * dan tetap memakan RAM. Yang dianggap yatim hanya proses Chrome berprofil Lembar yang induknya sudah
 * mati (diambil alih launchd, PID 1), jadi Chrome milik server Lembar lain yang masih hidup aman.
 * Folder profil yang tidak dipakai dan berumur > 1 menit ikut dihapus.
 */
export async function cleanupOrphans({ tmpDir = os.tmpdir(), minAgeMs = 60_000 } = {}) {
  const result = { killed: [], removed: [] };
  if (process.platform === 'win32') return result;
  const { stdout } = await promisify(execFile)('ps', ['-Ao', 'pid=,ppid=,command=']).catch(() => ({ stdout: '' }));
  const inUse = new Set();
  for (const line of stdout.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    const dir = m?.[3].match(new RegExp(`--user-data-dir=(\\S*${PROFILE_PREFIX}\\S+)`))?.[1];
    if (!dir || !dir.startsWith(tmpDir)) continue;
    if (m[2] === '1') {
      try { process.kill(Number(m[1]), 'SIGTERM'); result.killed.push(Number(m[1])); } catch { /* sudah mati */ }
    } else {
      inUse.add(path.basename(dir));
    }
  }
  if (result.killed.length) await new Promise(r => setTimeout(r, 1000));   // beri waktu Chrome keluar
  for (const name of await fs.readdir(tmpDir).catch(() => [])) {
    if (!name.startsWith(PROFILE_PREFIX) || inUse.has(name)) continue;
    const full = path.join(tmpDir, name);
    const st = await fs.stat(full).catch(() => null);
    if (!st?.isDirectory() || Date.now() - st.mtimeMs < minAgeMs) continue;
    await fs.rm(full, { recursive: true, force: true }).then(() => result.removed.push(name), () => {});
  }
  return result;
}

export function createPdfService({
  chromePath = process.env.CHROME_PATH || DEFAULT_CHROME,
  idleMs = 60_000,
  timeoutMs = 30_000,
  imageTimeoutMs = 10_000,
  log = console,
} = {}) {
  // current = Chrome yang sedang dipakai: { ready: Promise<{browser, dir}>, browser? }
  let current = null, idleTimer = null;
  let queue = Promise.resolve();

  async function launch() {
    if (!existsSync(chromePath)) {
      throw new NoteError(503, `Google Chrome tidak ditemukan di ${chromePath}. Atur variabel CHROME_PATH.`);
    }
    // Profil sementara: profil Chrome milik pengguna (login, cookie, ekstensi) tidak disentuh.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), PROFILE_PREFIX));
    try {
      const browser = await puppeteer.launch({
        executablePath: chromePath,
        headless: true,
        userDataDir: dir,
        // Sinyal ditangani server.js (shutdown rapi), bukan puppeteer.
        handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
        args: ['--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync',
               '--disable-background-networking', '--mute-audio'],
      });
      return { browser, dir };
    } catch (err) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      throw err;
    }
  }

  function getBrowser() {
    clearTimeout(idleTimer);
    if (!current) {
      const entry = { ready: launch() };
      current = entry;
      entry.ready.then(({ browser, dir }) => {
        entry.browser = browser;
        // Chrome mati sendiri (crash): lupakan, tapi hanya kalau masih instance yang sama —
        // jangan sampai event dari Chrome lama menghapus referensi ke Chrome yang baru.
        browser.on('disconnected', () => {
          if (current === entry) current = null;
          fs.rm(dir, { recursive: true, force: true }).catch(() => {});
        });
      }, () => { if (current === entry) current = null; });
    }
    return current.ready.then(r => r.browser);
  }

  function scheduleIdleClose() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => close(), idleMs);
    idleTimer.unref();
  }

  async function close() {
    clearTimeout(idleTimer);
    const entry = current;
    current = null;
    const r = await entry?.ready.catch(() => null);
    if (!r) return;
    await r.browser.close().catch(() => {});
    await fs.rm(r.dir, { recursive: true, force: true }).catch(() => {});
  }

  async function makePdf(note) {
    const html = await buildPrintHtml(note);
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      await page.setRequestInterception(true);
      page.on('request', req => {
        const url = req.url();
        if (url.startsWith('data:') || (req.resourceType() === 'image' && /^https?:/i.test(url))) req.continue();
        else req.abort('blockedbyclient');
      });
      // Layout diukur dengan lebar isi A4 dan media print, supaya tinggi elemen sama dengan saat dicetak.
      await page.setViewport({ width: CONTENT_W, height: CONTENT_H });
      await page.emulateMediaType('print');
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      // Tunggu gambar (maks. imageTimeoutMs; yang belum selesai dibiarkan kosong) lalu font.
      await page.evaluate(ms => Promise.race([
        Promise.all([...document.images].map(img => img.complete || new Promise(r => { img.onload = img.onerror = r; }))),
        new Promise(r => setTimeout(r, ms)),
      ]), imageTimeoutMs);
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(prepareForPrint, CONTENT_H);
      return Buffer.from(await page.pdf({
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: FOOTER,
        margin: Object.fromEntries(Object.entries(MARGIN).map(([k, v]) => [k, `${v}mm`])),
        outline: true,
        tagged: true,
        timeout: timeoutMs,
      }));
    } finally {
      await page.close().catch(() => {});
    }
  }

  return {
    /** Buat PDF dari catatan (hasil store.get()). Dijalankan berurutan. */
    render(note) {
      const run = queue.then(() => makePdf(note));
      queue = run.catch(() => {}).finally(scheduleIdleClose);
      return run.catch(err => {
        if (err instanceof NoteError) throw err;
        log.error('[lembar] gagal membuat PDF:', err);
        throw new NoteError(500, 'Gagal membuat PDF: ' + err.message);
      });
    },
    close,
    get running() { return current !== null; },
  };
}
