// Penyimpanan catatan: satu catatan = satu file .md di NOTES_DIR.
// Metadata (created, pinned, locked) ada di frontmatter YAML; updated = mtime file.
// Ringkasan semua catatan disimpan di indeks memori; isi lengkap dibaca dari disk saat diminta.

import fs from 'node:fs/promises';
import { existsSync, watch as fsWatch } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import matter from 'gray-matter';
import { titleOf, tagsOf, snippetOf, hasOpenTodo } from './text.js';

export const TZ = 'Asia/Jakarta';
export const TRASH_DIR = '.trash';

// 20261007-091400, opsional akhiran -2, -3, ... kalau dibuat di detik yang sama.
const ID_RE = /^\d{8}-\d{6}(?:-\d{1,4})?$/;
const TMP_RE = /^\..+\.tmp-[0-9a-f]+$/;

export class NoteError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'NoteError';
    this.status = status;
  }
}

export const isValidId = id => typeof id === 'string' && ID_RE.test(id);

function assertId(id) {
  if (!isValidId(id)) throw new NoteError(400, 'ID catatan tidak valid');
}

export function defaultNotesDir(env = process.env) {
  const raw = env.NOTES_DIR?.trim();
  if (!raw) return path.join(os.homedir(), 'Documents', '06-Archive', 'Lembar', 'notes');
  return path.resolve(raw.replace(/^~(?=$|\/)/, os.homedir()));
}

/* ===== Waktu WIB ===== */

const wibFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});
function wibParts(date) {
  return Object.fromEntries(wibFmt.formatToParts(date).map(p => [p.type, p.value]));
}
export function idFromDate(date) {
  const p = wibParts(date);
  return `${p.year}${p.month}${p.day}-${p.hour}${p.minute}${p.second}`;
}
// Asia/Jakarta tidak punya DST, jadi offset selalu +07:00.
export function isoWib(date) {
  const p = wibParts(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+07:00`;
}
function createdFromId(id) {
  const [, y, mo, d, h, mi, s] = id.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
  return `${y}-${mo}-${d}T${h}:${mi}:${s}+07:00`;
}

/* ===== File ===== */

/** Tulis atomik: file sementara di folder yang sama, fsync, lalu rename. */
export async function writeFileAtomic(file, data) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.tmp-${crypto.randomBytes(6).toString('hex')}`);
  let fh;
  try {
    fh = await fs.open(tmp, 'wx');
    await fh.writeFile(data, 'utf8');
    await fh.sync();
    await fh.close();
    fh = null;
    await fs.rename(tmp, file);
  } catch (err) {
    await fh?.close().catch(() => {});
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

// mtime presisi penuh + ukuran + inode. Lebih teliti dari `updated` (dibulatkan ke ms), supaya dua
// penulisan dari luar dalam milidetik yang sama tetap terdeteksi. ctime sengaja tidak dipakai:
// rename milik store sendiri (buang/pulihkan) mengubah ctime dan akan dikira perubahan dari luar.
const stampOf = st => `${st.mtimeMs}:${st.size}:${st.ino}`;

const statOrNull = p => fs.stat(p).catch(e => (e.code === 'ENOENT' ? null : Promise.reject(e)));

export function parseNote(raw, id) {
  let data = {}, body = raw;
  try {
    // Opsi {} sengaja dioper: tanpa opsi gray-matter meng-cache hasil per isi string
    // dan mengembalikan objek data yang sama berulang kali.
    ({ data, content: body } = matter(raw, {}));
  } catch {
    // Frontmatter rusak: perlakukan seluruh file sebagai isi supaya tidak ada yang hilang.
  }
  let created = data.created;
  // YAML membaca timestamp tanpa kutip sebagai Date.
  if (created instanceof Date && !isNaN(created)) created = isoWib(created);
  if (typeof created !== 'string' || isNaN(Date.parse(created))) created = createdFromId(id);
  return { meta: { ...data, created, pinned: data.pinned === true, locked: data.locked === true }, body };
}

export function serializeNote(meta, body) {
  const { created, pinned, locked, ...extra } = meta;
  const yaml = matter.engines.yaml.stringify({ created, pinned, locked, ...extra });
  // Disusun manual karena matter.stringify menambahkan "\n" di akhir isi,
  // sehingga isi tidak kembali persis sama saat dibaca ulang.
  return `---\n${yaml}---\n${body}`;
}

/* ===== Store ===== */

export function createStore({ dir = defaultNotesDir(), now = () => new Date(), log = console } = {}) {
  dir = path.resolve(dir);
  const trashDir = path.join(dir, TRASH_DIR);
  const index = new Map();   // id -> ringkasan
  const texts = new Map();   // id -> isi huruf kecil, untuk pencarian
  const stamps = new Map();  // id -> sidik file terakhir yang dibaca (lihat stampOf)
  const reserved = new Set(); // ID yang sedang dibuat
  const locks = new Map();   // id -> promise antrean operasi

  const fileOf = (id, trashed) => {
    const base = trashed ? trashDir : dir;
    const file = path.join(base, `${id}.md`);
    // Lapisan kedua di samping validasi ID: hasil akhir harus tetap di dalam folder.
    if (path.dirname(file) !== base) throw new NoteError(400, 'ID catatan tidak valid');
    return file;
  };

  // Operasi pada ID yang sama dijalankan berurutan.
  function withLock(id, fn) {
    const prev = locks.get(id) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => {});
    locks.set(id, tail);
    tail.then(() => { if (locks.get(id) === tail) locks.delete(id); });
    return run;
  }

  async function readNote(id, trashed) {
    const file = fileOf(id, trashed);
    const [raw, st] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)]);
    const { meta, body } = parseNote(raw, id);
    const entry = {
      id,
      title: titleOf(body),
      snippet: snippetOf(body),
      tags: tagsOf(body),
      todo: hasOpenTodo(body),
      pinned: meta.pinned,
      locked: meta.locked,
      created: meta.created,
      updated: Math.round(st.mtimeMs),
      trashed,
    };
    index.set(id, entry);
    texts.set(id, body.toLowerCase());
    stamps.set(id, stampOf(st));
    return { entry, meta, body, stat: st };
  }

  function requireEntry(id) {
    assertId(id);
    const entry = index.get(id);
    if (!entry) throw new NoteError(404, 'Catatan tidak ditemukan');
    return entry;
  }

  const summary = e => ({ ...e, tags: [...e.tags] });
  const forget = id => { index.delete(id); texts.delete(id); stamps.delete(id); };

  return {
    dir,
    trashDir,

    async init() {
      await fs.mkdir(trashDir, { recursive: true });
      index.clear();
      texts.clear();
      stamps.clear();
      for (const [base, trashed] of [[dir, false], [trashDir, true]]) {
        for (const name of await fs.readdir(base)) {
          if (TMP_RE.test(name)) { await fs.rm(path.join(base, name), { force: true }); continue; }
          if (!name.endsWith('.md')) continue;
          const id = name.slice(0, -3);
          if (!isValidId(id)) { log.warn(`[lembar] dilewati, nama file bukan ID catatan: ${path.join(base, name)}`); continue; }
          if (index.has(id)) { log.warn(`[lembar] ${id} ada di folder catatan dan .trash; yang di .trash diabaikan`); continue; }
          await readNote(id, trashed);
        }
      }
      return this;
    },

    /**
     * Daftar ringkasan, tersemat dulu lalu terbaru. Dengan query, hanya catatan yang
     * isinya cocok (tanpa beda huruf besar/kecil); catatan terkunci hanya dicari dari judulnya.
     */
    list(query = '') {
      const q = String(query).trim().toLowerCase();
      return [...index.values()]
        .filter(e => !q || (e.locked ? e.title.toLowerCase() : texts.get(e.id) ?? '').includes(q))
        .sort((a, b) => (b.pinned - a.pinned) || (b.updated - a.updated))
        .map(summary);
    },

    async get(id) {
      assertId(id);
      return withLock(id, async () => {
        const entry = requireEntry(id);
        const { entry: e, body } = await readNote(id, entry.trashed);
        return { ...summary(e), body };
      });
    },

    async create({ body = '', pinned = false, locked = false } = {}) {
      checkFields({ body, pinned, locked });
      const date = now();
      const base = idFromDate(date);
      let id = base;
      for (let n = 2; index.has(id) || reserved.has(id) || existsSync(fileOf(id, false)) || existsSync(fileOf(id, true)); n++) {
        id = `${base}-${n}`;
      }
      reserved.add(id);
      try {
        return await withLock(id, async () => {
          await writeFileAtomic(fileOf(id, false), serializeNote({ created: isoWib(date), pinned, locked }, body));
          const { entry, body: b } = await readNote(id, false);
          return { ...summary(entry), body: b };
        });
      } finally {
        reserved.delete(id);
      }
    },

    async update(id, patch = {}) {
      const { body, pinned, locked, baseUpdated } = patch;
      checkFields({ body, pinned, locked });
      if (baseUpdated !== undefined && !Number.isFinite(baseUpdated)) throw new NoteError(400, 'baseUpdated harus angka');
      assertId(id);
      return withLock(id, async () => {
        const entry = requireEntry(id);
        if (entry.trashed) throw new NoteError(409, 'Catatan ada di Sampah; pulihkan dulu sebelum diubah');
        const cur = await readNote(id, false);
        // Isi di disk sudah berubah sejak klien terakhir memuatnya (mis. diedit dari luar).
        if (baseUpdated !== undefined && body !== undefined && baseUpdated !== cur.entry.updated) {
          throw Object.assign(new NoteError(409, 'Catatan sudah berubah di luar editor ini'), { note: { ...summary(cur.entry), body: cur.body } });
        }
        const meta = { ...cur.meta };
        if (pinned !== undefined) meta.pinned = pinned;
        if (locked !== undefined) meta.locked = locked;
        const nextBody = body ?? cur.body;
        const bodyChanged = nextBody !== cur.body;
        const metaChanged = meta.pinned !== cur.meta.pinned || meta.locked !== cur.meta.locked;
        if (!bodyChanged && !metaChanged) return { ...summary(cur.entry), body: cur.body };

        const file = fileOf(id, false);
        await writeFileAtomic(file, serializeNote(meta, nextBody));
        // Perubahan metadata saja (pin/kunci) tidak dianggap mengubah catatan.
        if (!bodyChanged) await fs.utimes(file, cur.stat.atimeMs / 1000, cur.stat.mtimeMs / 1000);
        const { entry: e, body: b } = await readNote(id, false);
        return { ...summary(e), body: b };
      });
    },

    async trash(id) {
      assertId(id);
      return withLock(id, async () => {
        const entry = requireEntry(id);
        if (entry.trashed) throw new NoteError(409, 'Catatan sudah ada di Sampah');
        await moveNoClobber(fileOf(id, false), fileOf(id, true));
        entry.trashed = true;
        return summary(entry);
      });
    },

    async restore(id) {
      assertId(id);
      return withLock(id, async () => {
        const entry = requireEntry(id);
        if (!entry.trashed) throw new NoteError(409, 'Catatan tidak ada di Sampah');
        await moveNoClobber(fileOf(id, true), fileOf(id, false));
        entry.trashed = false;
        return summary(entry);
      });
    },

    async purge(id) {
      assertId(id);
      return withLock(id, async () => {
        const entry = requireEntry(id);
        if (!entry.trashed) throw new NoteError(409, 'Hanya catatan di Sampah yang bisa dihapus permanen');
        await fs.unlink(fileOf(id, true));
        forget(id);
      });
    },

    /**
     * Sinkronkan satu ID dengan kondisi di disk (dipakai watcher).
     * Mengembalikan true kalau indeks berubah. Tulisan dari store sendiri sudah tercatat
     * di indeks, jadi hasilnya false untuk itu.
     */
    async sync(id) {
      if (!isValidId(id)) return false;
      return withLock(id, async () => {
        const live = await statOrNull(fileOf(id, false));
        const st = live ?? await statOrNull(fileOf(id, true));
        if (!st) return index.has(id) ? (forget(id), true) : false;
        const trashed = !live;
        const e = index.get(id);
        if (e && e.trashed === trashed && stamps.get(id) === stampOf(st)) return false;
        try {
          await readNote(id, trashed);
        } catch (err) {
          if (err.code !== 'ENOENT') throw err; // file hilang lagi di tengah jalan
          return index.has(id) ? (forget(id), true) : false;
        }
        return true;
      });
    },

    /**
     * Cocokkan ulang seluruh folder dengan indeks. Jaring pengaman untuk event watcher yang
     * hilang (FSEvents butuh waktu "pemanasan" dan bisa membuang event saat sistem sibuk).
     * Mengembalikan ID yang berubah.
     */
    async rescan() {
      const ids = new Set(index.keys());
      for (const base of [dir, trashDir]) {
        for (const name of await fs.readdir(base).catch(() => [])) {
          if (name.endsWith('.md') && isValidId(name.slice(0, -3))) ids.add(name.slice(0, -3));
        }
      }
      const changed = [];
      for (const id of ids) if (await this.sync(id)) changed.push(id);
      return changed;
    },

    /** Ringkasan satu catatan dari indeks, atau null. */
    peek(id) {
      const e = isValidId(id) && index.get(id);
      return e ? summary(e) : null;
    },

    /**
     * Pantau perubahan dari luar aplikasi (editor lain, git pull).
     * onChange(id) dipanggil hanya kalau indeks benar-benar berubah. Mengembalikan fungsi untuk berhenti.
     */
    watch({ onChange, delay = 150 } = {}) {
      const timers = new Map();
      const watcher = fsWatch(dir, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const name = path.basename(filename.toString());
        if (!name.endsWith('.md')) return;
        const id = name.slice(0, -3);
        if (!isValidId(id)) return;
        clearTimeout(timers.get(id));
        timers.set(id, setTimeout(() => {
          timers.delete(id);
          this.sync(id).then(changed => changed && onChange?.(id), err => log.error(`[lembar] gagal sinkron ${id}:`, err));
        }, delay));
      });
      watcher.on('error', err => log.error('[lembar] watcher error:', err));
      return () => { watcher.close(); timers.forEach(clearTimeout); };
    },
  };
}

function checkFields({ body, pinned, locked }) {
  if (body !== undefined && typeof body !== 'string') throw new NoteError(400, 'body harus berupa teks');
  if (pinned !== undefined && typeof pinned !== 'boolean') throw new NoteError(400, 'pinned harus boolean');
  if (locked !== undefined && typeof locked !== 'boolean') throw new NoteError(400, 'locked harus boolean');
}

// fs.rename menimpa tujuan tanpa peringatan; cek dulu supaya tidak ada catatan yang hilang.
async function moveNoClobber(from, to) {
  if (await statOrNull(to)) throw new NoteError(409, `File tujuan sudah ada: ${path.basename(to)}`);
  await fs.rename(from, to);
}
