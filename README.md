# Lembar

Aplikasi catatan Markdown pribadi yang berjalan lokal. Setiap catatan adalah satu file `.md`.

## Menjalankan

Butuh Node.js 22 atau lebih baru (disarankan 24, lihat `.nvmrc`).

```bash
nvm use            # pakai Node 24
npm install
npm start          # atau: npm run dev (restart otomatis saat kode berubah)
```

Lalu buka <http://127.0.0.1:3210>. Server hanya mendengarkan di `127.0.0.1`, jadi tidak bisa diakses dari perangkat lain.

| Variabel    | Default                                  |
|-------------|------------------------------------------|
| `NOTES_DIR` | `~/Documents/06-Archive/Lembar/notes`    |
| `PORT`      | `3210`                                   |
| `CHROME_PATH` | `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` |

Tes: `npm test`.

### Jalan otomatis di latar belakang (macOS)

```bash
npm run service:install     # pasang; server menyala saat login & dinyalakan ulang kalau crash
npm run service:status      # cek status
npm run service:uninstall   # cabut
```

- Setelah kode Lembar berubah atau Node di-upgrade, jalankan `npm run service:install` lagi (sekaligus me-restart).
- Selama layanan aktif, jangan jalankan `npm start`/`npm run dev` di port yang sama (3210); untuk mencoba-coba pakai `PORT=3299 npm run dev`.
- Log: `~/Library/Logs/Lembar/`. Variabel `NOTES_DIR`, `PORT`, `CHROME_PATH` yang di-set saat install ikut tersimpan.
- Kalau server sempat mati mendadak, Chrome sisa ekspor PDF dibereskan otomatis saat server menyala lagi.

**Pasang sebagai aplikasi:** buka Lembar di Chrome → menu ⋮ → *Cast, save, and share* → *Install page as app…*. Lembar lalu terbuka di jendela sendiri dengan ikonnya, dan bisa disematkan di Dock. Ikon dibuat dari `public/icons/*.svg`; setelah mengubah SVG, jalankan `npm run icons`.

## Editor

Mode **Tulis**, **Belah** (teks + pratinjau berdampingan, layar ≥ 900 px), dan **Baca**. Toolbar menyediakan gaya judul, format teks, daftar, kutipan, tautan, tabel, dan **blok kode dengan pemilih bahasa**: PHP, JavaScript, TypeScript, HTML, CSS, JSON, SQL, Bash, YAML, Nginx, Python, Java, Go, Kotlin, Markdown, Diff, Dockerfile, INI. Saat kursor di dalam blok kode, pemilih menunjukkan bahasa blok itu dan bisa mengubahnya. Di mode Baca dan PDF kode diberi warna sintaks; di mode Baca ada tombol **Salin**.

Ketik pintar: Enter melanjutkan daftar/todo (Enter di item kosong keluar dari daftar), mengetik ```bahasa lalu Enter langsung menutup bloknya, Tab/Shift+Tab mengatur indentasi, Esc keluar dari editor. Semua aksi toolbar bisa dibatalkan dengan ⌘Z.

## Pintasan keyboard

| Tombol | Aksi |
|---|---|
| `N` | Catatan baru |
| `/` | Fokus ke pencarian |
| `⌘E` | Pindah Tulis ↔ Baca |
| `⌘B` (di luar editor) | Ciutkan / lebarkan sidebar jadi kolom ikon |
| `F` / `Esc` | Tampilan penuh di mode Baca / keluar |
| `⌘⇧L` | Kunci catatan ini; di catatan terkunci yang terbuka: tutup lagi |
| `⌘⌥L` | Tutup semua catatan terkunci yang sedang terbuka |
| `⌘S` | Simpan sekarang (biasanya tidak perlu, ada autosave) |
| `⌘B` / `⌘I` | Tebal / miring |
| `⌘⇧X` / `⌘⇧H` / `⌘⇧M` | Coret / sorot / kode inline |
| `⌘K` | Tautan |
| `⌘⌥1`–`3`, `⌘⌥0` | Judul 1–3, teks normal |
| `⌘⇧8` / `⌘⇧7` / `⌘⇧9` / `⌘⇧.` | Daftar / bernomor / todo / kutipan |
| `⌘⌥C` | Blok kode (bahasa terakhir dipakai) |

Di Windows/Linux, ⌘ = Ctrl dan ⌥ = Alt.

## Lokasi dan format data

- Catatan ada di `NOTES_DIR`, satu file per catatan, bernama dari waktu pembuatan (WIB), misalnya `20261007-091400.md`.
- Judul diambil dari baris pertama isi. Metadata (`created`, `pinned`, `locked`) ada di frontmatter YAML; waktu "diubah" diambil dari waktu modifikasi file.
- Catatan yang dihapus dipindah ke `NOTES_DIR/.trash/` dan bisa dipulihkan. Hapus permanen hanya bisa dari Sampah.
- File boleh diedit dengan editor lain selama Lembar berjalan; perubahan terdeteksi otomatis.
- **Catatan terkunci:** satu kata sandi untuk semua catatan (atur lewat ikon kunci di bawah sidebar; dibuat otomatis saat pertama mengunci). Hash kata sandinya (scrypt) ada di `NOTES_DIR/.lembar/lock.json`. Tanpa kata sandi, server tidak mengirim isi, tag, PDF, atau perubahan catatan terkunci; judulnya tetap tampil buram. Terbuka sampai `⌘⌥L`, reload, atau 5 menit tanpa aktivitas. Salah 5× → ditahan 30 detik.
- Isi file `.md` di disk **tidak** dienkripsi: kunci menahan akses lewat Lembar, bukan lewat Finder/editor lain.

## Format Markdown

Dirender dengan markdown-it ([lib/render.js](lib/render.js)); modul yang sama dipakai browser dan server.

- Satu baris baru = baris baru (seperti Bear). Tabel, `~~coret~~`, dan URL `https://…` otomatis jadi tautan.
- Tambahan: `- [ ] todo`, `#tag` dan `#tag/subtag`, `[[Judul catatan]]`, `==sorotan==`.
- HTML mentah di catatan **tidak** dirender (tampil sebagai teks), dan tautan hanya boleh `http`, `https`, atau `mailto`. Ini sengaja, untuk mencegah XSS.

## Ekspor: Markdown & PDF

- **Markdown (.md):** tombol MD di bar editor mengunduh isi catatan apa adanya (tanpa frontmatter Lembar), termasuk ketikan yang belum tersimpan. Nama file dari judul.
- **PDF:** tombol PDF mengunduh PDF A4 tanpa meninggalkan halaman; kemajuannya tampil di panel kecil di pojok kanan bawah (bisa dibatalkan). Endpoint: `GET /api/notes/:id/pdf`.

PDF dibuat dengan Google Chrome yang sudah terpasang (puppeteer-core, tanpa mengunduh Chromium):

- Font sama dengan aplikasi (disisipkan ke PDF), nomor halaman di footer, tanggal WIB dan tag di bawah judul.
- Blok kode, tabel, dan kutipan tidak dipotong antar halaman; yang lebih panjang dari satu halaman dipotong di antara baris.
- Chrome dijalankan dengan profil sementara (profil Chrome Anda tidak disentuh) dan ditutup lagi setelah 60 detik tanpa ekspor.
- Ekspor pertama butuh beberapa detik (menyalakan Chrome); berikutnya jauh lebih cepat.

## Backup dengan git

```bash
cd ~/Documents/06-Archive/Lembar/notes
git init
git add -A && git commit -m "Backup catatan"
```

Jalankan dua perintah terakhir kapan pun ingin membuat titik backup, lalu `git push` ke remote privat kalau ingin salinan di luar laptop. Simpan juga `.trash/` di git, atau tambahkan `.trash/` ke `.gitignore` kalau tidak perlu.
