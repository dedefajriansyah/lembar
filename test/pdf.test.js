import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createPdfService, buildPrintHtml, pdfFilename, contentDisposition, DEFAULT_CHROME } from '../lib/pdf.js';
import { createStore } from '../lib/notes.js';
import { createApp } from '../server.js';
import { fillColorsPerPage, pageContents } from './helpers/pdf-pages.js';

const CHROME = process.env.CHROME_PATH || DEFAULT_CHROME;
const skip = existsSync(CHROME) ? false : `Chrome tidak ada di ${CHROME}`;
const CODE_BG = [0xEE, 0xF1, 0xED].map(v => (v / 255).toFixed(3)).join(' ');

const note = (body, extra = {}) => ({
  id: '20261007-120000', title: 'Uji', body, tags: [], created: '2026-10-07T12:00:00+07:00',
  updated: Date.parse('2026-10-07T05:30:00Z'), trashed: false, ...extra,
});
const filler = n => Array.from({ length: n }, (_, i) =>
  `Paragraf pengisi ${i + 1}. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.`).join('\n\n');
const codeBlock = lines => '```\n' + Array.from({ length: lines }, (_, i) => `baris ${i + 1}`).join('\n') + '\n```';
const pagesWithCode = buf => fillColorsPerPage(buf).map((set, i) => set.has(CODE_BG) ? i + 1 : 0).filter(Boolean);

describe('nama file & header', () => {
  test('nama file dari judul, karakter terlarang diganti', () => {
    assert.equal(pdfFilename('Rapat: 5/10 "final"?'), 'Rapat- 5-10 -final--.pdf');
    assert.equal(pdfFilename('   '), 'catatan.pdf');
    assert.equal(pdfFilename('a'.repeat(300)).length, 104);
  });
  test('Content-Disposition dengan fallback ASCII dan UTF-8', () => {
    assert.equal(contentDisposition('Résumé 漢字'),
      `inline; filename="R_sum_ __.pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9%20%E6%BC%A2%E5%AD%97.pdf`);
  });
});

describe('template cetak', () => {
  test('judul ter-escape, metadata WIB di bawah judul, tag/wikilink bukan tautan, CSP tanpa skrip', async () => {
    const html = await buildPrintHtml(note('# Judul <b>\n\n#kerja [[Lain]]', { title: 'Judul <b>', tags: ['kerja'] }));
    assert.match(html, /<title>Judul &lt;b&gt;<\/title>/);
    assert.match(html, /<h1>Judul &lt;b&gt;<\/h1>\n<p class="meta">Dibuat 7 Oktober 2026 pukul 12\.00 WIB · Diubah 7 Oktober 2026 pukul 12\.30 WIB · <span class="tag">#kerja<\/span><\/p>/);
    assert.match(html, /<span class="wikilink">Lain<\/span>/);
    assert.doesNotMatch(html, /href="#"/);
    assert.match(html, /content="default-src 'none';/);
    assert.match(html, /@font-face\{font-family:"Literata"[^}]*base64,/);
  });
});

describe('PDF (Chrome)', { skip }, () => {
  let pdf;
  before(() => { pdf = createPdfService({ imageTimeoutMs: 800 }); });
  after(() => pdf.close());

  test('PDF A4 valid, judul di metadata, nomor halaman di footer', async () => {
    const buf = await pdf.render(note('# Halo\n\nIsi', { title: 'Halo dunia' }));
    const s = buf.toString('latin1');
    assert.equal(s.slice(0, 5), '%PDF-');
    assert.match(s, /\/MediaBox \[0 0 595\.9\d* 841\.9\d*\]/);
    assert.ok(s.includes('/Title (Halo dunia)') || s.includes('/Title <FEFF'), 'judul tidak ada di metadata');
    assert.equal(pageContents(buf).length, 1);
  });

  test('blok kode yang muat satu halaman dipindah utuh, tidak terbelah', async () => {
    // Cari jumlah paragraf pengisi yang membuat blok (30 baris) melewati batas halaman 1.
    for (const n of [11, 12, 13, 14]) {
      const pages = pagesWithCode(await pdf.render(note(filler(n) + '\n\n' + codeBlock(30))));
      assert.equal(pages.length, 1, `pengisi ${n}: blok kode muncul di halaman ${pages}`);
    }
    // dan memang ada kasus yang mendorongnya ke halaman 2
    assert.deepEqual(pagesWithCode(await pdf.render(note(filler(13) + '\n\n' + codeBlock(30)))), [2]);
  });

  test('blok kode lebih panjang dari satu halaman mulai di halaman yang sama, tidak menyisakan halaman kosong', async () => {
    const buf = await pdf.render(note(filler(3) + '\n\n' + codeBlock(120)));
    const pages = pagesWithCode(buf);
    assert.equal(pages[0], 1, `blok dipindah ke halaman ${pages[0]}`);
    assert.ok(pages.length >= 2);
  });

  test('gambar yang tidak merespons tidak membuat ekspor macet', async () => {
    const hang = http.createServer(() => {}).listen(0, '127.0.0.1');
    await new Promise(r => hang.once('listening', r));
    try {
      const t = Date.now();
      const buf = await pdf.render(note(`![x](http://127.0.0.1:${hang.address().port}/x.png)\n\nteks`));
      assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
      assert.ok(Date.now() - t < 5000, `terlalu lama: ${Date.now() - t} ms`);
    } finally {
      hang.closeAllConnections(); hang.close();
    }
  });

  test('Chrome ditutup setelah menganggur', async () => {
    const p = createPdfService({ idleMs: 100 });
    await p.render(note('x'));
    assert.equal(p.running, true);
    await new Promise(r => setTimeout(r, 400));
    assert.equal(p.running, false);
  });

  test('Chrome tidak ditemukan -> 503 dengan pesan jelas', async () => {
    const p = createPdfService({ chromePath: '/tidak/ada/chrome', log: { error() {} } });
    await assert.rejects(p.render(note('x')), e => e.status === 503 && /CHROME_PATH/.test(e.message));
  });
});

describe('endpoint GET /api/notes/:id/pdf', { skip }, () => {
  let root, server, base, store, pdf;
  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'lembar-pdf-'));
    store = await createStore({ dir: path.join(root, 'notes'), log: { warn() {}, error() {} } }).init();
    pdf = createPdfService();
    server = http.createServer();
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    server.on('request', createApp(store, { port, pdf }));
    base = `http://127.0.0.1:${port}`;
  });
  after(async () => {
    await pdf.close();
    server.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  test('200 application/pdf dengan nama file dari judul', async () => {
    const n = await store.create({ body: '# Rapat mingguan 5 Okt\n\nisi' });
    const res = await fetch(`${base}/api/notes/${n.id}/pdf`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.match(res.headers.get('content-disposition'), /^inline; filename="Rapat mingguan 5 Okt\.pdf"/);
    assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  });

  test('catatan di Sampah -> 409; ID tidak valid -> 400; tidak ada -> 404', async () => {
    const n = await store.create({ body: '# Buang' });
    await store.trash(n.id);
    assert.equal((await fetch(`${base}/api/notes/${n.id}/pdf`)).status, 409);
    assert.equal((await fetch(`${base}/api/notes/..%2F..%2Fx/pdf`)).status, 400);
    assert.equal((await fetch(`${base}/api/notes/20000101-000000/pdf`)).status, 404);
  });

  test('kesalahan ditampilkan sebagai halaman HTML kalau dibuka dari browser', async () => {
    const res = await fetch(`${base}/api/notes/20000101-000000/pdf`, { headers: { Accept: 'text/html' } });
    assert.equal(res.status, 404);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(await res.text(), /Ekspor PDF gagal[\s\S]*Catatan tidak ditemukan/);
  });
});

describe('siklus hidup Chrome', { skip }, () => {
  const profileDirs = async () => (await fs.readdir(os.tmpdir())).filter(n => n.startsWith('lembar-chrome-')).sort();

  test('close() menghapus folder profil sementara', async () => {
    const before = await profileDirs();
    const p = createPdfService();
    await p.render(note('x'));
    assert.equal((await profileDirs()).length, before.length + 1);
    await p.close();
    assert.deepEqual(await profileDirs(), before);
  });

  test('ekspor saat Chrome lama sedang ditutup: Chrome baru tetap tercatat dan bisa ditutup', async () => {
    const before = await profileDirs();
    const p = createPdfService();
    await p.render(note('pertama'));
    const closing = p.close();                     // Chrome lama sedang ditutup...
    const buf = await p.render(note('kedua'));     // ...sementara ekspor baru menyalakan Chrome baru
    await closing;
    assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
    assert.equal(p.running, true, 'Chrome baru hilang dari catatan');
    await p.close();
    assert.equal(p.running, false);
    assert.deepEqual(await profileDirs(), before);
  });
});

describe('cleanupOrphans', { skip: process.platform === 'win32' && 'khusus macOS/Linux' }, async () => {
  const { cleanupOrphans } = await import('../lib/pdf.js');
  const { spawn } = await import('node:child_process');
  const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const ppidOf = async pid => {
    const { execFileSync } = await import('node:child_process');
    try { return Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' }).trim()); } catch { return null; }
  };
  const findPid = async marker => {
    const { execFileSync } = await import('node:child_process');
    const line = execFileSync('ps', ['-Ao', 'pid=,command='], { encoding: 'utf8' }).split('\n').find(l => l.includes(marker) && l.includes('setTimeout'));
    return line ? Number(line.trim().split(/\s+/)[0]) : null;
  };

  test('Chrome yatim (induk PID 1) ditutup & profilnya dihapus; yang masih punya induk dibiarkan', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lembar-orphan-test-'));
    const orphanDir = path.join(tmp, 'lembar-chrome-yatim'), liveDir = path.join(tmp, 'lembar-chrome-hidup');
    const staleDir = path.join(tmp, 'lembar-chrome-basi'), freshDir = path.join(tmp, 'lembar-chrome-baru');
    for (const d of [orphanDir, liveDir, staleDir, freshDir]) await fs.mkdir(d);
    const old = new Date(Date.now() - 5 * 60_000);
    for (const d of [orphanDir, liveDir, staleDir]) await fs.utimes(d, old, old);

    // "Chrome" yatim: dijalankan lewat sh yang langsung keluar, sehingga induknya jadi PID 1.
    spawn('sh', ['-c', `${JSON.stringify(process.execPath)} -e "setTimeout(()=>{},60000)" -- --user-data-dir=${orphanDir} & exit 0`], { stdio: 'ignore' });
    // "Chrome" milik server yang masih hidup: induknya proses tes ini.
    const live = spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)', '--', `--user-data-dir=${liveDir}`], { stdio: 'ignore' });
    try {
      let orphanPid = null;
      for (let i = 0; i < 50 && !(orphanPid && await ppidOf(orphanPid) === 1); i++) {
        await new Promise(r => setTimeout(r, 100));
        orphanPid = await findPid(orphanDir);
      }
      assert.equal(await ppidOf(orphanPid), 1, 'proses uji belum yatim');

      const r = await cleanupOrphans({ tmpDir: tmp });
      assert.deepEqual(r.killed, [orphanPid]);
      await new Promise(res => setTimeout(res, 300));
      assert.equal(alive(orphanPid), false, 'Chrome yatim masih hidup');
      assert.equal(alive(live.pid), true, 'Chrome milik server hidup ikut dimatikan');
      assert.deepEqual(r.removed.sort(), ['lembar-chrome-basi', 'lembar-chrome-yatim']);
      assert.deepEqual((await fs.readdir(tmp)).sort(), ['lembar-chrome-baru', 'lembar-chrome-hidup']);
    } finally {
      live.kill();
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
