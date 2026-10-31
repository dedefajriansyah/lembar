import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  createStore, writeFileAtomic, parseNote, serializeNote, idFromDate, isoWib,
  isValidId, defaultNotesDir, NoteError,
} from '../lib/notes.js';
import { titleOf, tagsOf } from '../lib/text.js';

const silent = { warn() {}, error() {} };
let root, dir;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'lembar-test-'));
  dir = path.join(root, 'notes');
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

// Jam tetap: 7 Okt 2026 02:14:00 UTC = 09:14:00 WIB
const FIXED = new Date('2026-10-07T02:14:00Z');
const store = (opts = {}) => createStore({ dir, now: () => FIXED, log: silent, ...opts }).init();
const rejectsWith = (p, status) => assert.rejects(p, e => e instanceof NoteError && e.status === status);

describe('ID dan waktu', () => {
  test('ID berbasis waktu WIB', () => {
    assert.equal(idFromDate(FIXED), '20261007-091400');
    assert.equal(isoWib(FIXED), '2026-10-07T09:14:00+07:00');
    // lewat tengah malam WIB tapi belum di UTC
    assert.equal(idFromDate(new Date('2026-10-06T17:30:05Z')), '20261007-003005');
  });

  test('init membuat folder catatan dan .trash', async () => {
    await store();
    assert.ok((await fs.stat(path.join(dir, '.trash'))).isDirectory());
  });

  test('NOTES_DIR dari env, mendukung ~', () => {
    assert.equal(defaultNotesDir({ NOTES_DIR: '~/x/notes' }), path.join(os.homedir(), 'x/notes'));
    assert.equal(defaultNotesDir({}), path.join(os.homedir(), 'Documents/06-Archive/Lembar/notes'));
  });

  test('catatan di detik yang sama mendapat akhiran', async () => {
    const s = await store();
    const [a, b, c] = await Promise.all([s.create(), s.create(), s.create()]);
    assert.deepEqual([a.id, b.id, c.id].sort(), ['20261007-091400', '20261007-091400-2', '20261007-091400-3']);
    assert.equal((await fs.readdir(dir)).filter(f => f.endsWith('.md')).length, 3);
  });
});

describe('tulis atomik', () => {
  test('isi benar, tidak ada file sementara tersisa, file diganti lewat rename', async () => {
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'a.md');
    await writeFileAtomic(file, 'satu');
    const ino1 = (await fs.stat(file)).ino;
    await writeFileAtomic(file, 'dua');
    assert.equal(await fs.readFile(file, 'utf8'), 'dua');
    // inode baru = file lama diganti utuh (rename), bukan ditulis ulang di tempat
    assert.notEqual((await fs.stat(file)).ino, ino1);
    assert.deepEqual(await fs.readdir(dir), ['a.md']);
  });

  test('kalau rename gagal, target lama utuh dan file sementara dibersihkan', async () => {
    await fs.mkdir(path.join(dir, 'target.md'), { recursive: true }); // rename ke direktori pasti gagal
    await assert.rejects(writeFileAtomic(path.join(dir, 'target.md'), 'x'));
    assert.deepEqual(await fs.readdir(dir), ['target.md']);
  });

  test('update menulis atomik (file sementara di folder yang sama tidak tertinggal)', async () => {
    const s = await store();
    const n = await s.create({ body: '# A' });
    const ino = (await fs.stat(path.join(dir, `${n.id}.md`))).ino;
    await s.update(n.id, { body: '# B' });
    assert.notEqual((await fs.stat(path.join(dir, `${n.id}.md`))).ino, ino);
    assert.deepEqual((await fs.readdir(dir)).sort(), ['.trash', `${n.id}.md`]);
  });

  test('init membersihkan file sementara sisa crash', async () => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, '.20261007-091400.md.tmp-abc123'), 'sisa');
    await store();
    assert.deepEqual(await fs.readdir(dir), ['.trash']);
  });
});

describe('frontmatter', () => {
  const tricky = '# Judul\n\nIsi dengan --- di tengah\n---\nkey: value\n\n```\n---\n```\nTanpa newline di akhir';

  test('serialize -> parse mengembalikan isi dan metadata persis', () => {
    for (const body of [tricky, '', '\n', 'a\n\n\n', '---\nbukan: frontmatter\n---\n', 'émoji 🍃 & CJK 漢字']) {
      const meta = { created: '2026-10-07T09:14:00+07:00', pinned: true, locked: false };
      const back = parseNote(serializeNote(meta, body), '20261007-091400');
      assert.equal(back.body, body);
      assert.deepEqual(back.meta, meta);
    }
  });

  test('file di disk: created dikutip, metadata di frontmatter', async () => {
    const s = await store();
    const n = await s.create({ body: tricky, pinned: true });
    const raw = await fs.readFile(path.join(dir, `${n.id}.md`), 'utf8');
    assert.equal(raw, `---\ncreated: '2026-10-07T09:14:00+07:00'\npinned: true\nlocked: false\n---\n${tricky}`);
    assert.equal((await s.get(n.id)).body, tricky);
  });

  test('round-trip lewat store mempertahankan isi, created, dan key tambahan', async () => {
    await fs.mkdir(dir, { recursive: true });
    // ditulis tangan: created tanpa kutip (jadi Date di YAML) dan ada key buatan pengguna
    await fs.writeFile(path.join(dir, '20250101-080000.md'),
      '---\ncreated: 2025-01-01T08:00:00+07:00\naliases: [satu, dua]\n---\n# Lama\n');
    const s = await store();
    const before = await s.get('20250101-080000');
    assert.equal(before.created, '2025-01-01T08:00:00+07:00');
    await s.update('20250101-080000', { pinned: true });
    const raw = await fs.readFile(path.join(dir, '20250101-080000.md'), 'utf8');
    const { meta, body } = parseNote(raw, '20250101-080000');
    assert.deepEqual(meta, { created: '2025-01-01T08:00:00+07:00', pinned: true, locked: false, aliases: ['satu', 'dua'] });
    assert.equal(body, '# Lama\n');
  });

  test('file tanpa frontmatter: created dari ID, isi utuh', async () => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, '20240515-230000.md'), '# Polos\n\n#tag');
    const n = await (await store()).get('20240515-230000');
    assert.equal(n.created, '2024-05-15T23:00:00+07:00');
    assert.equal(n.body, '# Polos\n\n#tag');
    assert.equal(n.pinned, false);
  });

  test('frontmatter rusak tidak menghilangkan isi', async () => {
    await fs.mkdir(dir, { recursive: true });
    const raw = '---\n: : [rusak\n---\n# Isi';
    await fs.writeFile(path.join(dir, '20240515-230000.md'), raw);
    assert.equal((await (await store()).get('20240515-230000')).body, raw);
  });
});

describe('update dan updated (mtime)', () => {
  test('ubah isi -> mtime berubah; pin/kunci saja -> mtime tetap', async () => {
    const s = await store();
    const n = await s.create({ body: '# A' });
    const file = path.join(dir, `${n.id}.md`);
    const old = new Date('2026-01-01T00:00:00Z');
    await fs.utimes(file, old, old);
    await s.sync(n.id);

    const pinned = await s.update(n.id, { pinned: true, locked: true });
    assert.equal(pinned.updated, old.getTime());
    assert.equal(pinned.pinned, true);
    assert.equal(pinned.locked, true);

    const edited = await s.update(n.id, { body: '# B' });
    assert.ok(edited.updated > old.getTime());
    assert.equal(edited.title, 'B');
    assert.equal(edited.pinned, true);
  });

  test('tidak ada perubahan -> file tidak ditulis', async () => {
    const s = await store();
    const n = await s.create({ body: '# A' });
    const ino = (await fs.stat(path.join(dir, `${n.id}.md`))).ino;
    await s.update(n.id, { body: '# A', pinned: false });
    assert.equal((await fs.stat(path.join(dir, `${n.id}.md`))).ino, ino);
  });

  test('tipe data salah ditolak', async () => {
    const s = await store();
    const n = await s.create();
    await rejectsWith(s.update(n.id, { body: 42 }), 400);
    await rejectsWith(s.update(n.id, { pinned: 'ya' }), 400);
  });
});

describe('indeks: judul, tag, snippet', () => {
  test('judul dari baris pertama tanpa #', () => {
    assert.equal(titleOf('\n\n## Halo dunia  \nisi'), 'Halo dunia');
    assert.equal(titleOf(''), 'Tanpa judul');
    assert.equal(titleOf('#\n'), 'Tanpa judul');
  });

  test('tag bertingkat, huruf kecil, abaikan blok kode dan inline code', () => {
    const body = [
      '# Judul bukan tag',
      'Ada #Kerja/Rapat dan #pribadi, url http://x.com/#anchor bukan tag.',
      '```js',
      '#bukan-tag di dalam kode',
      '```',
      '~~~',
      '#juga-bukan',
      '~~~',
      'Inline `#kode` bukan tag, tapi #ya tag.',
    ].join('\n');
    assert.deepEqual(tagsOf(body).sort(), ['kerja/rapat', 'pribadi', 'ya']);
  });

  test('indeks dibangun ulang saat start dan diperbarui setiap simpan', async () => {
    const s1 = await store();
    const n = await s1.create({ body: '# Rapat\n\n#kerja/rapat\n- [ ] tugas' });
    let [e] = (await store()).list();
    assert.deepEqual({ title: e.title, tags: e.tags, todo: e.todo }, { title: 'Rapat', tags: ['kerja/rapat'], todo: true });
    await s1.update(n.id, { body: '# Rapat\n\n#kerja\n- [x] tugas' });
    [e] = s1.list();
    assert.deepEqual({ tags: e.tags, todo: e.todo }, { tags: ['kerja'], todo: false });
  });

  test('daftar: tersemat dulu, lalu terbaru', async () => {
    let t = Date.parse('2026-10-07T02:00:00Z');
    const s = await store({ now: () => new Date((t += 1000)) });
    const a = await s.create({ body: '# A' });
    const b = await s.create({ body: '# B' });
    await s.create({ body: '# C', pinned: true });
    await fs.utimes(path.join(dir, `${a.id}.md`), new Date(), new Date(Date.now() + 5000));
    await s.sync(a.id);
    assert.deepEqual(s.list().map(n => n.title), ['C', 'A', 'B']);
    assert.ok(b);
  });
});

describe('sampah', () => {
  test('hapus memindahkan ke .trash, pulihkan mengembalikan', async () => {
    const s = await store();
    const n = await s.create({ body: '# Buang' });
    const live = path.join(dir, `${n.id}.md`), trashed = path.join(dir, '.trash', `${n.id}.md`);

    const t = await s.trash(n.id);
    assert.equal(t.trashed, true);
    await assert.rejects(fs.stat(live));
    await fs.stat(trashed);
    assert.equal((await s.get(n.id)).body, '# Buang');
    assert.equal(s.list()[0].trashed, true);

    // indeks dari disk juga tahu catatan ini ada di sampah
    assert.equal((await store()).list()[0].trashed, true);

    const r = await s.restore(n.id);
    assert.equal(r.trashed, false);
    await fs.stat(live);
    await assert.rejects(fs.stat(trashed));
  });

  test('catatan di sampah tidak bisa diubah atau dibuang lagi', async () => {
    const s = await store();
    const n = await s.create();
    await s.trash(n.id);
    await rejectsWith(s.update(n.id, { body: 'x' }), 409);
    await rejectsWith(s.trash(n.id), 409);
  });

  test('hapus permanen hanya dari sampah', async () => {
    const s = await store();
    const n = await s.create();
    await rejectsWith(s.purge(n.id), 409);
    await fs.stat(path.join(dir, `${n.id}.md`));
    await rejectsWith(s.restore(n.id), 409);

    await s.trash(n.id);
    await s.purge(n.id);
    assert.deepEqual(await fs.readdir(path.join(dir, '.trash')), []);
    assert.equal(s.list().length, 0);
    await rejectsWith(s.get(n.id), 404);
  });

  test('pulihkan tidak menimpa file yang sudah ada', async () => {
    const s = await store();
    const n = await s.create({ body: '# Asli' });
    await s.trash(n.id);
    await fs.writeFile(path.join(dir, `${n.id}.md`), '# Penyusup');
    await rejectsWith(s.restore(n.id), 409);
    assert.equal(await fs.readFile(path.join(dir, `${n.id}.md`), 'utf8'), '# Penyusup');
    await fs.stat(path.join(dir, '.trash', `${n.id}.md`));
  });
});

describe('path traversal', () => {
  const evil = [
    '../rahasia', '..', '.', '', '../../etc/passwd', '20261007-091400/../../x',
    '..%2Frahasia', '20261007-091400.md', '.trash/20261007-091400', '/etc/passwd',
    '20261007-091400\0', '20261007-09140', 'a'.repeat(300), null, undefined, 42, ['20261007-091400'],
  ];

  test('isValidId hanya menerima pola ID', () => {
    assert.ok(isValidId('20261007-091400'));
    assert.ok(isValidId('20261007-091400-2'));
    for (const id of evil) assert.equal(isValidId(id), false, String(id));
  });

  test('semua operasi menolak ID berbahaya dengan 400 dan tidak menyentuh file di luar folder', async () => {
    const secret = path.join(root, 'rahasia.md');
    await fs.writeFile(secret, 'jangan disentuh');
    const s = await store();
    await s.create({ body: '# ok' });
    for (const id of evil) {
      await rejectsWith(s.get(id), 400);
      await rejectsWith(s.update(id, { body: 'diretas' }), 400);
      await rejectsWith(s.trash(id), 400);
      await rejectsWith(s.restore(id), 400);
      await rejectsWith(s.purge(id), 400);
    }
    assert.equal(await fs.readFile(secret, 'utf8'), 'jangan disentuh');
    assert.deepEqual((await fs.readdir(root)).sort(), ['notes', 'rahasia.md']);
  });

  test('ID valid yang tidak ada -> 404', async () => {
    const s = await store();
    await rejectsWith(s.get('20000101-000000'), 404);
  });

  test('file dengan nama bukan ID diabaikan saat start', async () => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'catatan lain.md'), '# x');
    assert.equal((await store()).list().length, 0);
  });
});

describe('watcher', () => {
  const waitFor = async (cond, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (cond()) return; await new Promise(r => setTimeout(r, 25)); }
    assert.fail('timeout menunggu watcher');
  };

  test('perubahan dari luar (tambah, ubah, hapus, pindah ke .trash) masuk indeks', async () => {
    const s = await store();
    const changed = [];
    const stop = s.watch({ onChange: id => changed.push(id), delay: 20 });
    // FSEvents (macOS) butuh sesaat sebelum mulai melaporkan; yang terlewat ditangani rescan().
    await new Promise(r => setTimeout(r, 300));
    try {
      const file = path.join(dir, '20250202-101010.md');
      await fs.writeFile(file, '# Dari editor lain\n#luar');
      await waitFor(() => s.list().some(n => n.title === 'Dari editor lain'));
      assert.deepEqual(s.list()[0].tags, ['luar']);

      await fs.writeFile(file, '# Diubah dari luar');
      await waitFor(() => s.list()[0]?.title === 'Diubah dari luar');

      await fs.rename(file, path.join(dir, '.trash', '20250202-101010.md'));
      await waitFor(() => s.list()[0]?.trashed === true);

      await fs.rm(path.join(dir, '.trash', '20250202-101010.md'));
      await waitFor(() => s.list().length === 0);
      assert.ok(changed.includes('20250202-101010'));
    } finally {
      stop();
    }
  });
});

describe('pencarian dan konflik', () => {
  test('cari di isi tanpa beda huruf; catatan terkunci hanya dari judul', async () => {
    let t = Date.parse('2026-10-07T02:00:00Z');
    const s = await store({ now: () => new Date((t += 1000)) });
    await s.create({ body: '# Resep\n\nSambal MATAH pedas' });
    await s.create({ body: '# Server\n\npassword matah', locked: true });
    await s.create({ body: '# Matah juga', locked: true });
    assert.deepEqual(s.list('matah').map(n => n.title).sort(), ['Matah juga', 'Resep']);
    assert.equal(s.list('  ').length, 3);
    assert.equal(s.list('tidak-ada').length, 0);
  });

  test('pencarian ikut diperbarui saat simpan dan hapus permanen', async () => {
    const s = await store();
    const n = await s.create({ body: '# A\n\nkata-lama' });
    await s.update(n.id, { body: '# A\n\nkata-baru' });
    assert.equal(s.list('kata-lama').length, 0);
    assert.equal(s.list('kata-baru').length, 1);
    await s.trash(n.id);
    assert.equal(s.list('kata-baru')[0].trashed, true);
    await s.purge(n.id);
    assert.equal(s.list('kata-baru').length, 0);
  });

  test('baseUpdated lama -> 409 berisi versi terbaru; metadata saja tidak dicek', async () => {
    const s = await store();
    const n = await s.create({ body: '# A' });
    const file = path.join(dir, `${n.id}.md`);
    const later = new Date(n.updated + 60_000);
    await fs.writeFile(file, '---\ncreated: x\n---\n# Diubah dari luar');
    await fs.utimes(file, later, later);

    await assert.rejects(s.update(n.id, { body: '# Dari editor', baseUpdated: n.updated }), e => {
      assert.equal(e.status, 409);
      assert.equal(e.note.body, '# Diubah dari luar');
      return true;
    });
    assert.equal(await fs.readFile(file, 'utf8'), '---\ncreated: x\n---\n# Diubah dari luar');

    const pinned = await s.update(n.id, { pinned: true, baseUpdated: n.updated });
    assert.equal(pinned.pinned, true);
    const saved = await s.update(n.id, { body: '# Gabungan', baseUpdated: pinned.updated });
    assert.equal(saved.title, 'Gabungan');
  });

  test('sync: tulisan store sendiri bukan perubahan, tulisan luar adalah perubahan', async () => {
    const s = await store();
    const n = await s.create({ body: '# A' });
    await s.update(n.id, { body: '# B' });
    await s.trash(n.id);
    assert.equal(await s.sync(n.id), false);
    await fs.appendFile(path.join(dir, '.trash', `${n.id}.md`), '\nlagi');
    await fs.utimes(path.join(dir, '.trash', `${n.id}.md`), new Date(), new Date(Date.now() + 5000));
    assert.equal(await s.sync(n.id), true);
    assert.equal(await s.sync('20000101-000000'), false);
  });
});

describe('sync mendeteksi perubahan meski mtime sama', () => {
  test('dua penulisan dari luar di milidetik yang sama tidak terlewat', async () => {
    const s = await store();
    const f = path.join(dir, '20250202-101010.md');
    for (let i = 0; i < 50; i++) {
      await fs.writeFile(f, `# A${i}`);
      await s.sync('20250202-101010');
      const st = await fs.stat(f);
      await fs.writeFile(f, `# Isi lain ${i}`);
      await fs.utimes(f, st.atime, new Date(st.mtimeMs));
      assert.equal(await s.sync('20250202-101010'), true);
      assert.equal(s.list()[0].title, `Isi lain ${i}`);
    }
  });
});

describe('rescan', () => {
  test('menemukan perubahan yang terlewat watcher: tambah, ubah, pindah, hapus', async () => {
    const s = await store();
    const a = await s.create({ body: '# A' });
    const b = await s.create({ body: '# B' });
    assert.deepEqual(await s.rescan(), []);

    await fs.writeFile(path.join(dir, '20250101-010101.md'), '# Baru dari luar');
    await fs.writeFile(path.join(dir, `${a.id}.md`), '# A diubah');
    await fs.rename(path.join(dir, `${b.id}.md`), path.join(dir, '.trash', `${b.id}.md`));
    const changed = (await s.rescan()).sort();
    assert.deepEqual(changed, [a.id, b.id, '20250101-010101'].sort());
    assert.equal(s.peek(a.id).title, 'A diubah');
    assert.equal(s.peek(b.id).trashed, true);

    await fs.rm(path.join(dir, '.trash', `${b.id}.md`));
    assert.deepEqual(await s.rescan(), [b.id]);
    assert.equal(s.peek(b.id), null);
  });
});
