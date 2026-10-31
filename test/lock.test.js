import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createLockService } from '../lib/lock.js';
import { createStore } from '../lib/notes.js';
import { createApp } from '../server.js';

let root, dir;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'lembar-lock-'));
  dir = path.join(root, 'notes');
  await fs.mkdir(dir, { recursive: true });
});
afterEach(() => fs.rm(root, { recursive: true, force: true }));
const rejectsWith = (p, status) => assert.rejects(p, e => e.status === status);

describe('layanan kunci', () => {
  test('belum ada kata sandi: unlock ditolak 409; kata sandi terlalu pendek 400', async () => {
    const lock = createLockService({ dir });
    assert.equal(await lock.hasPassword(), false);
    await rejectsWith(lock.unlock('apa saja'), 409);
    await rejectsWith(lock.setPassword({ password: '123' }), 400);
  });

  test('membuat kata sandi: disimpan sebagai hash (bukan teks asli), token langsung valid', async () => {
    const lock = createLockService({ dir });
    const token = await lock.setPassword({ password: 'rahasia-saya' });
    assert.equal(lock.check(token), true);
    const raw = await fs.readFile(path.join(dir, '.lembar', 'lock.json'), 'utf8');
    assert.doesNotMatch(raw, /rahasia-saya/);
    assert.match(JSON.parse(raw).hash, /^[A-Za-z0-9+/=]{80,}$/);
    // instance baru (mis. setelah restart) membaca hash yang sama; token lama tidak berlaku
    const lock2 = createLockService({ dir });
    assert.equal(await lock2.hasPassword(), true);
    assert.equal(lock2.check(token), false);
    assert.equal(lock2.check(await lock2.unlock('rahasia-saya')), true);
  });

  test('kata sandi salah 401; 5x salah -> ditahan 429 sampai waktu tunggu habis', async () => {
    let t = 0;
    const lock = createLockService({ dir, now: () => t, maxFails: 5, lockoutMs: 30_000 });
    await lock.setPassword({ password: 'benar123' });
    for (let i = 0; i < 4; i++) await rejectsWith(lock.unlock('salah'), 401);
    await rejectsWith(lock.unlock('salah'), 401);
    await rejectsWith(lock.unlock('benar123'), 429);   // bahkan yang benar ditahan
    t += 30_001;
    assert.ok(lock.check(await lock.unlock('benar123')));
  });

  test('ganti kata sandi butuh kata sandi lama dan mengakhiri semua sesi', async () => {
    const lock = createLockService({ dir });
    const t1 = await lock.setPassword({ password: 'lama1234' });
    await rejectsWith(lock.setPassword({ current: 'keliru', password: 'baru1234' }), 401);
    await rejectsWith(lock.setPassword({ password: 'baru1234' }), 401);
    const t2 = await lock.setPassword({ current: 'lama1234', password: 'baru1234' });
    assert.equal(lock.check(t1), false);
    assert.equal(lock.check(t2), true);
    await rejectsWith(lock.unlock('lama1234'), 401);
  });

  test('token kedaluwarsa kalau tidak dipakai, diperpanjang kalau dipakai, bisa diakhiri', async () => {
    let t = 0;
    const lock = createLockService({ dir, now: () => t, ttlMs: 1000 });
    const token = await lock.setPassword({ password: 'abcd1234' });
    t = 900; assert.equal(lock.check(token), true);    // dipakai -> diperpanjang sampai 1900
    t = 1800; assert.equal(lock.check(token), true);
    t = 2900; assert.equal(lock.check(token), false);  // diam > 1000 ms
    const t2 = await lock.unlock('abcd1234');
    lock.end(t2);
    assert.equal(lock.check(t2), false);
    assert.equal(lock.check(undefined), false);
  });
});

describe('API: catatan terkunci ditahan di server', () => {
  let server, base, store, lock;
  const req = (method, url, { body, token } = {}) => fetch(base + url, {
    method,
    headers: { ...(body && { 'Content-Type': 'application/json' }), ...(token && { 'X-Lembar-Unlock': token }), Accept: 'application/json' },
    body: body && JSON.stringify(body),
  });

  beforeEach(async () => {
    store = await createStore({ dir, log: { warn() {}, error() {} } }).init();
    lock = createLockService({ dir });
    server = http.createServer();
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    server.on('request', createApp(store, { port, lock }));
    base = `http://127.0.0.1:${port}`;
  });
  afterEach(() => new Promise(r => server.close(r)));

  test('mengunci butuh kata sandi yang sudah dibuat', async () => {
    const n = await store.create({ body: '# Rahasia\n\nisi #tag' });
    assert.equal((await req('PUT', `/api/notes/${n.id}`, { body: { locked: true } })).status, 409);
    assert.equal((await req('POST', '/api/notes', { body: { body: 'x', locked: true } })).status, 409);
  });

  test('tanpa sesi: isi, snippet, tag, PDF, ubah, buka kunci, hapus permanen ditolak; judul tetap ada', async () => {
    const { token } = await (await req('POST', '/api/lock/password', { body: { password: 'kunci123' } })).json();
    const n = await store.create({ body: '# Rahasia\n\nPIN 4321 #pribadi' });
    // mengunci catatan lain boleh tanpa sesi
    assert.equal((await req('PUT', `/api/notes/${n.id}`, { body: { locked: true } })).status, 200);

    const list = await (await req('GET', '/api/notes')).json();
    assert.deepEqual({ title: list[0].title, snippet: list[0].snippet, tags: list[0].tags }, { title: 'Rahasia', snippet: '', tags: [] });

    const get = await req('GET', `/api/notes/${n.id}`);
    assert.equal(get.status, 423);
    const getBody = await get.json();
    assert.equal(getBody.note.body, undefined);
    assert.doesNotMatch(JSON.stringify(getBody), /4321/);

    assert.equal((await req('PUT', `/api/notes/${n.id}`, { body: { body: 'ditimpa' } })).status, 423);
    assert.equal((await req('PUT', `/api/notes/${n.id}`, { body: { locked: false } })).status, 423);
    assert.equal((await req('GET', `/api/notes/${n.id}/pdf`)).status, 423);
    assert.equal((await (await req('GET', '/api/notes?q=4321')).json()).length, 0);

    // dengan sesi: semuanya terbuka
    const full = await (await req('GET', `/api/notes/${n.id}`, { token })).json();
    assert.match(full.body, /PIN 4321/);
    assert.deepEqual((await (await req('GET', '/api/notes', { token })).json())[0].tags, ['pribadi']);
    assert.equal((await req('PUT', `/api/notes/${n.id}`, { body: { body: '# Rahasia\n\nbaru' }, token })).status, 200);

    // sesi diakhiri -> tertutup lagi
    assert.equal((await req('DELETE', '/api/lock/session', { token })).status, 204);
    assert.equal((await req('GET', `/api/notes/${n.id}`, { token })).status, 423);

    // hapus permanen dari Sampah juga butuh sesi
    await req('DELETE', `/api/notes/${n.id}`);
    assert.equal((await req('DELETE', `/api/trash/${n.id}`)).status, 423);
    assert.equal((await fs.readdir(path.join(dir, '.trash'))).length, 1);
  });

  test('unlock: salah 401, benar memberi token; status /api/lock', async () => {
    await req('POST', '/api/lock/password', { body: { password: 'kunci123' } });
    assert.equal((await req('POST', '/api/lock/unlock', { body: { password: 'salah' } })).status, 401);
    const { token } = await (await req('POST', '/api/lock/unlock', { body: { password: 'kunci123' } })).json();
    assert.deepEqual(await (await req('GET', '/api/lock', { token })).json(), { hasPassword: true, unlocked: true });
    assert.deepEqual(await (await req('GET', '/api/lock')).json(), { hasPassword: true, unlocked: false });
  });

  test('file lock.json di folder catatan tidak dianggap catatan', async () => {
    await req('POST', '/api/lock/password', { body: { password: 'kunci123' } });
    const fresh = await createStore({ dir, log: { warn() {}, error() {} } }).init();
    assert.equal(fresh.list().length, 0);
  });
});
