import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, defaultNotesDir, NoteError, TRASH_DIR } from './lib/notes.js';
import { WELCOME } from './lib/welcome.js';
import { createPdfService, contentDisposition, cleanupOrphans } from './lib/pdf.js';
import { createLockService } from './lib/lock.js';

// Hanya loopback: aplikasi ini tidak boleh terjangkau dari jaringan.
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 3210;
const ROOT = path.dirname(fileURLToPath(import.meta.url));

/** Ringkasan catatan terkunci tanpa isi: judul tetap ada (untuk daftar & [[wikilink]]), snippet & tag tidak. */
export const redactLocked = n => (n && n.locked ? { ...n, snippet: '', tags: [], todo: false, body: undefined } : n);

export function createApp(store, { port = PORT, pdf = null, lock = null } = {}) {
  const app = express();
  app.disable('x-powered-by');

  // Tolak Host asing (DNS rebinding) dan Origin asing pada request yang mengubah data,
  // supaya situs lain yang dibuka di browser tidak bisa membaca atau mengubah catatan.
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const origins = new Set([...hosts].map(h => `http://${h}`));
  app.use((req, res, next) => {
    if (!hosts.has(req.headers.host)) return res.status(421).json({ error: 'Host tidak diizinkan' });
    const origin = req.headers.origin;
    if (origin && req.method !== 'GET' && req.method !== 'HEAD' && !origins.has(origin)) {
      return res.status(403).json({ error: 'Origin tidak diizinkan' });
    }
    next();
  });

  app.use(express.json({ limit: '5mb' }));

  /* ===== Frontend ===== */

  app.use(express.static(path.join(ROOT, 'public'), { index: 'index.html' }));
  // Modul yang dipakai bersama server & browser. Sengaja per file, bukan seluruh lib/.
  for (const file of ['text.js', 'render.js', 'highlight.js']) {
    app.get(`/lib/${file}`, (req, res) => res.type('text/javascript').sendFile(path.join(ROOT, 'lib', file)));
  }
  // highlight.js versi ESM (hanya folder es/: core + grammar bahasa).
  app.use('/vendor/hljs/es', express.static(path.join(ROOT, 'node_modules', '@highlightjs', 'cdn-assets', 'es'), { index: false }));
  // Build ESM markdown-it untuk browser, dari paket yang sama dengan yang dipakai server.
  const mdDist = path.join(ROOT, 'node_modules', 'markdown-it', 'dist', 'browser');
  for (const file of ['markdown-it.esm.min.mjs', 'markdown-it.esm.min.mjs.map']) {
    app.get(`/vendor/${file}`, (req, res) => res.type(file.endsWith('.map') ? 'application/json' : 'text/javascript').sendFile(path.join(mdDist, file)));
  }

  const fields = req => {
    const b = req.body ?? {};
    if (typeof b !== 'object' || Array.isArray(b)) throw new NoteError(400, 'Body harus objek JSON');
    const { body, pinned, locked, baseUpdated } = b;
    return { body, pinned, locked, baseUpdated };
  };

  /* ===== Kunci ===== */
  // Token sesi dari POST /api/lock/unlock dikirim browser lewat header ini.
  const authed = req => !!lock && lock.check(req.get('x-lembar-unlock'));
  const requireOpen = (req, id) => {
    const n = store.peek(id);
    if (n?.locked && !authed(req)) throw Object.assign(new NoteError(423, 'Catatan terkunci'), { note: redactLocked(n) });
  };
  const requirePassword = async locked => {
    if (locked === true && !(await lock?.hasPassword())) throw new NoteError(409, 'Buat kata sandi dulu sebelum mengunci catatan');
  };
  const needLock = () => { if (!lock) throw new NoteError(503, 'Fitur kunci tidak tersedia'); };

  app.get('/api/lock', async (req, res) => {
    needLock();
    res.json({ hasPassword: await lock.hasPassword(), unlocked: authed(req) });
  });
  app.post('/api/lock/unlock', async (req, res) => {
    needLock();
    res.json({ token: await lock.unlock(req.body?.password) });
  });
  app.post('/api/lock/password', async (req, res) => {
    needLock();
    res.json({ token: await lock.setPassword({ current: req.body?.current, password: req.body?.password }) });
  });
  app.delete('/api/lock/session', (req, res) => {
    needLock();
    lock.end(req.get('x-lembar-unlock'));
    res.status(204).end();
  });

  /* ===== Catatan ===== */

  app.get('/api/notes', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const open = authed(req);
    res.json(store.list(q).map(n => (open ? n : redactLocked(n))));
  });

  app.get('/api/notes/:id', async (req, res) => {
    requireOpen(req, req.params.id);
    res.json(await store.get(req.params.id));
  });

  app.post('/api/notes', async (req, res) => {
    const { body, pinned, locked } = fields(req);
    await requirePassword(locked);
    const note = await store.create({ body, pinned, locked });
    res.status(201).location(`/api/notes/${note.id}`).json(note);
  });

  app.put('/api/notes/:id', async (req, res) => {
    const f = fields(req);
    requireOpen(req, req.params.id);   // catatan terkunci: tidak bisa diubah/dilepas kuncinya tanpa sesi
    await requirePassword(f.locked);   // mengunci catatan lain boleh tanpa sesi, asal kata sandi sudah ada
    res.json(await store.update(req.params.id, f));
  });

  app.delete('/api/notes/:id', async (req, res) => {
    res.json(await store.trash(req.params.id));
  });

  app.post('/api/notes/:id/restore', async (req, res) => {
    res.json(await store.restore(req.params.id));
  });

  /* ===== Ekspor PDF ===== */

  app.get('/api/notes/:id/pdf', async (req, res) => {
    try {
      requireOpen(req, req.params.id);
      const note = await store.get(req.params.id);
      if (note.trashed) throw new NoteError(409, 'Catatan di Sampah tidak bisa diekspor. Pulihkan dulu.');
      if (!pdf) throw new NoteError(503, 'Ekspor PDF tidak tersedia');
      const buf = await pdf.render(note);
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': contentDisposition(note.title), 'Cache-Control': 'no-store' });
      res.send(buf);
    } catch (err) {
      // Endpoint ini dibuka langsung di tab browser, jadi kesalahan ditampilkan sebagai halaman kecil.
      if (!(err instanceof NoteError) || !req.accepts('html')) throw err;
      res.status(err.status).type('html').send(`<!doctype html><meta charset="utf-8"><title>Ekspor PDF gagal</title>
<body style="font:15px system-ui;max-width:560px;margin:15vh auto;padding:0 20px;color:#1E2A2C">
<h1 style="font-size:19px">Ekspor PDF gagal</h1><p>${escapeHtml(err.message)}</p></body>`);
    }
  });

  app.delete('/api/trash/:id', async (req, res) => {
    requireOpen(req, req.params.id);
    await store.purge(req.params.id);
    res.status(204).end();
  });

  /* ===== Server-Sent Events: perubahan dari luar aplikasi ===== */

  const clients = new Set();
  app.get('/api/events', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    res.write('retry: 2000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
  });
  const heartbeat = setInterval(() => clients.forEach(c => c.write(': ping\n\n')), 25_000);
  heartbeat.unref();

  app.locals.broadcast = (event, data) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    clients.forEach(c => c.write(msg));
  };

  /* ===== Error ===== */

  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan' }));

  app.use((err, req, res, _next) => {
    if (err instanceof NoteError) {
      return res.status(err.status).json({ error: err.message, ...(err.note && { note: err.note }) });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON tidak valid' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Catatan terlalu besar (maks. 5 MB)' });
    console.error(err);
    res.status(500).json({ error: 'Kesalahan server' });
  });

  return app;
}

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function isFirstRun(dir) {
  try {
    const names = await fs.readdir(dir);
    return !names.includes(TRASH_DIR) && !names.some(n => n.endsWith('.md'));
  } catch (err) {
    if (err.code === 'ENOENT') return true;
    throw err;
  }
}

async function main() {
  const dir = defaultNotesDir();
  const firstRun = await isFirstRun(dir);
  const store = await createStore({ dir }).init();
  if (firstRun) await store.create({ body: WELCOME, pinned: true });

  const pdf = createPdfService();
  // Sisa Chrome dari server yang mati mendadak. Dijalankan lagi setelah 90 detik untuk folder profil
  // yang tadinya masih terlalu baru (baru saja ditulis Chrome yatim).
  const tidy = () => cleanupOrphans().then(({ killed, removed }) => {
    if (killed.length || removed.length) console.log(`[lembar] sisa Chrome dibereskan: ${killed.length} proses, ${removed.length} folder profil`);
  }, () => {});
  tidy();
  setTimeout(tidy, 90_000).unref();
  const lock = createLockService({ dir });
  const app = createApp(store, { pdf, lock });
  // SSE tidak membawa token, jadi ringkasan catatan terkunci selalu disamarkan.
  const announce = id => app.locals.broadcast('change', { id, note: redactLocked(store.peek(id)) });
  const stopWatch = store.watch({ onChange: announce });
  // Watcher bisa melewatkan event (saat baru mulai atau sistem sibuk); cocokkan ulang berkala.
  const rescan = () => store.rescan().then(ids => ids.forEach(announce), err => console.error('[lembar] rescan gagal:', err));
  setTimeout(rescan, 2000).unref();
  setInterval(rescan, 30_000).unref();

  const server = app.listen(PORT, HOST, () => {
    console.log(`Lembar berjalan di http://${HOST}:${PORT}`);
    console.log(`Folder catatan: ${dir}`);
  });
  server.on('error', err => {
    console.error(err.code === 'EADDRINUSE' ? `Port ${PORT} sudah dipakai. Jalankan dengan PORT=xxxx.` : err);
    process.exit(1);
  });

  const shutdown = async () => {
    stopWatch();
    await pdf.close();
    server.close(() => process.exit(0));
    server.closeAllConnections(); // koneksi SSE tidak pernah selesai sendiri
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err); process.exit(1); });
}
