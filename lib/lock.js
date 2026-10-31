// Kata sandi untuk catatan terkunci (satu untuk semua catatan) dan sesi "terbuka".
//
// Hash scrypt disimpan di NOTES_DIR/.lembar/lock.json supaya ikut pindah bersama folder catatan.
// Membuka kunci memberi token acak yang hanya ada di memori server dan di memori tab browser;
// token kedaluwarsa setelah tidak dipakai (ttlMs) dan hilang saat server restart.
//
// Catatan: file .md di disk tetap teks biasa. Ini mengunci akses lewat Lembar, bukan enkripsi.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { NoteError, writeFileAtomic } from './notes.js';

const scrypt = promisify(crypto.scrypt);
const KDF = { N: 2 ** 15, r: 8, p: 1, keylen: 64 };   // ~32 MB, ~100 ms per percobaan
export const MIN_PASSWORD = 4;

export function createLockService({
  dir,                       // NOTES_DIR
  ttlMs = 30 * 60_000,       // sesi berakhir kalau tidak dipakai selama ini (cadangan; browser menutup setelah 5 menit diam)
  maxFails = 5,
  lockoutMs = 30_000,
  now = () => Date.now(),
} = {}) {
  const file = path.join(dir, '.lembar', 'lock.json');
  const sessions = new Map();   // token -> kedaluwarsa (ms)
  let fails = 0, blockedUntil = 0;
  let cached;                   // isi lock.json (undefined = belum dibaca, null = belum ada kata sandi)

  async function load() {
    if (cached !== undefined) return cached;
    try {
      const data = JSON.parse(await fs.readFile(file, 'utf8'));
      cached = data && typeof data.hash === 'string' && typeof data.salt === 'string' ? data : null;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      cached = null;
    }
    return cached;
  }

  const derive = (password, salt, kdf) =>
    scrypt(password, Buffer.from(salt, 'base64'), kdf.keylen, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * kdf.N * kdf.r });

  async function matches(password) {
    const data = await load();
    if (!data || typeof password !== 'string') return false;
    const expected = Buffer.from(data.hash, 'base64');
    const actual = await derive(password, data.salt, { ...KDF, ...data.kdf, keylen: expected.length });
    return crypto.timingSafeEqual(actual, expected);
  }

  function newSession() {
    const token = crypto.randomBytes(32).toString('base64url');
    sessions.set(token, now() + ttlMs);
    return token;
  }

  /** Cek & batasi percobaan; lempar 429 saat sedang ditahan. */
  async function verify(password) {
    if (now() < blockedUntil) {
      throw new NoteError(429, `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil((blockedUntil - now()) / 1000)} detik.`);
    }
    if (await matches(password)) { fails = 0; return; }
    if (++fails >= maxFails) { fails = 0; blockedUntil = now() + lockoutMs; }
    throw new NoteError(401, 'Kata sandi salah');
  }

  return {
    async hasPassword() { return (await load()) !== null; },

    /** Token valid? Sekaligus memperpanjang masa berlakunya. */
    check(token) {
      if (typeof token !== 'string') return false;
      const exp = sessions.get(token);
      if (!exp) return false;
      if (exp < now()) { sessions.delete(token); return false; }
      sessions.set(token, now() + ttlMs);
      return true;
    },

    async unlock(password) {
      if (!(await load())) throw new NoteError(409, 'Belum ada kata sandi. Buat kata sandi dulu.');
      await verify(password);
      return newSession();
    },

    end(token) { sessions.delete(token); },

    /** Buat kata sandi pertama kali, atau ganti (butuh kata sandi lama). Semua sesi lama diakhiri. */
    async setPassword({ current, password }) {
      if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
        throw new NoteError(400, `Kata sandi minimal ${MIN_PASSWORD} karakter`);
      }
      if (await load()) await verify(current);
      const salt = crypto.randomBytes(16).toString('base64');
      const hash = (await derive(password, salt, KDF)).toString('base64');
      const data = { version: 1, kdf: { N: KDF.N, r: KDF.r, p: KDF.p }, salt, hash };
      await fs.mkdir(path.dirname(file), { recursive: true });
      await writeFileAtomic(file, JSON.stringify(data, null, 2) + '\n');
      cached = data;
      sessions.clear();
      return newSession();
    },
  };
}
