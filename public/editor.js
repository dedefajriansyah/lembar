// Editor Markdown: toolbar ala Jira dan perilaku ketik pintar untuk <textarea id="src">.
// Semua perubahan lewat replace() -> execCommand('insertText') supaya ⌘Z/Ctrl+Z tetap bisa membatalkan.
import { LANGUAGES, languageLabel } from '/lib/highlight.js';

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl+';
const ALT = isMac ? '⌥' : 'Alt+';
const SHIFT = isMac ? '⇧' : 'Shift+';

/* ===== Toolbar ===== */

export function toolbarHtml(I) {
  const btn = (fmt, icon, label, keys) =>
    `<button class="icon-btn" data-fmt="${fmt}" title="${label}${keys ? ` (${keys})` : ''}" aria-label="${label}">${icon}</button>`;
  const langs = LANGUAGES.map(l => `<option value="${l.id}">${l.label}</option>`).join('');
  return `<div class="fmt" role="toolbar" aria-label="Format">
    <select class="fmt-select" id="fmtStyle" aria-label="Gaya teks" title="Gaya teks (${MOD}${ALT}0–3)">
      <option value="0">Teks normal</option><option value="1">Judul 1</option>
      <option value="2">Judul 2</option><option value="3">Judul 3</option>
    </select>
    <span class="fmt-sep"></span>
    ${btn('bold', '<b>B</b>', 'Tebal', `${MOD}B`)}
    ${btn('italic', '<i style="font-family:var(--read)">I</i>', 'Miring', `${MOD}I`)}
    ${btn('strike', I.strike, 'Coret', `${MOD}${SHIFT}X`)}
    ${btn('highlight', I.highlight, 'Sorot', `${MOD}${SHIFT}H`)}
    ${btn('code', I.code, 'Kode inline', `${MOD}${SHIFT}M`)}
    <span class="fmt-sep"></span>
    ${btn('ul', I.list, 'Daftar', `${MOD}${SHIFT}8`)}
    ${btn('ol', I.ol, 'Daftar bernomor', `${MOD}${SHIFT}7`)}
    ${btn('todo', I.check, 'Todo', `${MOD}${SHIFT}9`)}
    ${btn('quote', I.quote, 'Kutipan', `${MOD}${SHIFT}.`)}
    <span class="fmt-sep"></span>
    ${btn('link', I.link, 'Tautan', `${MOD}K`)}
    ${btn('wikilink', I.wikilink, 'Tautan ke catatan lain')}
    ${btn('table', I.table, 'Tabel')}
    ${btn('hr', I.hr, 'Garis pemisah')}
    <span class="fmt-sep"></span>
    ${btn('codeblock', I.codeblock, 'Blok kode', `${MOD}${ALT}C`)}
    <select class="fmt-select" id="fmtLang" aria-label="Bahasa blok kode" title="Bahasa blok kode">
      <option value="" disabled>Bahasa…</option>${langs}
    </select>
  </div>`;
}

/** Samakan isi toolbar dengan posisi kursor: gaya baris & bahasa blok kode. */
export function syncToolbar(ta) {
  const style = document.getElementById('fmtStyle'), lang = document.getElementById('fmtLang');
  if (!style || !lang) return;
  const { value: v, selectionStart: s } = ta;
  const fence = fenceAt(v, s);
  const line = v.slice(v.lastIndexOf('\n', s - 1) + 1).split('\n')[0];
  const h = !fence && line.match(/^ {0,3}(#{1,6})\s/);
  style.value = String(h ? Math.min(h[1].length, 3) : 0);
  style.disabled = !!fence;

  lang.querySelector('option[data-custom]')?.remove();
  if (!fence) { lang.value = ''; lang.title = 'Pilih bahasa untuk menyisipkan blok kode'; return; }
  lang.title = 'Bahasa blok kode ini';
  const id = fence.lang.toLowerCase();
  const match = LANGUAGES.find(l => l.id === id) ?? (id && LANGUAGES.find(l => l.label === languageLabel(id)))
    ?? (!id ? LANGUAGES.find(l => l.id === 'text') : null);
  if (match) { lang.value = match.id; return; }
  const opt = new Option(fence.lang, fence.lang);   // bahasa di luar daftar, tampilkan apa adanya
  opt.dataset.custom = '';
  lang.add(opt, 1);
  lang.value = fence.lang;
}

/* ===== Pengeditan teks ===== */

function replace(ta, start, end, text, selStart = start + text.length, selEnd = selStart) {
  ta.focus();
  ta.setSelectionRange(start, end);
  // execCommand masih satu-satunya cara memasukkan teks ke riwayat undo bawaan textarea.
  const ok = text === '' ? document.execCommand('delete') : document.execCommand('insertText', false, text);
  if (!ok) {
    ta.setRangeText(text, start, end, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  ta.setSelectionRange(selStart, selEnd);
}

/** Batas baris yang tercakup seleksi. Seleksi yang berakhir tepat di awal baris tidak ikut baris itu. */
function lineBounds(v, s, e) {
  const start = v.lastIndexOf('\n', s - 1) + 1;
  if (e > s && v[e - 1] === '\n') e--;
  let end = v.indexOf('\n', e);
  if (end < 0) end = v.length;
  return { start, end };
}

/** Ubah setiap baris yang terseleksi. Kursor tunggal tetap di posisi teksnya. */
function mapLines(ta, fn) {
  const { value: v, selectionStart: s, selectionEnd: e } = ta;
  const { start, end } = lineBounds(v, s, e);
  const before = v.slice(start, end).split('\n');
  const after = fn(before);
  const text = after.join('\n');
  if (s === e) {
    const delta = after[0].length - before[0].length;
    const caret = Math.max(start, Math.min(s + delta, start + after[0].length));
    replace(ta, start, end, text, caret);
  } else {
    replace(ta, start, end, text, start, start + text.length);
  }
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*([^`\s]*)/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/**
 * Blok kode berpagar yang memuat posisi pos (dari baris pembuka sampai penutup), atau null.
 * { start, openEnd, infoStart, end, marker, lang, closed }
 */
export function fenceAt(v, pos) {
  let offset = 0, open = null;
  const lines = v.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], lineEnd = offset + line.length;
    if (!open) {
      const m = line.match(FENCE_OPEN);
      if (m) open = { start: offset, openEnd: lineEnd, infoStart: offset + line.indexOf(m[1]) + m[1].length, marker: m[1], lang: m[2] };
      else if (offset > pos) return null;
    } else {
      const m = line.match(FENCE_CLOSE);
      if (m && m[1][0] === open.marker[0] && m[1].length >= open.marker.length) {
        if (pos >= open.start && pos <= lineEnd) return { ...open, end: lineEnd, closed: true };
        open = null;
        if (lineEnd >= pos) return null;
      }
    }
    if (open && i === lines.length - 1 && pos >= open.start) return { ...open, end: lineEnd, closed: false };
    offset = lineEnd + 1;
  }
  return null;
}

function wrap(ta, mark, placeholder) {
  const { value: v, selectionStart: s, selectionEnd: e } = ta;
  const n = mark.length;
  // Sudah terbungkus penanda yang sama -> lepas (toggle). Untuk penanda satu karakter,
  // pastikan bukan bagian dari penanda yang lebih panjang (mis. * di dalam **).
  const wrapped = v.slice(s - n, s) === mark && v.slice(e, e + n) === mark
    && (n > 1 || (v[s - n - 1] !== mark && v[e + n] !== mark));
  if (wrapped) return replace(ta, s - n, e + n, v.slice(s, e), s - n, e - n);
  const text = v.slice(s, e) || placeholder;
  replace(ta, s, e, mark + text + mark, s + n, s + n + text.length);
}

const LIST_MARK = /^(\s*)(?:[-*+] \[[ xX]\] |[-*+] |\d+[.)] )/;
const IS = {
  ul: l => /^\s*[-*+] (?!\[[ xX]\] )/.test(l),
  ol: l => /^\s*\d+[.)] /.test(l),
  todo: l => /^\s*[-*+] \[[ xX]\] /.test(l),
  quote: l => /^\s*>/.test(l),
};

function toggleList(ta, kind) {
  mapLines(ta, lines => {
    const used = lines.filter(l => l.trim() || lines.length === 1);
    if (used.every(IS[kind])) {
      return lines.map(l => kind === 'quote' ? l.replace(/^(\s*)> ?/, '$1') : l.replace(LIST_MARK, '$1'));
    }
    let n = 0;
    return lines.map(l => {
      if (!l.trim() && lines.length > 1) return l;
      if (kind === 'quote') return IS.quote(l) ? l : '> ' + l;
      const body = l.replace(LIST_MARK, '$1');
      const indent = body.match(/^\s*/)[0];
      const mark = kind === 'ul' ? '- ' : kind === 'todo' ? '- [ ] ' : `${++n}. `;
      return indent + mark + body.slice(indent.length);
    });
  });
}

function setHeading(ta, level) {
  if (fenceAt(ta.value, ta.selectionStart)) return;
  mapLines(ta, lines => lines.map(l => {
    const text = l.replace(/^ {0,3}#{1,6}[ \t]+/, '');
    return level > 0 && (text.trim() || lines.length === 1) ? '#'.repeat(level) + ' ' + text : text;
  }));
}

/** Sisipkan blok di barisnya sendiri, dipisah baris kosong dari teks di sekitarnya. */
function insertBlock(ta, block, caretInBlock = block.length) {
  const { value: v, selectionStart: s, selectionEnd: e } = ta;
  const before = v.slice(0, s), after = v.slice(e);
  const pre = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const post = !after ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  replace(ta, s, e, pre + block + post, s + pre.length + caretInBlock);
}

function codeBlock(ta, lang) {
  const { value: v, selectionStart: s, selectionEnd: e } = ta;
  const info = lang === 'text' ? '' : lang;
  const fence = fenceAt(v, s);
  if (fence) {   // di dalam blok: ganti bahasanya saja
    const old = v.slice(fence.infoStart, fence.openEnd);
    const pos = s + (info.length - old.length) * (s > fence.openEnd ? 1 : 0);
    return replace(ta, fence.infoStart, fence.openEnd, info, Math.max(fence.infoStart, pos));
  }
  const sel = v.slice(s, e).replace(/\n$/, '');
  if (sel) insertBlock(ta, '```' + info + '\n' + sel + '\n```', 3 + info.length + 1 + sel.length);
  else insertBlock(ta, '```' + info + '\n\n```', 3 + info.length + 1);
}

function link(ta) {
  const { value: v, selectionStart: s, selectionEnd: e } = ta;
  const sel = v.slice(s, e);
  if (/^https?:\/\/\S+$/.test(sel)) return replace(ta, s, e, `[teks](${sel})`, s + 1, s + 5);
  const text = sel || 'teks tautan';
  replace(ta, s, e, `[${text}](https://)`, s + text.length + 3, s + text.length + 11);
}

let lastLang = '';
try { lastLang = localStorage.getItem('lembar:codeLang') ?? ''; } catch {}
const rememberLang = l => { lastLang = l; try { localStorage.setItem('lembar:codeLang', l); } catch {} };

/** Jalankan aksi toolbar. kind: bold|italic|…|heading|codeblock; arg: level/bahasa. */
export function applyFormat(ta, kind, arg) {
  if (!ta) return;
  const inFence = !!fenceAt(ta.value, ta.selectionStart);
  // Di dalam blok kode hanya aksi blok kode yang berlaku; format lain akan merusak kodenya.
  if (inFence && !['codeblock', 'code'].includes(kind)) return;
  switch (kind) {
    case 'bold': return wrap(ta, '**', 'teks tebal');
    case 'italic': return wrap(ta, '*', 'teks miring');
    case 'strike': return wrap(ta, '~~', 'teks dicoret');
    case 'highlight': return wrap(ta, '==', 'teks disorot');
    case 'code': return inFence ? undefined : wrap(ta, '`', 'kode');
    case 'ul': case 'ol': case 'todo': case 'quote': return toggleList(ta, kind);
    case 'heading': return setHeading(ta, Number(arg));
    case 'link': return link(ta);
    case 'wikilink': return wrap2(ta, '[[', ']]', 'Judul catatan');
    case 'table': return insertBlock(ta, '| Kolom 1 | Kolom 2 |\n| --- | --- |\n| isi | isi |', 2);
    case 'hr': return insertBlock(ta, '---');
    case 'codeblock': {
      const lang = arg ?? lastLang;
      if (arg !== undefined) rememberLang(arg);
      return codeBlock(ta, lang);
    }
  }
}

function wrap2(ta, a, b, placeholder) {
  const { value: v, selectionStart: s, selectionEnd: e } = ta;
  const text = v.slice(s, e) || placeholder;
  replace(ta, s, e, a + text + b, s + a.length, s + a.length + text.length);
}

/* ===== Ketik pintar ===== */

const LIST_LINE = /^((?:[ \t]*>)*[ \t]*)([-*+]|(\d+)([.)]))( \[[ xX]\])? /;

function onEnter(ta) {
  const { value: v, selectionStart: s, selectionEnd: e } = ta;
  if (s !== e) return false;
  const ls = v.lastIndexOf('\n', s - 1) + 1;
  let le = v.indexOf('\n', s); if (le < 0) le = v.length;
  const line = v.slice(ls, le);

  const fence = fenceAt(v, s);
  if (fence) {
    // Baru saja mengetik ```bahasa lalu Enter: tutup bloknya otomatis.
    if (!fence.closed && s === fence.openEnd && fence.start === ls) {
      replace(ta, s, s, '\n\n' + fence.marker, s + 1);
      return true;
    }
    if (s > fence.openEnd) {   // di dalam kode: pertahankan indentasi baris
      replace(ta, s, s, '\n' + line.match(/^[ \t]*/)[0]);
      return true;
    }
    return false;
  }

  const m = line.match(LIST_LINE);
  if (m && s >= ls + m[0].length) {
    if (!line.slice(m[0].length).trim()) {   // item kosong: keluar dari daftar (awalan kutipan tetap)
      const keep = m[1].includes('>') ? m[1] : '';
      replace(ta, ls, le, keep, ls + keep.length);
      return true;
    }
    const mark = m[3] ? `${Number(m[3]) + 1}${m[4]}` : m[2];
    replace(ta, s, s, '\n' + m[1] + mark + (m[5] ? ' [ ]' : '') + ' ');
    return true;
  }

  const q = line.match(/^((?:[ \t]*>)+[ \t]?)/);
  if (q && s >= ls + q[0].length) {
    if (!line.slice(q[0].length).trim()) { replace(ta, ls, le, '', ls); return true; }
    replace(ta, s, s, '\n' + q[1]);
    return true;
  }
  return false;
}

function onTab(ta, outdent) {
  const { value: v, selectionStart: s, selectionEnd: e } = ta;
  const ls = v.lastIndexOf('\n', s - 1) + 1;
  const line = v.slice(ls).split('\n')[0];
  const multi = v.slice(s, e).includes('\n');
  if (!outdent && !multi && !LIST_LINE.test(line)) {
    replace(ta, s, e, '  ');
    return true;
  }
  mapLines(ta, lines => lines.map(l => outdent ? l.replace(/^( {1,2}|\t)/, '') : (l ? '  ' + l : l)));
  return true;
}

/** Tangani tombol di editor. Mengembalikan true kalau sudah ditangani (panggil preventDefault). */
export function handleEditorKeydown(e, ta) {
  if (e.isComposing) return false;
  const mod = e.metaKey || e.ctrlKey;
  if (!mod && !e.altKey) {
    if (e.key === 'Enter' && !e.shiftKey) return onEnter(ta);
    if (e.key === 'Tab') return onTab(ta, e.shiftKey);
    if (e.key === 'Escape') { ta.blur(); return true; }
    return false;
  }
  if (!mod) return false;
  const k = e.key.toLowerCase(), c = e.code, sh = e.shiftKey, alt = e.altKey;
  const action =
    !sh && !alt && k === 'b' ? ['bold'] :
    !sh && !alt && k === 'i' ? ['italic'] :
    !sh && !alt && k === 'k' ? ['link'] :
    sh && !alt && c === 'KeyX' ? ['strike'] :
    sh && !alt && c === 'KeyH' ? ['highlight'] :
    sh && !alt && c === 'KeyM' ? ['code'] :
    sh && !alt && c === 'Digit8' ? ['ul'] :
    sh && !alt && c === 'Digit7' ? ['ol'] :
    sh && !alt && c === 'Digit9' ? ['todo'] :
    sh && !alt && c === 'Period' ? ['quote'] :
    !sh && alt && c === 'KeyC' ? ['codeblock'] :
    !sh && alt && /^Digit[0-3]$/.test(c) ? ['heading', c.slice(-1)] : null;
  if (!action) return false;
  applyFormat(ta, ...action);
  return true;
}

/* ===== Tinggi otomatis & kursor tetap terlihat ===== */
// Textarea dibuat setinggi isinya (tanpa scrollbar sendiri) supaya seluruh catatan digulir sebagai satu
// halaman. Tingginya diukur pada salinan tersembunyi: mengubah tinggi textarea asli ke 'auto' sesaat
// membuat kontainer memendek dan posisi gulir melompat ke atas.
const MIRROR_STYLES = ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'fontFamily', 'fontSize',
  'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'tabSize', 'textIndent',
  'whiteSpace', 'wordBreak', 'overflowWrap', 'fontVariantLigatures', 'fontFeatureSettings'];
let measurer, caretMirror, mirrorHost;

// Wadah berukuran nol untuk elemen pengukur, supaya tidak pernah menambah tinggi halaman.
function host() {
  if (!mirrorHost) {
    mirrorHost = document.createElement('div');
    mirrorHost.setAttribute('aria-hidden', 'true');
    mirrorHost.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none';
    document.body.append(mirrorHost);
  }
  return mirrorHost;
}

function copyStyles(from, to) {
  const cs = getComputedStyle(from);
  for (const p of MIRROR_STYLES) to.style[p] = cs[p];
}

export function autoGrow(ta) {
  if (!measurer) {
    measurer = document.createElement('textarea');
    measurer.setAttribute('aria-hidden', 'true');
    measurer.tabIndex = -1;
    measurer.style.cssText = 'position:absolute;left:0;top:0;overflow:hidden;height:0;min-height:0;resize:none';
    host().append(measurer);
  }
  copyStyles(ta, measurer);
  measurer.style.width = ta.getBoundingClientRect().width + 'px';
  measurer.value = ta.value;
  const h = measurer.scrollHeight + 2;   // +2: ruang kecil supaya baris terakhir tidak memicu gulir internal
  measurer.value = '';                   // jangan simpan salinan isi catatan di halaman
  if (Math.abs(ta.offsetHeight - h) > 1) ta.style.height = h + 'px';
  ta.scrollTop = 0;
}

/** Gulir kontainer seperlunya supaya baris kursor terlihat (dengan sedikit jarak dari tepi). */
export function revealCaret(ta, margin = 48) {
  const scroller = ta.closest('.pane, .ed-body');
  if (!scroller || ta.selectionStart !== ta.selectionEnd) return;
  if (!caretMirror) {
    caretMirror = document.createElement('div');
    caretMirror.setAttribute('aria-hidden', 'true');
    caretMirror.style.cssText = 'position:absolute;left:0;top:0;white-space:pre-wrap;overflow-wrap:break-word';
    host().append(caretMirror);
  }
  copyStyles(ta, caretMirror);
  caretMirror.style.whiteSpace = 'pre-wrap';
  caretMirror.style.width = ta.getBoundingClientRect().width + 'px';
  caretMirror.textContent = ta.value.slice(0, ta.selectionStart);
  const mark = document.createElement('span');
  mark.textContent = '\u200b';
  caretMirror.append(mark);
  const lineH = parseFloat(getComputedStyle(ta).lineHeight) || 24;
  const top = ta.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop + mark.offsetTop;
  caretMirror.textContent = '';          // jangan simpan salinan isi catatan di halaman
  if (top + lineH + margin > scroller.scrollTop + scroller.clientHeight) {
    scroller.scrollTop = top + lineH + margin - scroller.clientHeight;
  } else if (top - margin < scroller.scrollTop) {
    scroller.scrollTop = Math.max(0, top - margin);
  }
}
