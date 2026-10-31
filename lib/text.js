// Fungsi teks murni tanpa dependensi. Dipakai server (indeks) dan nanti browser,
// supaya judul, tag, dan snippet dihitung dengan aturan yang sama di kedua sisi.

export const UNTITLED = 'Tanpa judul';

// #tag atau #tag/subtag, harus diawali awal baris atau spasi (jadi "# Judul" dan
// "url#anchor" bukan tag).
export const TAG_RE = /(^|\s)#([\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*)/gu;

const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})\s*$/;
const INLINE_CODE_RE = /(`+)(?:(?!\1)[\s\S])+?\1/g;

/** Judul = baris pertama yang tidak kosong, tanpa tanda # di depannya. */
export function titleOf(body) {
  const first = body.split('\n').find(l => l.trim()) ?? '';
  return first.replace(/^\s*#+\s*/, '').trim() || UNTITLED;
}

/**
 * Jalankan fn untuk setiap baris di luar blok kode berpagar (``` atau ~~~).
 * Inline code di baris tersebut sudah diganti spasi.
 */
function eachProseLine(body, fn) {
  let fence = null;
  for (const line of body.split('\n')) {
    if (fence) {
      const m = line.match(FENCE_CLOSE_RE);
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      continue;
    }
    const open = line.match(FENCE_OPEN_RE);
    if (open) { fence = open[1]; continue; }
    fn(line.replace(INLINE_CODE_RE, ' '));
  }
}

/** Daftar tag unik (huruf kecil), mengabaikan isi blok kode dan inline code. */
export function tagsOf(body) {
  const out = new Set();
  eachProseLine(body, line => {
    for (const m of line.matchAll(TAG_RE)) out.add(m[2].toLowerCase());
  });
  return [...out];
}

// Item daftar (boleh bernomor atau di dalam kutipan) yang belum dicentang, di luar blok kode.
const OPEN_TODO_RE = /^(?:[ \t]*>)*[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[ \][ \t]/;
export function hasOpenTodo(body) {
  let found = false;
  eachProseLine(body, line => { found ||= OPEN_TODO_RE.test(line); });
  return found;
}

export function snippetOf(body, max = 140) {
  const lines = body.split('\n');
  const titleIdx = lines.findIndex(l => l.trim());
  return lines.slice(titleIdx + 1).join(' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*`=~>\[\]]|- \[.\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Nama file aman dari judul catatan, mis. ("Rapat: 5/10", "pdf") -> "Rapat- 5-10.pdf". */
export function safeFilename(title, ext) {
  const name = String(title).replace(/\s+/g, ' ').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '-').trim().slice(0, 100) || 'catatan';
  return `${name}.${ext}`;
}
