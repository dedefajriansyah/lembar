# Lembar → fajriansyah-studio (Laravel): Spesifikasi Pembuatan Ulang

Dokumen ini menjelaskan **apa yang dilakukan Lembar, aturan persisnya, dan cara memetakannya ke Laravel**. Ditulis dari kode sumber Lembar (Node/Express + vanilla JS), supaya bisa dipakai sebagai acuan (atau diberikan ke Claude Code) saat membangun fitur yang sama di dalam fajriansyah-studio.

> Ringkasnya: Lembar adalah aplikasi catatan Markdown pribadi bergaya Bear. Tiga kolom (sidebar · daftar · editor), autosave, tag bertingkat dari `#tag`, `[[wikilink]]`, todo yang bisa dicentang, catatan terkunci dengan satu kata sandi, sampah, ekspor Markdown & PDF A4.

---

## Daftar isi

1. [Gambaran arsitektur asli](#1-gambaran-arsitektur-asli)
2. [Keputusan pemetaan ke Laravel](#2-keputusan-pemetaan-ke-laravel)
3. [Model data](#3-model-data)
4. [Aturan teks: judul, tag, snippet, todo](#4-aturan-teks-judul-tag-snippet-todo)
5. [Format Markdown & renderer](#5-format-markdown--renderer)
6. [API (endpoint, payload, error)](#6-api-endpoint-payload-error)
7. [Catatan terkunci](#7-catatan-terkunci)
8. [Autosave & konflik](#8-autosave--konflik)
9. [Sampah](#9-sampah)
10. [Ekspor Markdown & PDF](#10-ekspor-markdown--pdf)
11. [Perubahan dari luar / tab lain](#11-perubahan-dari-luar--tab-lain)
12. [Frontend: tata letak & perilaku UI](#12-frontend-tata-letak--perilaku-ui)
13. [Editor: toolbar & ketik pintar](#13-editor-toolbar--ketik-pintar)
14. [Pintasan keyboard](#14-pintasan-keyboard)
15. [Desain visual (token)](#15-desain-visual-token)
16. [Struktur file Laravel yang disarankan](#16-struktur-file-laravel-yang-disarankan)
17. [Urutan pengerjaan](#17-urutan-pengerjaan)
18. [Daftar uji (acceptance checklist)](#18-daftar-uji-acceptance-checklist)
19. [Lampiran: teks sambutan & string UI](#19-lampiran-teks-sambutan--string-ui)

---

## 1. Gambaran arsitektur asli

| Lapisan | Lembar (asli) | File sumber |
|---|---|---|
| Server | Express 5, hanya `127.0.0.1:3210` | `server.js` |
| Penyimpanan | Satu catatan = satu file `.md` + frontmatter YAML (`created`, `pinned`, `locked`). Indeks ringkasan di memori. | `lib/notes.js` |
| Aturan teks | Judul/tag/snippet/todo dihitung dari isi (dipakai server & browser) | `lib/text.js` |
| Renderer | markdown-it + plugin custom (dipakai browser **dan** PDF agar identik) | `lib/render.js`, `lib/highlight.js` |
| Kunci | Hash scrypt di `.lembar/lock.json`, token sesi di memori | `lib/lock.js` |
| PDF | puppeteer-core + Chrome terpasang, CSS cetak A4 | `lib/pdf.js`, `lib/print.css` |
| Realtime | Server-Sent Events `/api/events` (perubahan file dari luar) | `server.js` |
| Frontend | SPA vanilla JS tanpa framework, render string HTML | `public/app.js`, `public/editor.js`, `public/style.css` |

Tidak ada konsep user/akun: aplikasi satu orang, lokal. Keamanan andalannya: hanya loopback, cek Host/Origin, HTML mentah di Markdown dimatikan.

---

## 2. Keputusan pemetaan ke Laravel

| Konsep Lembar | Di Laravel (disarankan) | Alasan |
|---|---|---|
| File `.md` per catatan | Tabel `notes` (Eloquent) | Aplikasi web multi-user; query, search, dan backup lebih mudah. Ekspor `.md` tetap ada. |
| Satu pemilik | `user_id` di setiap catatan + Policy | fajriansyah-studio pasti sudah punya auth |
| `created` WIB dari nama file | `created_at` biasa, tampilkan dengan timezone `Asia/Jakarta` | |
| `updated` = mtime file | Kolom `content_updated_at` (hanya berubah kalau **isi** berubah) | Pin/kunci tidak boleh mengubah urutan "terbaru" |
| `baseUpdated` (cek konflik) | Kolom `version` (int, +1 tiap isi berubah) | Lebih andal dari membandingkan timestamp |
| Folder `.trash/` | `SoftDeletes` (`deleted_at`) | Pulihkan = `restore()`, hapus permanen = `forceDelete()` |
| Indeks memori (judul, tag, snippet, todo) | Kolom turunan `title`, `snippet`, `has_open_todo` + tabel `note_tags`, dihitung ulang tiap simpan | Daftar & filter tanpa membaca isi |
| `lock.json` (scrypt) | Kolom `users.notes_lock_hash` (atau tabel `note_lock_settings`) dengan `Hash::make` | |
| Token unlock di memori server | Token acak di **Cache** dengan TTL geser 30 menit, dikirim header `X-Notes-Unlock` | Mempertahankan sifat "reload tab = terkunci lagi" |
| Batas 5 percobaan / 30 detik | `RateLimiter` Laravel | |
| Cek Host/Origin | Middleware `web` + CSRF token (`X-CSRF-TOKEN`) | Laravel sudah menyediakan |
| SSE untuk file berubah dari luar | Tidak wajib. Opsional: Laravel Reverb/Echo, atau polling | Di DB, "perubahan dari luar" = tab/perangkat lain; konflik tetap tertangkap lewat `version` |
| Renderer markdown-it | **Tetap pakai markdown-it di frontend** (port `render.js` + `highlight.js` apa adanya via Vite) | Pratinjau langsung & mode Baca butuh render di browser |
| PDF via puppeteer | `spatie/laravel-pdf` (driver Browsershot) atau Browsershot langsung, merender Blade view cetak | Hasil sama: Chrome headless, CSS cetak yang sama |
| SPA vanilla JS | Opsi A (tercepat): port `app.js`/`editor.js` ke `resources/js/notes/` hampir tanpa ubahan, hanya ganti URL API + header. Opsi B: Livewire/Inertia. | Logika autosave/konflik/editor sudah matang dan tanpa dependensi |

> **Satu renderer, dua tempat.** Di Lembar, browser dan PDF memakai modul `render.js` yang sama supaya hasilnya identik. Pertahankan prinsip ini: untuk PDF, Blade view cetak boleh berisi HTML yang sudah dirender di **browser** (dikirim dari frontend) **atau** biarkan Browsershot menjalankan JS renderer yang sama di halaman cetak. Hindari membuat renderer kedua di PHP (league/commonmark) kecuali siap menyamakan semua plugin custom.

---

## 3. Model data

### 3.1 Migrasi

```php
// database/migrations/xxxx_create_notes_table.php
Schema::create('notes', function (Blueprint $table) {
    $table->ulid('id')->primary();
    $table->foreignId('user_id')->constrained()->cascadeOnDelete();
    $table->longText('body');                       // Markdown mentah, maks ~5 MB
    // Kolom turunan (dihitung dari body setiap simpan, lihat bagian 4)
    $table->string('title', 255)->default('Tanpa judul');
    $table->string('snippet', 160)->default('');
    $table->boolean('has_open_todo')->default(false);
    // Metadata
    $table->boolean('is_pinned')->default(false);
    $table->boolean('is_locked')->default(false);
    $table->unsignedInteger('version')->default(1); // naik hanya saat body berubah
    $table->timestamp('content_updated_at')->useCurrent(); // "Diubah" di UI & urutan daftar
    $table->timestamps();
    $table->softDeletes();                          // Sampah

    $table->index(['user_id', 'deleted_at', 'is_pinned', 'content_updated_at']);
});

Schema::create('note_tags', function (Blueprint $table) {
    $table->id();
    $table->foreignUlid('note_id')->constrained('notes')->cascadeOnDelete();
    $table->string('tag', 191);                     // huruf kecil, lengkap: "produk/roadmap"
    $table->unique(['note_id', 'tag']);
    $table->index('tag');
});

Schema::table('users', function (Blueprint $table) {
    $table->string('notes_lock_hash')->nullable();  // satu kata sandi untuk semua catatan terkunci
});
```

Catatan:
- `note_tags` menyimpan tag **persis seperti hasil `tagsOf()`** (mis. `produk/roadmap`), bukan tiap leluhurnya. Pohon tag dibangun di frontend dari daftar ini.
- Filter tag `produk` cocok dengan `produk` **dan** `produk/…`:
  `whereHas('tags', fn($q) => $q->where('tag', $t)->orWhere('tag', 'like', $t.'/%'))`.
- Kalau ingin, simpan `tags` juga sebagai kolom JSON di `notes` untuk respons daftar tanpa join.

### 3.2 Bentuk ringkasan (respons daftar)

Frontend Lembar memakai bentuk ini. Pertahankan nama field agar `app.js` bisa dipakai ulang:

```json
{
  "id": "01JB...",
  "title": "Rapat mingguan",
  "snippet": "Agenda: ...",          // maks 140 karakter
  "tags": ["kerja", "kerja/rapat"],
  "todo": true,                     // ada todo yang belum dicentang
  "pinned": false,
  "locked": false,
  "created": "2026-10-07T09:14:00+07:00",
  "updated": 1791345240000,         // ms epoch dari content_updated_at
  "version": 3,                     // pengganti baseUpdated
  "trashed": false
}
```

`GET /notes/{id}` menambahkan `"body": "..."`.

### 3.3 Eloquent

```php
class Note extends Model
{
    use HasUlids, SoftDeletes;

    protected $fillable = ['body', 'is_pinned', 'is_locked'];
    protected $casts = [
        'is_pinned' => 'bool', 'is_locked' => 'bool', 'has_open_todo' => 'bool',
        'content_updated_at' => 'datetime',
    ];

    public function tags() { return $this->hasMany(NoteTag::class); }
    public function user() { return $this->belongsTo(User::class); }
}
```

---

## 4. Aturan teks: judul, tag, snippet, todo

Ini **inti perilaku**. Harus identik di PHP (saat simpan, untuk kolom turunan) dan JS (saat mengetik, supaya daftar langsung ter-update). Sumber: `lib/text.js`. Versi JS tinggal disalin; berikut port PHP-nya.

```php
namespace App\Support\Notes;

final class NoteText
{
    public const UNTITLED = 'Tanpa judul';

    // #tag atau #tag/subtag, harus diawali awal baris atau spasi.
    // Jadi "# Judul" dan "url#anchor" BUKAN tag.
    private const TAG_RE = '/(^|\s)#([\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*)/u';
    private const FENCE_OPEN_RE = '/^ {0,3}(`{3,}|~{3,})/';
    private const FENCE_CLOSE_RE = '/^ {0,3}(`{3,}|~{3,})\s*$/';
    private const INLINE_CODE_RE = '/(`+)(?:(?!\1)[\s\S])+?\1/u';
    // Item daftar (boleh bernomor / di dalam kutipan) yang belum dicentang.
    private const OPEN_TODO_RE = '/^(?:[ \t]*>)*[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[ \][ \t]/';

    /** Judul = baris pertama yang tidak kosong, tanpa tanda # di depannya. */
    public static function title(string $body): string
    {
        foreach (explode("\n", $body) as $line) {
            if (trim($line) !== '') {
                $t = trim(preg_replace('/^\s*#+\s*/u', '', $line));
                return $t !== '' ? mb_substr($t, 0, 255) : self::UNTITLED;
            }
        }
        return self::UNTITLED;
    }

    /** Jalankan $fn untuk tiap baris di luar blok kode berpagar; inline code diganti spasi. */
    private static function eachProseLine(string $body, callable $fn): void
    {
        $fence = null;
        foreach (explode("\n", $body) as $line) {
            if ($fence !== null) {
                if (preg_match(self::FENCE_CLOSE_RE, $line, $m)
                    && $m[1][0] === $fence[0] && strlen($m[1]) >= strlen($fence)) {
                    $fence = null;
                }
                continue;
            }
            if (preg_match(self::FENCE_OPEN_RE, $line, $m)) { $fence = $m[1]; continue; }
            $fn(preg_replace(self::INLINE_CODE_RE, ' ', $line));
        }
    }

    /** Tag unik, huruf kecil, mengabaikan blok kode & inline code. */
    public static function tags(string $body): array
    {
        $out = [];
        self::eachProseLine($body, function ($line) use (&$out) {
            if (preg_match_all(self::TAG_RE, $line, $mm)) {
                foreach ($mm[2] as $t) $out[mb_strtolower($t)] = true;
            }
        });
        return array_keys($out);
    }

    public static function hasOpenTodo(string $body): bool
    {
        $found = false;
        self::eachProseLine($body, function ($line) use (&$found) {
            $found = $found || preg_match(self::OPEN_TODO_RE, $line) === 1;
        });
        return $found;
    }

    /** Teks setelah baris judul, tanpa tanda Markdown, maks 140 karakter. */
    public static function snippet(string $body, int $max = 140): string
    {
        $lines = explode("\n", $body);
        $titleIdx = 0;
        foreach ($lines as $i => $l) { if (trim($l) !== '') { $titleIdx = $i; break; } }
        $s = implode(' ', array_slice($lines, $titleIdx + 1));
        $s = preg_replace('/```[\s\S]*?```/u', ' ', $s);
        $s = preg_replace('/[#*`=~>\[\]]|- \[.\]/u', '', $s);
        $s = trim(preg_replace('/\s+/u', ' ', $s));
        return mb_substr($s, 0, $max);
    }

    /** Nama file aman dari judul: ("Rapat: 5/10", "pdf") -> "Rapat- 5-10.pdf". */
    public static function safeFilename(string $title, string $ext): string
    {
        $name = preg_replace('/\s+/u', ' ', $title);
        $name = preg_replace('/[\\\\\/:*?"<>|\x00-\x1f\x7f]/u', '-', $name);
        $name = mb_substr(trim($name), 0, 100);
        return ($name !== '' ? $name : 'catatan') . '.' . $ext;
    }
}
```

> Perhatian kecil pada `snippet` versi JS: kalau tidak ada baris tak-kosong, `findIndex` mengembalikan -1 sehingga slice dimulai dari 0. Hasilnya tetap string kosong untuk isi kosong, jadi port di atas setara.

**Kapan dihitung:** di `NoteService::save()` setiap kali `body` berubah → isi `title`, `snippet`, `has_open_todo`, lalu `sync` tabel `note_tags`.

**Catatan kosong** (`isBlankNote`): `title === 'Tanpa judul' && snippet === ''`. Dipakai untuk membuka catatan langsung di mode Tulis.

---

## 5. Format Markdown & renderer

Sumber: `lib/render.js`, `lib/highlight.js`. Rekomendasi: **salin kedua file ke `resources/js/notes/` dan pakai di frontend via Vite** (`npm i markdown-it @highlightjs/cdn-assets` atau `highlight.js`).

Konfigurasi markdown-it:

```js
new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false })
```

| Fitur | Aturan |
|---|---|
| Baris baru | Satu Enter = `<br>` (`breaks: true`, seperti Bear) |
| HTML mentah | **Tidak dirender**, tampil sebagai teks (`html: false`). Wajib, untuk mencegah XSS. |
| Tautan | Hanya `http:`, `https:`, `mailto:` (`md.validateLink`). Tautan http(s) diberi `target="_blank" rel="noopener noreferrer"`. |
| Autolink | URL `https://…` otomatis jadi tautan (`linkify`) |
| Tabel, `~~coret~~` | Bawaan markdown-it |
| `==sorotan==` | Plugin delimiter → `<mark>`. Boleh berisi format lain (`==**penting**==`). |
| `- [ ] todo` / `- [x]` | `<li class="task [done]"><input type="checkbox" data-line="N" …>`; `<ul>/<ol>` induk diberi kelas `todo`. `data-line` = nomor baris sumber (mulai 0) untuk mencentang. |
| `#tag`, `#tag/sub` | Diawali awal teks atau spasi. → `<a href="#" class="tag" data-tag="tag">#Tag</a>`. Di PDF jadi `<span class="tag">`. |
| `[[Judul]]` | → `<a href="#" class="wikilink" data-link="Judul">Judul</a>`. Di PDF jadi `<span class="wikilink">`. |
| Blok kode | `<pre class="code"><span class="code-lang">PHP</span><code class="hljs language-php"><span class="line">…</span>…</code></pre>`. Setiap baris dibungkus `.line` (span highlight yang melintasi baris ditutup/dibuka ulang per baris) supaya PDF bisa memotong halaman di antara baris. |

Bahasa blok kode (urutan di toolbar; `id` = yang ditulis setelah ```):

`php` PHP · `js` JavaScript · `ts` TypeScript · `html` HTML · `css` CSS · `json` JSON · `sql` SQL · `bash` Bash · `yaml` YAML · `nginx` Nginx · `python` Python · `java` Java · `go` Go · `kotlin` Kotlin · `markdown` Markdown · `diff` Diff · `dockerfile` Dockerfile · `ini` INI · `text` Teks biasa

Grammar highlight.js yang diregistrasi: bash, css, diff, dockerfile, go, ini, java, javascript, json, kotlin, markdown, nginx, php, plaintext, python, shell, sql, typescript, xml, yaml. Alias (`js`, `ts`, `sh`, `yml`, `html`) ikut terpetakan oleh highlight.js. Bahasa tak dikenal: tanpa warna, label ditampilkan apa adanya.

---

## 6. API (endpoint, payload, error)

Semua route di dalam middleware `web` + `auth` (session + CSRF). Prefix contoh: `/studio/notes`. Respons error selalu `{"error": "pesan"}` (beberapa juga membawa `note`).

| Method | Path (Laravel) | Asli | Fungsi |
|---|---|---|---|
| GET | `/api/notes?q=` | sama | Daftar ringkasan semua catatan milik user, **termasuk yang di Sampah** (`trashed: true`). Urut: tersemat dulu, lalu `updated` terbaru. Dengan `q`: hanya yang cocok. |
| GET | `/api/notes/{id}` | sama | Ringkasan + `body`. 423 kalau terkunci & belum dibuka. |
| POST | `/api/notes` | sama | Buat. Body `{body?, pinned?, locked?}` → 201 + catatan lengkap. |
| PUT | `/api/notes/{id}` | sama | Ubah sebagian: `{body?, pinned?, locked?, version?}` |
| DELETE | `/api/notes/{id}` | sama | Pindah ke Sampah (soft delete) → ringkasan |
| POST | `/api/notes/{id}/restore` | sama | Pulihkan dari Sampah → ringkasan |
| DELETE | `/api/trash/{id}` | sama | Hapus permanen (hanya yang di Sampah) → 204 |
| GET | `/api/notes/{id}/pdf` | sama | Unduh PDF A4 |
| GET | `/api/lock` | sama | `{hasPassword, unlocked}` |
| POST | `/api/lock/unlock` | sama | `{password}` → `{token}` |
| POST | `/api/lock/password` | sama | Buat/ganti: `{current?, password}` → `{token}` |
| DELETE | `/api/lock/session` | sama | Akhiri sesi unlock (header token) → 204 |
| GET | `/api/events` | SSE | Opsional (lihat bagian 11) |

### 6.1 Validasi & aturan per endpoint

**Umum**
- Body JSON harus objek; `body` string, `pinned`/`locked` boolean, `version` integer. Selain itu 400 (`"body harus berupa teks"`, `"pinned harus boolean"`, `"locked harus boolean"`).
- Ukuran maks body request 5 MB → 413 `"Catatan terlalu besar (maks. 5 MB)"`.
- Catatan milik user lain → 404 (jangan bocorkan keberadaannya). Pakai Policy / scope `where('user_id', auth()->id())`.

**GET /api/notes**
- Pencarian `q` (trim, case-insensitive): catatan biasa dicari di **seluruh isi**; catatan terkunci **hanya dari judulnya** (selalu, walau sedang dibuka).
  ```php
  $q = mb_strtolower(trim($request->query('q', '')));
  $query->when($q !== '', fn($w) => $w->where(fn($x) => $x
      ->where(fn($a) => $a->where('is_locked', false)->whereRaw('LOWER(body) LIKE ?', ["%{$q}%"]))
      ->orWhere(fn($b) => $b->where('is_locked', true)->whereRaw('LOWER(title) LIKE ?', ["%{$q}%"]))));
  ```
  (Escape `%`/`_` di `$q`. Untuk data besar pertimbangkan FULLTEXT / Scout.)
- Kalau sesi unlock **tidak** valid: catatan terkunci disamarkan (lihat 7.3).
- Pakai `withTrashed()`: frontend butuh catatan Sampah untuk hitungan & filter Sampah.

**POST /api/notes**
- `locked: true` padahal user belum punya kata sandi → 409 `"Buat kata sandi dulu sebelum mengunci catatan"`.
- Respons 201, header `Location: /api/notes/{id}`.

**PUT /api/notes/{id}**
1. Catatan di Sampah → 409 `"Catatan ada di Sampah; pulihkan dulu sebelum diubah"`.
2. Catatan terkunci & sesi tidak valid → 423 `"Catatan terkunci"` + `note` (versi disamarkan). Ini berlaku juga untuk melepas kunci (`locked:false`).
3. `locked: true` tanpa kata sandi → 409 seperti di atas. (Mengunci catatan yang **belum** terkunci boleh tanpa sesi, asal kata sandi sudah ada.)
4. **Cek konflik**: kalau `version` dikirim **dan** `body` dikirim **dan** `version !== $note->version` → 409 `"Catatan sudah berubah di luar editor ini"` + `note` lengkap (dengan `body`) versi server.
5. Tidak ada perubahan nyata (body & meta sama) → kembalikan apa adanya, jangan tulis.
6. Body berubah → `version++`, `content_updated_at = now()`, hitung ulang kolom turunan + tag.
7. Hanya meta (pin/kunci) berubah → **jangan** ubah `version` maupun `content_updated_at`.
8. Kunci operasi per catatan: bungkus dalam `DB::transaction` + `lockForUpdate()` supaya dua simpan berurutan.

**DELETE /api/notes/{id}** — sudah di Sampah → 409 `"Catatan sudah ada di Sampah"`. Tidak butuh sesi unlock.

**POST /restore** — tidak di Sampah → 409 `"Catatan tidak ada di Sampah"`.

**DELETE /api/trash/{id}** — butuh sesi unlock kalau terkunci (423). Tidak di Sampah → 409 `"Hanya catatan di Sampah yang bisa dihapus permanen"`. `forceDelete()` → 204.

**GET /pdf** — terkunci tanpa sesi → 423; di Sampah → 409 `"Catatan di Sampah tidak bisa diekspor. Pulihkan dulu."`. Kalau request menerima HTML (dibuka langsung di tab), tampilkan halaman error kecil "Ekspor PDF gagal" + pesan, bukan JSON.

### 6.2 Tabel kode status

| Kode | Arti di Lembar |
|---|---|
| 400 | Input tidak valid / JSON tidak valid |
| 401 | Kata sandi salah |
| 404 | Catatan tidak ditemukan / endpoint tidak ada |
| 409 | Konflik keadaan (Sampah, belum ada kata sandi, isi berubah di tempat lain) |
| 413 | Terlalu besar |
| 423 | Catatan terkunci, perlu sesi unlock |
| 429 | Terlalu banyak percobaan kata sandi |
| 503 | Fitur PDF/kunci tidak tersedia (mis. Chrome tidak ada) |

---

## 7. Catatan terkunci

### 7.1 Konsep
- **Satu kata sandi per user** untuk semua catatan terkunci. Minimal 4 karakter.
- Dibuat otomatis lewat dialog saat pertama kali mengunci catatan, atau lewat ikon kunci di kaki sidebar.
- Membuka kunci memberi **token sesi** yang hanya disimpan di memori JS tab (bukan cookie/localStorage) → reload = terkunci lagi.
- Sesi berakhir: `⌘⌥L`, `⌘⇧L` pada catatan terkunci yang terbuka, reload, **5 menit tanpa aktivitas** (timer di browser: pointerdown/keydown/wheel/input), atau 30 menit tidak dipakai di server (cadangan, TTL geser).
- Mengunci sebuah catatan saat sesi sedang terbuka → sesi langsung diakhiri (catatan yang baru dikunci langsung tertutup).
- Mengganti kata sandi butuh kata sandi lama dan **mengakhiri semua sesi lama**, lalu mengembalikan token baru.
- Salah 5× → tahan 30 detik: 429 `"Terlalu banyak percobaan. Coba lagi dalam N detik."`.
- Isi tidak dienkripsi di database (sama seperti asli: "kunci menahan akses lewat aplikasi, bukan enkripsi"). Kalau mau lebih, enkripsi `body` dengan cast `encrypted` — tapi pencarian isi jadi tidak bisa.

### 7.2 Implementasi Laravel

```php
final class NoteLockService
{
    private const TTL = 30 * 60;           // detik, geser tiap dipakai
    public const MIN_PASSWORD = 4;

    public function hasPassword(User $u): bool { return $u->notes_lock_hash !== null; }

    public function check(User $u, ?string $token): bool
    {
        if (!$token) return false;
        $key = "notes-unlock:{$u->id}:" . hash('sha256', $token);
        if (!Cache::has($key)) return false;
        Cache::put($key, true, self::TTL);   // perpanjang
        return true;
    }

    public function unlock(User $u, ?string $password): string
    {
        if (!$this->hasPassword($u)) abort(409, 'Belum ada kata sandi. Buat kata sandi dulu.');
        $this->verify($u, $password);
        return $this->newSession($u);
    }

    public function setPassword(User $u, ?string $current, ?string $password): string
    {
        if (!is_string($password) || mb_strlen($password) < self::MIN_PASSWORD)
            abort(400, 'Kata sandi minimal 4 karakter');
        if ($this->hasPassword($u)) $this->verify($u, $current);
        $u->forceFill(['notes_lock_hash' => Hash::make($password)])->save();
        $this->endAll($u);                   // semua sesi lama diakhiri
        return $this->newSession($u);
    }

    public function end(User $u, ?string $token): void
    {
        if ($token) Cache::forget("notes-unlock:{$u->id}:" . hash('sha256', $token));
    }

    private function verify(User $u, ?string $password): void
    {
        $key = "notes-lock-attempts:{$u->id}";
        if (RateLimiter::tooManyAttempts($key, 5)) {
            abort(429, 'Terlalu banyak percobaan. Coba lagi dalam ' . RateLimiter::availableIn($key) . ' detik.');
        }
        if (is_string($password) && Hash::check($password, $u->notes_lock_hash)) {
            RateLimiter::clear($key);
            return;
        }
        RateLimiter::hit($key, 30);
        abort(401, 'Kata sandi salah');
    }

    private function newSession(User $u): string
    {
        $token = Str::random(43);
        Cache::put("notes-unlock:{$u->id}:" . hash('sha256', $token), true, self::TTL);
        // simpan daftar token per user kalau perlu endAll(); atau pakai cache tag / versi generasi
        return $token;
    }
}
```

> `endAll()` paling mudah dengan **nomor generasi**: simpan `notes-unlock-gen:{userId}` di cache, sertakan dalam key token; ganti kata sandi = naikkan generasi.

Header dari browser: `X-Notes-Unlock: <token>` (asli: `X-Lembar-Unlock`).

### 7.3 Penyamaran (redaksi)

Kalau sesi tidak valid, ringkasan catatan terkunci dikirim sebagai:

```php
fn (array $n) => $n['locked'] ? [...$n, 'snippet' => '', 'tags' => [], 'todo' => false, 'body' => null] : $n
```

Judul **tetap dikirim** (dibutuhkan untuk daftar dan pencocokan `[[wikilink]]`), tapi frontend **tidak menampilkannya**: ia menampilkan teks pengganti "Lorem ipsum…" sepanjang judul asli (6–60 karakter) dengan CSS blur, plus `<span class="sr-only">Catatan terkunci</span>`. Jadi judul asli tidak ada di DOM.

Tanpa sesi, server **tidak pernah** mengirim isi, tag, PDF, atau menerima perubahan isi/lepas kunci catatan terkunci. Event realtime (kalau ada) selalu mengirim versi tersamarkan.

### 7.4 Perilaku UI kunci
- Catatan terkunci yang belum dibuka → editor menampilkan layar kunci: ikon gembok, judul buram, teks "Catatan ini terkunci. Masukkan kata sandi untuk membuka semua catatan terkunci.", input kata sandi + tombol **Buka**, pesan error, petunjuk "⌘⌥L menutup lagi semua catatan terkunci".
- Kalau kata sandi belum dibuat: "…kata sandi belum dibuat. Buat kata sandi untuk membukanya." + tombol **Buat kata sandi**.
- Di daftar: judul buram, snippet "Catatan terkunci", tanpa tag; ikon gembok di samping judul.
- Saat sesi berakhir: simpan dulu catatan terkunci yang sedang diedit, lalu buang isinya dari memori JS, muat ulang daftar.
- Server membalas 423 padahal klien punya token → token dianggap hilang, toast "Sesi catatan terkunci berakhir. Masukkan kata sandi lagi."

---

## 8. Autosave & konflik

Semua di frontend (`app.js`), tinggal dipertahankan.

- Setiap ketikan: ubah state lokal (judul/snippet/tag/todo dihitung ulang dengan `text.js` → daftar & sidebar langsung berubah), jadwalkan simpan **500 ms** (debounce).
- Satu "slot" simpan per catatan: `{timer, inflight, dirty, again, error, conflict, saved, retryDelay}`. Hanya satu request per catatan berjalan; ketikan selama request berjalan memicu simpan lagi setelahnya.
- Request: `PUT /api/notes/{id}` dengan `{body, version}` (asli: `baseUpdated`). Sukses → simpan `version` baru dari respons.
- Gagal jaringan/5xx → coba lagi dengan backoff 3 s, 6 s, 12 s, maks 15 s. Banner "Server tidak merespons. Perubahan akan disimpan begitu tersambung lagi."
- 409 + `note` → mode konflik: banner merah "Catatan ini diubah di luar Lembar (waktu) sementara Anda menulis." dengan tombol **Muat versi terbaru** (buang ketikan lokal) dan **Timpa dengan versi saya** (pakai `version` server lalu simpan ulang).
- 404 → catatan dilupakan, toast "Catatan sudah tidak ada di server".
- 423 → status "Gagal menyimpan: catatan terkunci, buka kunci untuk menyimpan"; tersimpan otomatis setelah dibuka.
- Status di bar bawah: `Menyimpan…` / `Tersimpan` (hijau) / `Gagal menyimpan…` / `Konflik…` (merah).
- `⌘S` = simpan sekarang. `beforeunload`: kalau ada yang belum tersimpan, kirim dengan `fetch(..., {keepalive: true})` dan tampilkan dialog konfirmasi browser.
- Request timeout 10 detik (`AbortSignal.timeout(10_000)`).
- Pindah catatan / tinggalkan catatan → simpan segera (`flush`).

**Catatan baru kosong otomatis dibuang**: catatan yang dibuat lewat tombol Baru (tanpa judul) ditandai "fresh". Kalau ditinggalkan tanpa diisi (isi sama dengan awal, atau hanya `#` kosong) → `DELETE /api/notes/{id}` lalu `DELETE /api/trash/{id}`.

**Mencentang todo di mode Baca**: klik checkbox → ambil `data-line`, pastikan baris itu memang item todo (`/^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d+[.)])[ \t]+)\[([ xX])\]/`), tukar `[ ]` ↔ `[x]`, simpan lewat autosave. Kalau barisnya tidak cocok (sumber berubah) → render ulang saja.

---

## 9. Sampah

- Hapus dari editor = pindah ke Sampah (simpan dulu perubahan yang tertunda; kalau gagal, batal dengan pesan).
- Filter "Sampah" menampilkan catatan yang dihapus. Editor catatan Sampah: teks "Catatan ini ada di Sampah." + **Pulihkan** + **Hapus permanen** (dengan `confirm()`: "Hapus catatan ini secara permanen? Tindakan ini tidak bisa dibatalkan.").
- Catatan di Sampah tidak bisa diubah, tidak bisa diekspor PDF, tidak dihitung di tag.
- Tombol **Baru** disembunyikan di filter Sampah.

---

## 10. Ekspor Markdown & PDF

### 10.1 Markdown
Murni di browser: unduh `body` apa adanya (termasuk ketikan yang belum tersimpan) sebagai `text/markdown;charset=utf-8`, nama file `safeFilename(title, 'md')`. Toast "Markdown diunduh: …".

### 10.2 PDF

**Server** (Laravel, disarankan `spatie/laravel-pdf` + Browsershot, butuh Node & Chrome/Chromium di server):

```php
public function pdf(Request $r, Note $note, NoteLockService $lock)
{
    $this->authorize('view', $note);
    if ($note->is_locked && !$lock->check($r->user(), $r->header('X-Notes-Unlock'))) abort(423, 'Catatan terkunci');
    if ($note->trashed()) abort(409, 'Catatan di Sampah tidak bisa diekspor. Pulihkan dulu.');

    return Pdf::view('notes.print', ['note' => $note])
        ->format('a4')
        ->margins(18, 18, 20, 18, Unit::Millimeter)   // atas, kanan, bawah, kiri
        ->footerView('notes.print-footer')
        ->name(NoteText::safeFilename($note->title, 'pdf'));
}
```

Spesifikasi hasil PDF (dari `lib/pdf.js` + `lib/print.css`):
- A4, margin atas 18 mm, bawah 20 mm, kiri/kanan 18 mm. Selalu tema terang. `printBackground: true`.
- Font sama dengan aplikasi, disisipkan (Literata untuk isi 10.5pt/1.65, Figtree untuk meta/tag, JetBrains Mono 8.5pt untuk kode).
- Footer: judul (kiri, terpotong ellipsis) dan "Halaman X dari Y" (kanan), 7.5pt abu-abu `#8A948F`. Tanpa header.
- Baris meta tepat **di bawah H1 pertama** (atau paling atas kalau tidak diawali H1): `Dibuat 7 Oktober 2026 pukul 09.14 WIB · Diubah … · #tag #tag2`.
- Tag & wikilink dirender sebagai `<span>` (bukan tautan).
- `pre`, `blockquote`, `table`, `img`, `li` tidak terbelah antar halaman (`break-inside: avoid`). Elemen yang lebih tinggi dari ~95% tinggi area isi diberi kelas `.long` (boleh terbelah), dan baris kode tidak pernah terpotong di tengah. Jalankan skrip pengukur ini di halaman sebelum cetak (Browsershot bisa `->evaluate()`/script di view):
  ```js
  for (const el of document.querySelectorAll('.prose pre, .prose blockquote, .prose table, .prose li'))
    if (el.getBoundingClientRect().height > PAGE_H * 0.95) el.classList.add('long');
  ```
  dengan viewport = lebar isi A4 (≈ 657 px) dan `PAGE_H` ≈ 979 px (96 dpi), media `print`.
- Keamanan halaman cetak: CSP `default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data: http: https:`; blokir semua request kecuali `data:` dan gambar http(s); tunggu gambar maks 10 detik, lalu `document.fonts.ready`.
- Header respons: `Content-Disposition: inline; filename="ascii"; filename*=UTF-8''<urlencoded>`; `Cache-Control: no-store`.
- Satu ekspor berjalan pada satu waktu (di Laravel cukup andalkan queue/worker, atau biarkan sinkron).

Isi HTML cetak: render Markdown dengan renderer yang **sama** dengan frontend dan opsi `internalLinks: false`. Dua cara:
1. Blade `notes/print.blade.php` memuat bundle JS kecil (`resources/js/notes/print.js`) yang merender `@json($note->body)` ke `<article class="prose">`; Browsershot menunggu selesai. *(Disarankan: satu renderer.)*
2. Render di PHP dengan league/commonmark + extension custom untuk task list, `#tag`, `[[wikilink]]`, `==mark==`, pembungkus `.line` di kode, dan highlight (mis. `tempest/highlight`). Lebih banyak kerja dan berisiko beda tampilan.

`lib/print.css` bisa disalin langsung ke `resources/css/notes-print.css`.

**Frontend** (pengalaman unduh, dari `exportPdf()`):
- Tidak meninggalkan halaman; panel kecil kanan bawah dengan judul "PDF: <judul>" dan tombol **Batal** (`AbortController`).
- Tahap: "Menyimpan perubahan…" (flush autosave dulu) → "Membuat PDF…" (bar tak-tentu; setelah 1,5 s tambah petunjuk ekspor pertama lebih lama) → "Mengunduh…" (persentase dari `Content-Length`) → "PDF siap · <file> diunduh" (hilang setelah 4 s). Gagal → "Gagal membuat PDF" + pesan. Dibatalkan → "Ekspor PDF dibatalkan".
- Hanya satu PDF sekaligus ("PDF lain sedang dibuat"). Tombol PDF `disabled` + `aria-busy` selama berjalan.
- Nama file diambil dari `filename*` di `Content-Disposition`.

---

## 11. Perubahan dari luar / tab lain

Asli: server memantau folder catatan (fs.watch + rescan tiap 30 s) dan mengirim SSE `event: change` `data: {id, note}` (`note: null` = dihapus). Klien:
- `note: null` → lupakan catatan; kalau sedang dipilih, pilih catatan pertama yang terlihat, toast "Catatan dihapus di luar Lembar".
- Ada `note` → perbarui ringkasan. Kalau isi lokal tidak sedang diedit dan versinya beda → muat ulang isi. Kalau sedang diedit → biarkan autosave yang menemukan konflik (409).
- Setelah koneksi SSE pulih → `reloadAll()` + `flushAll()`.

Di Laravel (DB, multi-perangkat):
- **Minimum**: tidak perlu apa-apa; konflik tetap tertangkap oleh `version`. Tambahkan muat ulang daftar saat tab kembali fokus (`visibilitychange`).
- **Lebih baik**: broadcast event `NoteChanged` di private channel `notes.{userId}` (Laravel Reverb + Echo) dengan payload ringkasan **tersamarkan**, dan pakai handler klien yang sama (`onExternalChange`).

---

## 12. Frontend: tata letak & perilaku UI

### 12.1 Tata letak

Grid tiga kolom, tidak ada scroll halaman; yang bergulir hanya isi sidebar, daftar, dan badan editor.

| Lebar layar | Kolom |
|---|---|
| > 1080 px | sidebar 232 px · daftar 320 px · editor sisanya |
| 801–1080 px | 200 · 280 · sisanya |
| ≤ 800 px | Satu panel saja (`data-pane="side|list|editor"`), tombol menu/kembali muncul |
| Sidebar diciutkan (`⌘B`) | 60 px kolom ikon (judul hanya lewat tooltip & aria-label) |
| Mode Belah | butuh ≥ 900 px (di bawahnya tombol Belah disembunyikan) |

### 12.2 Sidebar
- Brand: ikon + "Lembar" (ganti dengan nama modul di studio).
- Filter tetap, dengan hitungan:

  | Kunci | Label | Ikon | Kriteria |
  |---|---|---|---|
  | `all` | Semua catatan | notes | tidak di Sampah |
  | `todo` | Todo | todo | tidak di Sampah & `todo` |
  | `today` | Hari ini | today | tidak di Sampah & `updated` hari ini (WIB) |
  | `locked` | Terkunci | lock | tidak di Sampah & `locked` |
  | `trash` | Sampah | trash | di Sampah |

- Bagian **Tag** (bisa disembunyikan, tombol "Buka/Tutup semua tag"): pohon dari semua tag catatan non-Sampah. Tiap tag bertingkat (`a/b/c`) menghasilkan simpul `a`, `a/b`, `a/b/c`. Hitungan simpul = jumlah catatan yang punya tag itu atau turunannya. Simpul yang punya anak bisa dilipat. Kosong: "Ketik #tag di catatan untuk membuat tag."
- Preferensi tampilan disimpan di `localStorage`: `lembar:tags` (`{collapsed:[...], hidden:bool}`), `lembar:sideMini`, `lembar:theme`, `lembar:codeLang`.
- Kaki sidebar: tombol kunci (atur kata sandi), ciutkan sidebar, ganti tema terang/gelap.

### 12.3 Daftar catatan
- Kepala: judul filter (atau `#tag`), tombol **Baru** (kecuali Sampah), kotak cari "Cari catatan".
- Item: judul (+ ikon pin / gembok), snippet (atau "Belum ada isi"), tanggal pendek + maks 2 tag.
- Tanggal pendek (WIB): "Hari ini, 09.14" · "Kemarin, 21.03" · selain itu "7 Okt".
- Urutan: tersemat dulu, lalu `updated` terbaru.
- Pencarian: saat mengetik, langsung cocokkan judul + snippet lokal; 120 ms kemudian minta server (`?q=`) dan pakai hasilnya (cari di seluruh isi). Hasil basi (request lama) diabaikan.
- Kosong: "Memuat catatan…" / `Tidak ada catatan yang cocok dengan "q".` / "Sampah kosong." / "Belum ada catatan di sini. Tekan Baru untuk mulai menulis."

### 12.4 Editor
- Bar atas: tombol kembali (mobile), segmen mode **Tulis / Belah / Baca**, toolbar format (hanya di Tulis/Belah), lalu di kanan: Pin, Kunci, Tampilan penuh (hanya mode Baca), unduh MD, unduh PDF, Sampah.
- **Tulis**: `<textarea>` yang tumbuh setinggi isinya (tanpa scrollbar sendiri; diukur lewat textarea bayangan tersembunyi) sehingga seluruh catatan bergulir sebagai satu halaman. Placeholder "# Judul catatan\n\nMulai menulis…". Kursor dijaga tetap terlihat (margin 48 px) saat mengetik.
- **Belah**: editor kiri, pratinjau kanan (render ulang 120 ms setelah berhenti mengetik), gulir pratinjau mengikuti rasio gulir editor.
- **Baca**: HTML hasil render dalam `<article class="prose">`; blok kode punya tombol **Salin** ("Tersalin" 1,5 s). Klik `#tag` → filter tag; klik `[[Judul]]` → buka catatan dengan judul itu (case-insensitive, tidak di Sampah) di mode Baca, atau buat catatan baru berjudul itu (toast "Catatan baru dibuat: …").
- **Tampilan penuh** (mode Baca saja): sembunyikan sidebar & daftar dalam jendela. `F` / tombol / `Esc` untuk keluar. Otomatis keluar kalau pindah ke Tulis.
- Kaki editor: `N kata` · `N karakter` · `N menit baca` (kata/200, min 1) · `Diubah Selasa, 7 Oktober 2026 pukul 09.14 WIB` · status simpan. Kata = jumlah kecocokan `/[\p{L}\p{N}]+/gu`.
- Saat render ulang catatan yang sama: pertahankan seleksi, fokus, dan posisi gulir (termasuk kedua pane Belah).
- Tidak ada catatan dipilih: ikon + "Pilih catatan di daftar, atau buat yang baru." + tombol **Buat catatan**.

### 12.5 Membuat catatan baru
- Isi awal: `# \n\n`, atau `# \n\n#tag\n\n` kalau sedang di filter tag (tag otomatis ditambahkan).
- Kursor di posisi judul. Mode jadi Tulis (atau tetap Belah kalau sedang Belah).
- Kalau sedang di filter Sampah/Terkunci/Todo → pindah ke "Semua catatan". Kueri cari dikosongkan.
- Klik catatan kosong di daftar → buka di mode Tulis.

### 12.6 Pin & kunci (optimistic)
Ubah state lokal dulu, kirim `PUT {pinned}` / `PUT {locked}`, kembalikan kalau gagal ("Gagal: …"). Toast: "Catatan disematkan" / "Sematan dilepas" / "Catatan dikunci" / "Kunci dihapus".

### 12.7 Lain-lain
- Toast di tengah bawah, hilang setelah 1,8 s.
- Tema: ikut sistem; tombol tema memaksa `data-theme="light|dark"` di `<html>` (disimpan; diterapkan sebelum render agar tidak berkedip).
- PWA: manifest `standalone`, ikon SVG + PNG 192/512 + maskable. Opsional di studio.
- Semua waktu ditampilkan dalam `Asia/Jakarta` dengan format `id-ID`.
- Catatan pertama user (belum punya catatan sama sekali, termasuk di Sampah) → buat catatan sambutan yang tersemat (teks di lampiran 19).

---

## 13. Editor: toolbar & ketik pintar

Sumber: `public/editor.js` (bebas dependensi, tinggal disalin). Semua perubahan teks lewat `document.execCommand('insertText')` supaya **⌘Z bisa membatalkan aksi toolbar**; fallback `setRangeText` + event `input`.

### 13.1 Toolbar

| Kontrol | Aksi | Detail |
|---|---|---|
| Select gaya | Teks normal / Judul 1–3 | Ganti awalan `#` di baris terseleksi. Nonaktif di dalam blok kode. Mengikuti baris kursor. |
| **B** | `**teks tebal**` | Toggle: kalau seleksi sudah dibungkus penanda yang sama, lepas. |
| *I* | `*teks miring*` | Penanda satu karakter tidak boleh bagian dari `**`. |
| Coret | `~~teks dicoret~~` | |
| Sorot | `==teks disorot==` | |
| Kode inline | `` `kode` `` | |
| Daftar | `- ` | Toggle per baris; baris kosong dilewati kalau multi-baris |
| Daftar bernomor | `1. 2. 3.` | Penomoran ulang |
| Todo | `- [ ] ` | |
| Kutipan | `> ` | |
| Tautan | `[teks tautan](https://)` | Kalau seleksi URL: `[teks](url)` dengan "teks" terseleksi |
| Wikilink | `[[Judul catatan]]` | |
| Tabel | `\| Kolom 1 \| Kolom 2 \|\n\| --- \| --- \|\n\| isi \| isi \|` | Disisipkan sebagai blok |
| Garis | `---` | Blok |
| Blok kode | ```` ```lang\n\n``` ```` | Pakai bahasa terakhir (`localStorage lembar:codeLang`); seleksi dibungkus |
| Select bahasa | ganti/sisipkan blok kode | Di dalam blok: ganti info bahasa blok itu. Bahasa di luar daftar ditampilkan sebagai opsi tambahan. |

- "Sisipkan sebagai blok" = di barisnya sendiri, dipisah satu baris kosong dari teks sekitar.
- Di dalam blok kode, hanya aksi blok kode (dan kode inline—diabaikan) yang berlaku; format lain diabaikan supaya kode tidak rusak.
- Klik tombol toolbar tidak mengambil fokus (`mousedown` → `preventDefault`).

### 13.2 Ketik pintar

| Tombol | Perilaku |
|---|---|
| Enter di item daftar/todo | Lanjutkan daftar (nomor +1, todo baru `[ ]`, awalan kutipan dipertahankan) |
| Enter di item kosong | Keluar dari daftar (awalan kutipan tetap) |
| Enter di baris kutipan | Lanjut `> `; di kutipan kosong → keluar |
| Enter tepat setelah ```` ```bahasa ```` (blok belum tertutup) | Tutup blok otomatis, kursor di dalam |
| Enter di dalam blok kode | Pertahankan indentasi baris |
| Tab | Di item daftar / multi-baris: indentasi 2 spasi; selain itu sisipkan 2 spasi |
| Shift+Tab | Kurangi indentasi (2 spasi atau 1 tab) |
| Esc | Keluar dari textarea (blur) |
| IME composing | Abaikan semua |

---

## 14. Pintasan keyboard

⌘ = Ctrl dan ⌥ = Alt di Windows/Linux.

| Tombol | Aksi | Konteks |
|---|---|---|
| `N` | Catatan baru | Bukan di input |
| `/` | Fokus pencarian | Bukan di input |
| `F` | Tampilan penuh (mode Baca) | Bukan di input |
| `Esc` | Keluar tampilan penuh / keluar editor | |
| `⌘E` | Tulis ↔ Baca | |
| `⌘S` | Simpan sekarang | |
| `⌘B` | Sidebar ciut/lebar | Di luar editor |
| `⌘⇧L` | Kunci catatan ini; di catatan terkunci yang terbuka: tutup sesi; di catatan terkunci tertutup: fokus input sandi | |
| `⌘⌥L` | Tutup semua catatan terkunci | |
| `⌘B` / `⌘I` | Tebal / miring | Di editor |
| `⌘⇧X` / `⌘⇧H` / `⌘⇧M` | Coret / sorot / kode inline | Di editor |
| `⌘K` | Tautan | Di editor |
| `⌘⌥1`–`3`, `⌘⌥0` | Judul 1–3, teks normal | Di editor |
| `⌘⇧8` / `⌘⇧7` / `⌘⇧9` / `⌘⇧.` | Daftar / bernomor / todo / kutipan | Di editor |
| `⌘⌥C` | Blok kode (bahasa terakhir) | Di editor |

Cocokkan pakai `e.code` (`KeyX`, `Digit8`, `Period`) untuk kombinasi Shift/Alt, karena `e.key` berubah oleh modifier.

---

## 15. Desain visual (token)

Font (Google Fonts, OFL, variable, disimpan lokal): **Figtree** (UI), **Literata** (bacaan & PDF, + italic), **JetBrains Mono** (kode). Teks UI 15px/1.45.

```css
:root{
  --bg:#F6F7F5; --side:#E9EDE8; --list:#F9FAF8; --paper:#FFFFFF;
  --ink:#1E2A2C; --ink-2:#56625F; --ink-3:#8A948F; --line:#DCE1DB;
  --accent:#2F6F55; --accent-ink:#FFFFFF; --accent-soft:#D9EAE0;
  --mark:#F4E7A6; --danger:#A23B3B; --code:#EEF1ED;
  --ui:"Figtree", system-ui, sans-serif;
  --read:"Literata", Georgia, serif;
  --mono:"JetBrains Mono", ui-monospace, Menlo, monospace;
}
/* Gelap (prefers-color-scheme: dark tanpa data-theme="light", atau data-theme="dark") */
:root[data-theme="dark"]{
  --bg:#131A1B; --side:#172022; --list:#1A2325; --paper:#1E2729;
  --ink:#E3E9E5; --ink-2:#A6B1AC; --ink-3:#6E7A75; --line:#2B3537;
  --accent:#7CC3A0; --accent-ink:#10201A; --accent-soft:#233A30;
  --mark:#5B4F1F; --danger:#E08585; --code:#263133;
}
```

Warna sintaks terang: keyword `#9B2F86`, string `#2E7D32`, angka `#B45309`, komentar `#8A948F` italic, fungsi/tag `#1D5FB4`, atribut `#8A5A00`, meta `#6A5ACD`, tipe `#00727F`, variabel `#B4232C`. (Versi gelap ada di `public/style.css` blok `--syn-*`.)

Ikon: SVG garis 24×24, stroke 1.7, `currentColor`, ukuran 18 px. Semua ikon ada inline di objek `I` di awal `public/app.js` — bisa disalin.

Kalau fajriansyah-studio sudah punya design system (mis. Tailwind), petakan token di atas ke tema Tailwind; struktur `style.css` asli (≈300 baris) bisa disalin sebagai `resources/css/notes.css` dan dibatasi ke wadah `.notes-app`.

---

## 16. Struktur file Laravel yang disarankan

```
app/
  Http/Controllers/Notes/
    NoteController.php          # index, show, store, update, destroy, restore
    NoteTrashController.php     # purge
    NotePdfController.php       # pdf
    NoteLockController.php      # status, unlock, password, endSession
  Http/Requests/Notes/
    StoreNoteRequest.php        # body string|nullable max:5MB, pinned bool, locked bool
    UpdateNoteRequest.php       # + version integer
  Http/Resources/NoteResource.php   # bentuk ringkasan (bagian 3.2) + redaksi (7.3)
  Models/Note.php, NoteTag.php
  Policies/NotePolicy.php       # user_id === auth()->id()
  Services/Notes/
    NoteService.php             # create/update/trash/restore/purge, hitung turunan, sync tag, konflik
    NoteLockService.php
  Support/Notes/NoteText.php    # bagian 4
  Events/NoteChanged.php        # opsional (broadcast)
database/migrations/…           # bagian 3.1
resources/
  views/notes/app.blade.php     # shell: <div class="app" id="app" data-pane="list"> + 3 kolom + toast + task
  views/notes/print.blade.php   # halaman cetak PDF
  views/notes/print-footer.blade.php
  js/notes/app.js               # port public/app.js
  js/notes/editor.js            # port public/editor.js
  js/notes/text.js              # salin lib/text.js
  js/notes/render.js            # salin lib/render.js
  js/notes/highlight.js         # salin lib/highlight.js
  js/notes/print.js             # opsional: render untuk PDF
  css/notes.css                 # dari public/style.css
  css/notes-print.css           # dari lib/print.css
  fonts/…                       # 4 file woff2 dari public/fonts
routes/web.php                  # grup auth + prefix
tests/Feature/Notes/…
```

Routes:

```php
Route::middleware(['auth'])->prefix('studio/notes')->name('notes.')->group(function () {
    Route::view('/', 'notes.app')->name('app');

    Route::prefix('api')->group(function () {
        Route::get('notes', [NoteController::class, 'index']);
        Route::post('notes', [NoteController::class, 'store']);
        Route::get('notes/{note}', [NoteController::class, 'show'])->withTrashed();
        Route::put('notes/{note}', [NoteController::class, 'update'])->withTrashed();
        Route::delete('notes/{note}', [NoteController::class, 'destroy'])->withTrashed();
        Route::post('notes/{note}/restore', [NoteController::class, 'restore'])->withTrashed();
        Route::get('notes/{note}/pdf', NotePdfController::class)->withTrashed();
        Route::delete('trash/{note}', NoteTrashController::class)->withTrashed();

        Route::get('lock', [NoteLockController::class, 'status']);
        Route::post('lock/unlock', [NoteLockController::class, 'unlock']);
        Route::post('lock/password', [NoteLockController::class, 'password']);
        Route::delete('lock/session', [NoteLockController::class, 'end']);
    });
});
```

> Pakai `->withTrashed()` di route supaya catatan Sampah ter-bind, lalu periksa `trashed()` di service untuk memberi 409 yang tepat (bukan 404).

Penyesuaian di `app.js` saat port:
1. Ganti semua `/api/...` ke prefix studio (buat satu konstanta `BASE`).
2. Tambahkan header `X-CSRF-TOKEN` (dari `<meta name="csrf-token">`) dan `Accept: application/json` di fungsi `api()` dan fetch PDF/hapus sesi.
3. Ganti header `X-Lembar-Unlock` → `X-Notes-Unlock`.
4. Ganti `baseUpdated` → `version` (map `base` menyimpan `note.version`; cek di `reloadAll`/`onExternalChange` pakai `version`).
5. Ganti `connectEvents()` (SSE) dengan Echo atau hapus (lihat 11).
6. Import modul lewat Vite (`import MarkdownIt from 'markdown-it'`), hapus import map.
7. Error Laravel: pastikan handler mengembalikan `{"error": "..."}` untuk rute API catatan (bukan `{"message": ...}`), atau ubah `api()` agar membaca `data.message ?? data.error`. Untuk 409/423, sertakan `note` di JSON.

Contoh render error yang kompatibel:

```php
// bootstrap/app.php → withExceptions
$exceptions->render(function (HttpException $e, Request $r) {
    if ($r->is('studio/notes/api/*')) {
        return response()->json(['error' => $e->getMessage()], $e->getStatusCode());
    }
});
```

Untuk konflik yang membawa catatan, buat exception sendiri, mis. `NoteConflictException($note)` → `['error' => ..., 'note' => NoteResource]`.

---

## 17. Urutan pengerjaan

1. **Data & aturan teks**: migrasi, model, `NoteText` + unit test (port kasus di bagian 18).
2. **API CRUD + Sampah**: controller, request, resource, policy, `NoteService` (turunan, tag, `version`, konflik). Feature test.
3. **Shell UI**: Blade + port `app.js`/`editor.js`/`render.js`/`text.js`/`highlight.js` + CSS + font. Sidebar, daftar, editor Tulis/Baca, autosave.
4. **Fitur editor**: toolbar, ketik pintar, mode Belah, todo dicentang, wikilink, tag tree, pencarian server.
5. **Catatan terkunci**: `NoteLockService`, redaksi, dialog kata sandi, layar kunci, idle 5 menit, rate limit.
6. **Ekspor**: Markdown (frontend), PDF (Browsershot + Blade cetak + CSS cetak + panel progres).
7. **Sentuhan akhir**: catatan sambutan, tema gelap, sidebar ciut, tampilan penuh, responsive mobile, (opsional) broadcast realtime, PWA.

---

## 18. Daftar uji (acceptance checklist)

**Aturan teks**
- [ ] `title("\n\n## Halo  \nisi")` = `Halo`; isi kosong → `Tanpa judul`; `"#   "` → `Tanpa judul`.
- [ ] `tags("# Judul\n#kerja dan #Produk/Roadmap url#anchor")` = `["kerja", "produk/roadmap"]`.
- [ ] Tag di dalam ```` ``` ```` dan `` `#bukan` `` diabaikan; fence `~~~` dan fence lebih panjang (```` ```` ````) ditangani.
- [ ] `hasOpenTodo`: `- [ ] a` ya; `- [x] a` tidak; `1. [ ] a` ya; `> - [ ] a` ya; di blok kode tidak.
- [ ] `snippet` maks 140 karakter, tanpa baris judul, tanpa `# * \` = ~ > [ ]` dan `- [ ]`.
- [ ] `safeFilename("Rapat: 5/10", "pdf")` = `Rapat- 5-10.pdf`; judul kosong → `catatan.pdf`.

**API**
- [ ] Daftar urut tersemat → terbaru; menyertakan catatan Sampah dengan `trashed: true`.
- [ ] Ubah pin/kunci tidak mengubah `updated` maupun `version`.
- [ ] PUT dengan `version` usang + `body` → 409 + `note` lengkap; tanpa `body` (hanya pin) → tidak konflik.
- [ ] PUT/PDF pada catatan Sampah → 409. Hapus permanen catatan yang tidak di Sampah → 409.
- [ ] Catatan user lain → 404 untuk semua endpoint.
- [ ] Pencarian: isi catatan biasa ditemukan; isi catatan terkunci **tidak**, judulnya ya.

**Kunci**
- [ ] Mengunci tanpa kata sandi → 409; frontend membuka dialog "Buat kata sandi" lalu melanjutkan mengunci.
- [ ] Tanpa token: daftar menyamarkan snippet/tag/todo; GET isi/PDF/PUT/hapus permanen → 423.
- [ ] Salah 5× → 429 selama 30 detik; benar → reset hitungan.
- [ ] Ganti kata sandi → token lama tidak berlaku.
- [ ] Reload tab → terkunci lagi; 5 menit diam → tertutup otomatis dengan toast.
- [ ] Judul asli catatan terkunci tidak ada di DOM saat terkunci.

**Editor & UI**
- [ ] Ketik → "Menyimpan…" → "Tersimpan"; matikan jaringan → banner offline, tersimpan otomatis setelah pulih.
- [ ] Ubah catatan di tab lain lalu ketik di tab ini → banner konflik dengan dua pilihan.
- [ ] Catatan baru yang ditinggal kosong tidak tersisa (termasuk di Sampah).
- [ ] Centang todo di mode Baca mengubah sumber dan tersimpan.
- [ ] `[[Judul]]` membuka catatan yang ada atau membuat yang baru.
- [ ] Semua aksi toolbar bisa di-undo dengan ⌘Z.
- [ ] Enter melanjutkan daftar bernomor (3 → 4) dan keluar di item kosong; ```` ```php ```` + Enter menutup blok.
- [ ] HTML mentah (`<script>`) tampil sebagai teks; `[x](javascript:alert(1))` tidak jadi tautan.
- [ ] Mobile ≤ 800 px: satu panel, tombol menu & kembali berfungsi.

**PDF**
- [ ] A4, footer "Halaman X dari Y", baris meta di bawah H1 dengan tanggal WIB & tag.
- [ ] Blok kode pendek tidak terbelah; blok kode lebih dari satu halaman terpotong di antara baris.
- [ ] Nama file dengan karakter non-ASCII benar (`filename*`).

---

## 19. Lampiran: teks sambutan & string UI

### 19.1 Catatan sambutan (dibuat tersemat untuk user baru)

```markdown
# Selamat datang di Lembar

Lembar adalah tempat menulis yang tenang. Semua catatan ditulis dengan **Markdown**, jadi format cukup diketik, tanpa menu yang ribet.

## Yang bisa dicoba
- [x] Buka catatan ini
- [ ] Klik kotak centang ini, catatannya ikut berubah
- [ ] Tekan Ctrl+E untuk pindah antara mode Tulis dan Baca
- [ ] Klik tautan [[Ide fitur]]; kalau catatannya belum ada, Lembar membuatnya

## Organisasi pakai tag
Tag cukup diketik di mana saja, misalnya #panduan. Pakai garis miring untuk tag bertingkat seperti #produk/roadmap, nanti otomatis muncul di sidebar.

> Tulis dulu, rapikan belakangan.

Teks bisa ==ditandai==, dibuat *miring*, ~~dicoret~~, atau berisi `kode`.

## Di mana catatan disimpan?
Setiap catatan adalah satu file `.md` biasa di folder catatan, jadi bisa dibuka dengan editor lain dan dicadangkan dengan git.
```

> Sesuaikan paragraf terakhir untuk versi studio (catatan disimpan di database; bisa diekspor ke `.md`/PDF).

### 19.2 String UI penting

| Tempat | Teks |
|---|---|
| Toast | Catatan disematkan · Sematan dilepas · Catatan dikunci · Kunci dihapus · Dipindahkan ke Sampah · Catatan dipulihkan · Catatan dihapus permanen · Versi terbaru dimuat · Kata sandi dibuat · Kata sandi diganti · Catatan terkunci dibuka · Semua catatan terkunci ditutup · Tidak ada catatan terkunci yang terbuka · Catatan terkunci ditutup otomatis (5 menit tidak aktif) · PDF lain sedang dibuat · Catatan belum dimuat · Gagal: … |
| Dialog sandi (buat) | Judul "Buat kata sandi" · "Kata sandi ini dipakai untuk membuka semua catatan terkunci. Minimal 4 karakter." · field "Kata sandi baru", "Ulangi kata sandi baru" · "Kata sandi baru tidak sama." |
| Dialog sandi (ganti) | Judul "Ganti kata sandi" · "Satu kata sandi untuk semua catatan terkunci." · tambahan field "Kata sandi sekarang" |
| Catatan kaki dialog | "Isi file .md di disk tidak dienkripsi; kunci ini menahan akses lewat Lembar." (ubah: "…tidak dienkripsi di database…") |
| Unlock gagal | "Kata sandi salah. Coba lagi." |
| Status simpan | Menyimpan… · Tersimpan · Gagal menyimpan, server tidak merespons · Gagal menyimpan: … · Konflik: catatan diubah di luar Lembar |

---

*Sumber: kode Lembar v0.1.0 (`server.js`, `lib/*.js`, `public/*.js`, `public/style.css`, `lib/print.css`). Untuk detail implementasi yang tidak tercakup di sini, file asli bisa dibaca langsung — sebagian besar logika frontend bisa disalin apa adanya.*
