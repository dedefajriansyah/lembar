import { titleOf, tagsOf, snippetOf, hasOpenTodo, safeFilename, UNTITLED } from '/lib/text.js';
import { createRenderer } from '/lib/render.js';
import MarkdownIt from '/vendor/markdown-it.esm.min.mjs';
import { toolbarHtml, applyFormat, handleEditorKeydown, syncToolbar, autoGrow, revealCaret } from '/editor.js';

const { render } = createRenderer(MarkdownIt);

/* ===== Ikon ===== */
const I = {
  notes:'<svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 16h5"/></svg>',
  todo:'<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>',
  today:'<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
  key:'<svg viewBox="0 0 24 24"><circle cx="8" cy="15" r="4"/><path d="m11 12 8.5-8.5M16 7l2.5 2.5M14 9l2 2"/></svg>',
  lock:'<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  unlock:'<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/></svg>',
  trash:'<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  plus:'<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  search:'<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>',
  pin:'<svg viewBox="0 0 24 24"><path d="M9 4h6l-1 6 4 3v2H6v-2l4-3zM12 15v6"/></svg>',
  chev:'<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
  back:'<svg viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg>',
  menu:'<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  sidebar:'<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9 4.5v15"/></svg>',
  moon:'<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
  restore:'<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5M4 4v4.5h4.5"/></svg>',
  list:'<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/></svg>',
  check:'<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>',
  link:'<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  code:'<svg viewBox="0 0 24 24"><path d="m8 8-4 4 4 4M16 8l4 4-4 4"/></svg>',
  strike:'<svg viewBox="0 0 24 24"><path d="M5 12h14M16 6.5C15 5 13.6 4.5 12 4.5c-2.5 0-4.5 1.3-4.5 3.5 0 1.3.7 2.3 2 3M8 17.5c1 1.4 2.4 2 4 2 2.7 0 4.5-1.4 4.5-3.6 0-.8-.2-1.4-.6-1.9"/></svg>',
  highlight:'<svg viewBox="0 0 24 24"><path d="m9 11-5 5v3h3l5-5M9 11l6-6 4 4-6 6M9 11l4 4"/><path d="M4 21h16" stroke-width="2.4"/></svg>',
  ol:'<svg viewBox="0 0 24 24"><path d="M10 6h10M10 12h10M10 18h10M4 4.5h1.5V9M4 9h3M4 14.5c.4-.6 1-.9 1.6-.9.9 0 1.4.5 1.4 1.2 0 1.2-3 2.2-3 3.7h3"/></svg>',
  quote:'<svg viewBox="0 0 24 24"><path d="M5 6v12M10 8h9M10 12h9M10 16h6"/></svg>',
  wikilink:'<svg viewBox="0 0 24 24"><path d="M8 4H5v16h3M16 4h3v16h-3M9.5 12h5"/></svg>',
  table:'<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M10 9.5v10"/></svg>',
  hr:'<svg viewBox="0 0 24 24"><path d="M7 7h10M7 17h10" style="opacity:.45"/><path d="M3 12h18"/></svg>',
  codeblock:'<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="m10 9.5-2.5 2.5 2.5 2.5M14 9.5l2.5 2.5-2.5 2.5"/></svg>',
  expand:'<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  shrink:'<svg viewBox="0 0 24 24"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
  unfold:'<svg viewBox="0 0 24 24"><path d="m7 9 5-5 5 5M7 15l5 5 5-5"/></svg>',
  fold:'<svg viewBox="0 0 24 24"><path d="m7 4 5 5 5-5M7 20l5-5 5 5"/></svg>',
  md:'<svg viewBox="0 0 24 24"><rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M6 15V9l2.5 3L11 9v6M16 9v6M13.5 12.5 16 15l2.5-2.5"/></svg>',
  pdf:'<svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M12 10v7M9 14l3 3 3-3"/></svg>',
};

/* ===== Waktu (WIB / Asia/Jakarta) ===== */
const TZ = 'Asia/Jakarta';
const dayKey = d => new Intl.DateTimeFormat('en-CA',{timeZone:TZ}).format(d);
const hm = d => new Intl.DateTimeFormat('id-ID',{timeZone:TZ,hour:'2-digit',minute:'2-digit'}).format(d);
function shortDate(ts){
  const d = new Date(ts), now = new Date();
  const yest = new Date(now.getTime() - 864e5);
  if (dayKey(d) === dayKey(now)) return 'Hari ini, ' + hm(d);
  if (dayKey(d) === dayKey(yest)) return 'Kemarin, ' + hm(d);
  return new Intl.DateTimeFormat('id-ID',{timeZone:TZ,day:'numeric',month:'short'}).format(d);
}
const longDate = ts => new Intl.DateTimeFormat('id-ID',{timeZone:TZ,weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(ts)) + ' pukul ' + hm(new Date(ts)) + ' WIB';


/* ===== API ===== */
class ApiError extends Error {}
async function api(method, url, body, { keepalive = false } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method, keepalive,
      headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...lockHeader() },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: keepalive ? undefined : AbortSignal.timeout(10_000),
    });
  } catch {
    setOffline(true);
    throw Object.assign(new ApiError('Server tidak merespons'), { network: true });
  }
  setOffline(false);
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (res.status === 423 && lockToken) sessionLost();
  if (!res.ok) throw Object.assign(new ApiError(data.error || `HTTP ${res.status}`), { status: res.status, data });
  return data;
}
const noteUrl = id => `/api/notes/${encodeURIComponent(id)}`;

/* ===== State ===== */
// notes: ringkasan dari server (tanpa isi). Isi catatan yang sudah dibuka ada di bodies,
// dan base menyimpan nilai `updated` server untuk isi itu (dikirim sebagai baseUpdated).
let notes = [];
const bodies = new Map();
const base = new Map();
const fresh = new Map(); // id -> isi awal catatan baru tanpa judul (dibuang kalau ditinggal kosong)
const ui = {
  filter: { type: 'all' }, selected: null, mode: 'read', query: '', searchIds: null,
  loading: true, offline: false, fullscreen: false, sideMini: loadSideMini(),
  ...loadTagPrefs(),
};

/* ===== Kunci =====
 * Satu kata sandi untuk semua catatan terkunci. Membuka kunci memberi token sesi dari server yang
 * hanya disimpan di memori tab ini (reload = terkunci lagi). Tanpa token, server tidak mengirim isi
 * catatan terkunci. Sesi ditutup dengan ⌘⌥L, ⌘⇧L di catatan terkunci, atau 5 menit tanpa aktivitas. */
let lockToken = null;
let lockInfo = { hasPassword: false };
const IDLE_LOCK_MS = 5 * 60_000;
let idleTimer;
const lockHeader = () => (lockToken ? { 'X-Lembar-Unlock': lockToken } : {});
const isOpen = n => !n.locked || !!lockToken;

async function refreshLockInfo(){
  try { lockInfo = await api('GET', '/api/lock'); } catch { /* tetap pakai nilai lama */ }
}
function touchIdle(){
  if (!lockToken) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => endSession('Catatan terkunci ditutup otomatis (5 menit tidak aktif)'), IDLE_LOCK_MS);
}
for (const ev of ['pointerdown', 'keydown', 'wheel', 'input']) document.addEventListener(ev, touchIdle, { passive: true, capture: true });

async function startSession(token, msg){
  lockToken = token;
  lockInfo.hasPassword = true;
  touchIdle();
  await reloadAll();          // ringkasan lengkap (snippet & tag) catatan terkunci
  flushAll();                 // simpanan yang sempat tertahan karena sesi habis
  if (msg) toast(msg);
}
/** Tutup semua catatan terkunci: simpan dulu yang sedang diedit, lalu buang isinya dari memori. */
async function endSession(msg){
  if (!lockToken) return;
  await Promise.all(notes.filter(n => n.locked && busy(n.id)).map(n => flush(n.id)));
  const token = lockToken;
  lockToken = null;
  clearTimeout(idleTimer);
  fetch('/api/lock/session', { method: 'DELETE', headers: { 'X-Lembar-Unlock': token } }).catch(() => {});
  for (const n of notes) if (n.locked) { bodies.delete(n.id); base.delete(n.id); }
  await reloadAll();
  if (msg) toast(msg);
}
/** Server menolak token (kedaluwarsa / server restart). */
function sessionLost(){
  if (!lockToken) return;
  lockToken = null;
  clearTimeout(idleTimer);
  for (const n of notes) if (n.locked && !busy(n.id)) { bodies.delete(n.id); base.delete(n.id); }
  reloadAll();
  toast('Sesi catatan terkunci berakhir. Masukkan kata sandi lagi.');
}

async function lockNote(n){
  if (!lockInfo.hasPassword) await refreshLockInfo();
  if (!lockInfo.hasPassword) return openPasswordDialog({ then: () => lockNote(cur() ?? n) });
  await flush(n.id);
  if (busy(n.id)) return toast('Simpan dulu: ' + (statusOf(n.id)[1] || 'perubahan belum tersimpan'));
  await setMeta(n, { locked: true }, 'Catatan dikunci');
  if (lockToken) await endSession();   // mengunci = langsung tertutup, perlu kata sandi untuk membuka
  else { bodies.delete(n.id); renderAll(); }
}

/* Dialog atur / ganti kata sandi */
function openPasswordDialog({ then } = {}){
  const change = lockInfo.hasPassword;
  const d = document.createElement('dialog');
  d.className = 'pw-dialog';
  d.innerHTML = `<form method="dialog" id="pwForm">
    <h2>${change ? 'Ganti kata sandi' : 'Buat kata sandi'}</h2>
    <p>${change ? 'Satu kata sandi untuk semua catatan terkunci.' : 'Kata sandi ini dipakai untuk membuka semua catatan terkunci. Minimal 4 karakter.'}</p>
    ${change ? '<label>Kata sandi sekarang<input type="password" name="current" autocomplete="current-password" required></label>' : ''}
    <label>Kata sandi baru<input type="password" name="password" autocomplete="new-password" minlength="4" required></label>
    <label>Ulangi kata sandi baru<input type="password" name="confirm" autocomplete="new-password" minlength="4" required></label>
    <div class="err" role="alert"></div>
    <p class="hint">Isi file .md di disk tidak dienkripsi; kunci ini menahan akses lewat Lembar.</p>
    <div class="pw-actions"><button type="button" class="btn-ghost" value="cancel">Batal</button><button class="btn" value="ok">Simpan</button></div>
  </form>`;
  document.body.append(d);
  const form = d.querySelector('form'), err = d.querySelector('.err');
  const dismiss = () => { if (d.open) d.close(); d.remove(); };
  d.querySelector('[value=cancel]').onclick = dismiss;
  d.addEventListener('close', () => d.remove());   // Esc menutup dialog lewat browser
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(form);
    if (fd.get('password') !== fd.get('confirm')) { err.textContent = 'Kata sandi baru tidak sama.'; return; }
    try {
      const { token } = await api('POST', '/api/lock/password', { current: fd.get('current') ?? undefined, password: fd.get('password') });
      dismiss();
      await startSession(token, change ? 'Kata sandi diganti' : 'Kata sandi dibuat');
      then?.();
    } catch (ex) { err.textContent = ex.message; }
  });
  d.showModal();
}

/* Sidebar diciutkan jadi kolom ikon (⌘B di luar editor). Preferensi tampilan, disimpan di browser. */
function loadSideMini(){ try { return localStorage.getItem('lembar:sideMini') === '1'; } catch { return false; } }
function toggleSideMini(){
  ui.sideMini = !ui.sideMini;
  try { localStorage.setItem('lembar:sideMini', ui.sideMini ? '1' : '0'); } catch {}
  renderSide();
}

/* Preferensi tampilan pohon tag (bukan data catatan), disimpan di browser ini saja. */
function loadTagPrefs(){
  try {
    const p = JSON.parse(localStorage.getItem('lembar:tags') || '{}');
    return { collapsed: new Set(Array.isArray(p.collapsed) ? p.collapsed : []), tagsHidden: p.hidden === true };
  } catch { return { collapsed: new Set(), tagsHidden: false }; }
}
function saveTagPrefs(){
  try { localStorage.setItem('lembar:tags', JSON.stringify({ collapsed: [...ui.collapsed], hidden: ui.tagsHidden })); } catch {}
}
/** Buka semua induk dari tag (dan bagian Tag) supaya tag yang dipilih terlihat. */
function revealTag(tag){
  const parts = tag.split('/');
  for (let i = 1; i < parts.length; i++) ui.collapsed.delete(parts.slice(0, i).join('/'));
  ui.tagsHidden = false;
  saveTagPrefs();
}

/* ===== Helper catatan ===== */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const words = t => (t.match(/[\p{L}\p{N}]+/gu) || []).length;
const byId = id => notes.find(n => n.id === id);
const cur = () => byId(ui.selected);
const derive = body => ({ title: titleOf(body), snippet: snippetOf(body), tags: tagsOf(body), todo: hasOpenTodo(body) });
/**
 * Judul catatan terkunci: diburamkan. Yang diburamkan adalah teks pengganti sepanjang judul aslinya,
 * jadi judul asli tidak ada di halaman (tidak bisa disalin, dibaca pembaca layar, atau dilihat di DevTools).
 */
const FILLER = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor ';
const lockedTitle = title => {
  const len = Math.max(6, Math.min(title.length, 60));
  return `<span class="blurred" aria-hidden="true">${FILLER.repeat(2).slice(0, len)}</span><span class="sr-only">Catatan terkunci</span>`;
};
const isBlankNote = n => n.title === UNTITLED && !n.snippet;

/** Masukkan atau perbarui ringkasan dari server. Untuk catatan yang sedang diedit,
 *  judul/tag/snippet tetap dihitung dari isi lokal yang lebih baru. */
function upsert(summary) {
  const { body: _b, ...s } = summary;
  if (busy(s.id) && bodies.has(s.id)) Object.assign(s, derive(bodies.get(s.id)));
  const i = notes.findIndex(n => n.id === s.id);
  if (i < 0) notes.push(s); else notes[i] = { ...notes[i], ...s };
  return byId(s.id);
}
function forget(id) {
  notes = notes.filter(n => n.id !== id);
  bodies.delete(id); base.delete(id); fresh.delete(id);
  const s = saves.get(id); if (s) { clearTimeout(s.timer); clearTimeout(s.retry); saves.delete(id); }
}

/* ===== Filter & pencarian ===== */
const FILTERS = {
  all:   {label:'Semua catatan', icon:'notes', test:n => !n.trashed},
  todo:  {label:'Todo',          icon:'todo',  test:n => !n.trashed && n.todo},
  today: {label:'Hari ini',      icon:'today', test:n => !n.trashed && dayKey(new Date(n.updated)) === dayKey(new Date())},
  locked:{label:'Terkunci',      icon:'lock',  test:n => !n.trashed && n.locked},
  trash: {label:'Sampah',        icon:'trash', test:n => n.trashed},
};
const hasTag = (n, tag) => n.tags.some(t => t === tag || t.startsWith(tag + '/'));
function inFilter(n){
  const f = ui.filter;
  if (f.type === 'tag') return !n.trashed && hasTag(n, f.tag);
  return FILTERS[f.type].test(n);
}
function matchesQuery(n){
  const q = ui.query.trim().toLowerCase();
  if (!q) return true;
  // Hasil server (cari di seluruh isi) dipakai begitu tiba; sebelum itu cocokkan judul & snippet.
  if (ui.searchIds) return ui.searchIds.has(n.id);
  return (n.title + ' ' + (n.locked ? '' : n.snippet)).toLowerCase().includes(q);
}
function visibleNotes(){
  return notes.filter(inFilter).filter(matchesQuery)
    .sort((a,b) => (b.pinned - a.pinned) || (b.updated - a.updated));
}
let searchSeq = 0, searchTimer;
function runSearch(delay = 120){
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const q = ui.query.trim(), seq = ++searchSeq;
    if (!q){ ui.searchIds = null; return; }
    try {
      const res = await api('GET', '/api/notes?q=' + encodeURIComponent(q));
      if (seq !== searchSeq) return;
      ui.searchIds = new Set(res.map(n => n.id));
      renderList();
    } catch { /* tetap pakai pencocokan lokal */ }
  }, delay);
}

/* ===== Autosave ===== */
// Satu slot per catatan: timer debounce, request yang sedang berjalan, dan status terakhir.
const saves = new Map();
const SAVE_DELAY = 500;
const slot = id => saves.get(id) ?? (saves.set(id, { timer:null, retry:null, inflight:null, dirty:false, again:false, error:null, conflict:null, saved:false }), saves.get(id));
const busy = id => { const s = saves.get(id); return !!s && (s.dirty || !!s.inflight); };

function scheduleSave(id, delay = SAVE_DELAY){
  const s = slot(id);
  s.dirty = true; s.saved = false;
  clearTimeout(s.timer);
  s.timer = setTimeout(() => flush(id), delay);
  renderStatus();
}

function flush(id, opts){
  const s = saves.get(id);
  if (!s) return Promise.resolve();
  clearTimeout(s.timer); s.timer = null;
  if (s.inflight){ if (s.dirty) s.again = true; return s.inflight; }
  if (!s.dirty || s.conflict || !bodies.has(id)) return Promise.resolve();
  clearTimeout(s.retry); s.retry = null;
  s.dirty = false;
  const body = bodies.get(id);
  s.inflight = api('PUT', noteUrl(id), { body, baseUpdated: base.get(id) }, opts)
    .then(note => {
      s.error = null; s.saved = true;
      base.set(id, note.updated);
      upsert(note);
      if (ui.query) runSearch();
    })
    .catch(err => {
      s.dirty = true;
      if (err.status === 409 && err.data?.note) { s.conflict = err.data.note; s.error = null; }
      else if (err.status === 404) { forget(id); toast('Catatan sudah tidak ada di server'); }
      else if (err.status === 423) { s.error = Object.assign(new ApiError('catatan terkunci, buka kunci untuk menyimpan'), { status: 423 }); }
      else {
        s.error = err;
        s.retryDelay = Math.min((s.retryDelay || 1500) * 2, 15_000);
        s.retry = setTimeout(() => flush(id), s.retryDelay);
      }
    })
    .finally(() => {
      s.inflight = null;
      if (!s.error) s.retryDelay = 0;
      const again = s.again; s.again = false;
      if (s.conflict && id === ui.selected) renderEditor(); else renderStatus();
      renderList();
      if (again && s.dirty && !s.timer) flush(id);
    });
  renderStatus();
  return s.inflight;
}
const flushAll = opts => Promise.all([...saves.keys()].map(id => flush(id, opts)));

function statusOf(id){
  const s = saves.get(id);
  if (!s) return ['', ''];
  if (s.conflict) return ['conflict', 'Konflik: catatan diubah di luar Lembar'];
  if (s.error) return ['error', s.error.network ? 'Gagal menyimpan, server tidak merespons' : 'Gagal menyimpan: ' + s.error.message];
  if (s.dirty || s.inflight) return ['saving', 'Menyimpan…'];
  if (s.saved) return ['saved', 'Tersimpan'];
  return ['', ''];
}
function renderStatus(){
  const el = $('saveStatus'); if (!el) return;
  const [state, text] = statusOf(ui.selected);
  el.dataset.state = state; el.textContent = text;
}

/** Ubah isi catatan secara lokal lalu jadwalkan simpan. */
function setBody(n, body){
  bodies.set(n.id, body);
  Object.assign(n, derive(body), { updated: Date.now() });
  scheduleSave(n.id);
}

/* ===== Memuat data ===== */
async function loadBody(id){
  // Catatan terkunci tanpa sesi: server pasti menolak (423); layar kunci sudah cukup.
  const n = byId(id);
  if (n && !isOpen(n)) { if (id === ui.selected) renderEditor(); return; }
  try {
    const full = await api('GET', noteUrl(id));
    bodies.set(id, full.body); base.set(id, full.updated); upsert(full);
  } catch (err) {
    if (err.status === 404) { forget(id); if (ui.selected === id) ui.selected = visibleNotes()[0]?.id ?? null; }
    else toast('Gagal memuat catatan: ' + err.message);
  }
  if (id === ui.selected) { renderList(); renderEditor(); }
}

async function reloadAll(){
  try {
    const list = await api('GET', '/api/notes');
    const ids = new Set(list.map(n => n.id));
    for (const id of [...bodies.keys()]) if (!ids.has(id) && !busy(id)) forget(id);
    notes = notes.filter(n => ids.has(n.id) || busy(n.id));
    for (const n of list) {
      upsert(n);
      // isi yang tersimpan di memori sudah usang kalau server punya versi lain
      if (bodies.has(n.id) && !busy(n.id) && base.get(n.id) !== n.updated) bodies.delete(n.id);
    }
  } catch { /* banner offline sudah tampil */ }
  ui.loading = false;
  if (!byId(ui.selected)) ui.selected = visibleNotes()[0]?.id ?? null;
  if (ui.selected && !bodies.has(ui.selected)) loadBody(ui.selected);
  if (ui.query) runSearch(0);
  renderAll();
}

function setOffline(v){
  if (ui.offline === v) return;
  ui.offline = v;
  renderList();
}

/* ===== Perubahan dari luar (SSE) ===== */
function connectEvents(){
  const es = new EventSource('/api/events');
  let down = false;
  es.addEventListener('open', () => {
    if (!down) return;
    down = false;
    // bisa saja ada event yang terlewat selama terputus
    reloadAll(); flushAll();
  });
  es.addEventListener('error', () => { down = true; setOffline(true); });
  es.addEventListener('change', e => onExternalChange(JSON.parse(e.data)));
}

function onExternalChange({ id, note }){
  if (!note){
    if (!byId(id)) return;
    const wasSelected = id === ui.selected;
    forget(id);
    if (wasSelected){ ui.selected = visibleNotes()[0]?.id ?? null; if (ui.selected && !bodies.has(ui.selected)) loadBody(ui.selected); toast('Catatan dihapus di luar Lembar'); }
    return renderAll();
  }
  upsert(note);
  // Sedang diedit: biarkan autosave yang menemukan konflik (server membalas 409).
  if (bodies.has(id) && !busy(id) && base.get(id) !== note.updated){
    bodies.delete(id);
    if (id === ui.selected) loadBody(id);
  }
  renderSide(); renderList();
  if (id === ui.selected) renderEditor();
}

/* ===== Render: sidebar ===== */
const $ = id => document.getElementById(id);
const app = $('app');
function renderSide(){
  app.classList.toggle('side-mini', ui.sideMini);
  const isCur = (type, tag) => ui.filter.type === type && (type !== 'tag' || ui.filter.tag === tag);
  let h = `<div class="brand"><img class="brand-mark" src="icons/icon.svg" alt="" aria-hidden="true"><b>Lembar</b></div><div class="side-scroll"><nav>`;
  for (const [k,f] of Object.entries(FILTERS)){
    const c = notes.filter(f.test).length;
    // Di kolom ikon teksnya disembunyikan; nama & jumlah tetap ada lewat aria-label dan tooltip.
    const tip = ui.sideMini ? ` title="${f.label}${c ? ` (${c})` : ''}"` : '';
    h += `<button class="nav-item" data-filter="${k}" aria-current="${isCur(k)}" aria-label="${f.label}${c ? `, ${c} catatan` : ''}"${tip}>${I[f.icon]}<span>${f.label}</span><span class="count">${c||''}</span></button>`;
  }
  const live = notes.filter(n => !n.trashed);
  const paths = [...new Set(live.flatMap(n => n.tags.flatMap(t => t.split('/').map((_, i, a) => a.slice(0, i + 1).join('/')))))].sort();
  const childrenOf = parent => paths.filter(p => parent === null ? !p.includes('/') : p.startsWith(parent + '/') && !p.slice(parent.length+1).includes('/'));
  const parents = paths.filter(p => childrenOf(p).length);
  const allOpen = parents.every(p => !ui.collapsed.has(p));
  h += `</nav><div class="side-h">
    <button class="side-h-btn" id="tagsToggle" aria-expanded="${!ui.tagsHidden}" aria-controls="tagTree">
      <span class="chev" aria-hidden="true">${I.chev}</span>Tag</button>
    ${!ui.tagsHidden && parents.length ? `<button class="icon-btn side-h-act" id="tagsAll" data-open="${!allOpen}"
      title="${allOpen ? 'Tutup semua tag' : 'Buka semua tag'}" aria-label="${allOpen ? 'Tutup semua tag' : 'Buka semua tag'}">${allOpen ? I.fold : I.unfold}</button>` : ''}
  </div>`;
  const total = p => live.filter(n => hasTag(n, p)).length;
  const tree = parent => {
    const kids = childrenOf(parent); if (!kids.length) return '';
    return '<ul class="tree">' + kids.map(p => {
      const sub = childrenOf(p), name = p.split('/').pop(), exp = !ui.collapsed.has(p);
      return `<li><div class="tag-row">${sub.length ? `<button class="chev" data-expand="${esc(p)}" aria-expanded="${exp}" aria-label="${exp ? 'Tutup' : 'Buka'} tag ${esc(name)}">${I.chev}</button>` : '<span class="chev-spacer"></span>'}
        <button class="nav-item" data-tag="${esc(p)}" aria-current="${isCur('tag',p)}"><span><span class="tag-hash">#</span>${esc(name)}</span><span class="count">${total(p)}</span></button></div>
        ${sub.length && exp ? tree(p) : ''}</li>`;
    }).join('') + '</ul>';
  };
  h += `<div id="tagTree"${ui.tagsHidden ? ' hidden' : ''}>${paths.length ? tree(null) : '<p class="empty">Ketik #tag di catatan untuk membuat tag.</p>'}</div>` + `</div>
  <div class="side-foot">
    <button class="icon-btn" id="pwBtn" aria-label="Atur kata sandi catatan terkunci" title="Atur kata sandi catatan terkunci">${I.key}</button>
    <button class="icon-btn" id="sideBtn" aria-pressed="${ui.sideMini}" aria-label="${ui.sideMini ? 'Lebarkan sidebar' : 'Ciutkan sidebar'}" title="${ui.sideMini ? 'Lebarkan sidebar' : 'Ciutkan sidebar'} (⌘B)">${I.sidebar}</button>
    <button class="icon-btn" id="themeBtn" aria-label="Ganti tema terang atau gelap" title="Ganti tema">${I.moon}</button></div>`;
  $('side').innerHTML = h;
}

/* ===== Render: daftar catatan ===== */
function renderList(){
  const f = ui.filter, label = f.type === 'tag' ? '#' + f.tag : FILTERS[f.type].label;
  const items = visibleNotes();
  const q = $('q'), hadFocus = q && document.activeElement === q, pos = q?.selectionStart;
  let h = `<div class="list-head">
    <div class="list-title">
      <button class="icon-btn mob-only" data-pane="side" aria-label="Buka navigasi">${I.menu}</button>
      <h1>${esc(label)}</h1>
      ${f.type !== 'trash' ? `<button class="btn-new" id="newBtn" title="Catatan baru (N)">${I.plus}Baru</button>` : ''}
    </div>
    <label class="search">${I.search}<input id="q" type="search" placeholder="Cari catatan" value="${esc(ui.query)}" aria-label="Cari catatan"></label>
  </div>`;
  if (ui.offline) h += `<p class="offline" role="alert">Server tidak merespons. Perubahan akan disimpan begitu tersambung lagi.</p>`;
  h += `<div class="notes" role="list">`;
  if (ui.loading) h += `<p class="empty">Memuat catatan…</p>`;
  else if (!items.length){
    h += `<p class="empty">${ui.query ? 'Tidak ada catatan yang cocok dengan "' + esc(ui.query) + '".' : f.type === 'trash' ? 'Sampah kosong.' : 'Belum ada catatan di sini. Tekan Baru untuk mulai menulis.'}</p>`;
  }
  for (const n of items){
    const hidden = !isOpen(n);
    const tags = n.tags.slice(0,2).map(t => `<span class="t">#${esc(t)}</span>`).join('');
    h += `<button class="note-item" role="listitem" data-id="${esc(n.id)}" aria-current="${n.id === ui.selected}">
      <div class="ni-top"><span class="ni-title">${hidden ? lockedTitle(n.title) : esc(n.title)}</span>${n.pinned ? I.pin : ''}${n.locked ? I.lock : ''}</div>
      <div class="ni-snip">${hidden ? 'Catatan terkunci' : esc(n.snippet || 'Belum ada isi')}</div>
      <div class="ni-meta"><span>${shortDate(n.updated)}</span>${hidden ? '' : tags}</div></button>`;
  }
  $('list').innerHTML = h + '</div>';
  if (hadFocus){ const nq = $('q'); nq.focus(); nq.setSelectionRange(pos, pos); }
}

/* ===== Render: editor ===== */
function renderEditor(){
  const n = cur(), E = $('editor');
  // Tampilan penuh hanya untuk mode Baca dengan catatan terbuka (mis. N membuat catatan baru di mode Tulis).
  if (ui.fullscreen && (ui.mode !== 'read' || !n || n.trashed)) return setFullscreen(false);
  // pertahankan kursor & posisi gulir kalau yang dirender ulang catatan yang sama
  const oldTa = $('src'), sameNote = n && E.dataset.id === n.id;
  const keep = sameNote && oldTa ? { s: oldTa.selectionStart, e: oldTa.selectionEnd, focus: document.activeElement === oldTa } : null;
  const scroll = sameNote ? E.querySelector('.ed-body')?.scrollTop : 0;
  E.dataset.id = n?.id ?? '';

  if (!n || !inFilterOrSelectedOk(n)){
    E.innerHTML = `<div class="ed-empty"><div>${I.notes.replace('<svg','<svg style="width:40px;height:40px;opacity:.5"')}<p>Pilih catatan di daftar, atau buat yang baru.</p><button class="btn" id="newBtn2">Buat catatan</button></div></div>`;
    return;
  }
  const text = bodies.get(n.id);
  const hidden = !isOpen(n);
  const conflict = saves.get(n.id)?.conflict;
  let bar = `<div class="ed-bar">
    <button class="icon-btn back-btn" data-pane="list" aria-label="Kembali ke daftar">${I.back}</button>`;
  if (n.trashed){
    bar += `<span style="color:var(--ink-2);font-size:14px">Catatan ini ada di Sampah.</span><span class="spacer"></span>
      <button class="btn-ghost" id="restoreBtn">Pulihkan</button>
      <button class="btn-ghost btn-danger" id="purgeBtn">Hapus permanen</button>`;
  } else if (!hidden){
    bar += `<div class="seg" role="group" aria-label="Mode">
        <button data-mode="write" aria-pressed="${ui.mode==='write'}">Tulis</button>
        <button data-mode="split" class="split-only" aria-pressed="${ui.mode==='split'}" title="Tulis dengan pratinjau di samping">Belah</button>
        <button data-mode="read" aria-pressed="${ui.mode==='read'}">Baca</button></div>
      ${ui.mode !== 'read' ? toolbarHtml(I) : ''}
      <span class="spacer"></span>
      <button class="icon-btn" id="pinBtn" aria-pressed="${n.pinned}" aria-label="${n.pinned?'Lepas sematan':'Sematkan'}" title="${n.pinned?'Lepas sematan':'Sematkan'}">${I.pin}</button>
      <button class="icon-btn" id="lockBtn" aria-pressed="${n.locked}" aria-label="${n.locked?'Hapus kunci':'Kunci catatan'}" title="${n.locked?'Hapus kunci':'Kunci catatan (⌘⇧L)'}">${n.locked?I.lock:I.unlock}</button>
      ${ui.mode === 'read' ? `<button class="icon-btn" id="fullBtn" aria-pressed="${ui.fullscreen}" aria-label="${ui.fullscreen ? 'Tampilkan sidebar' : 'Tampilan penuh'}" title="${ui.fullscreen ? 'Tampilkan sidebar (Esc)' : 'Tampilan penuh, sembunyikan sidebar (F)'}">${ui.fullscreen ? I.shrink : I.expand}</button>` : ''}
      <button class="icon-btn" id="mdBtn" aria-label="Simpan sebagai Markdown (.md)" title="Simpan sebagai Markdown (.md)">${I.md}</button>
      <button class="icon-btn" id="pdfBtn" aria-label="Unduh PDF" title="Unduh PDF" ${pdfJob?.id === n.id ? 'aria-busy="true" disabled' : ''}>${I.pdf}</button>
      <button class="icon-btn" id="trashBtn" aria-label="Pindahkan ke Sampah" title="Pindahkan ke Sampah">${I.trash}</button>`;
  } else {
    bar += `<span class="spacer"></span>`;
  }
  bar += `</div>`;
  if (conflict && !hidden){
    bar += `<div class="conflict" role="alert"><p>Catatan ini diubah di luar Lembar (${esc(shortDate(conflict.updated))}) sementara Anda menulis.</p>
      <button class="btn-ghost" id="conflictLoad">Muat versi terbaru</button>
      <button class="btn-ghost btn-danger" id="conflictKeep">Timpa dengan versi saya</button></div>`;
  }

  let body;
  if (hidden){
    body = lockInfo.hasPassword
      ? `<div class="lock"><div class="lock-ico">${I.lock}</div><h2>${lockedTitle(n.title)}</h2>
        <p>Catatan ini terkunci. Masukkan kata sandi untuk membuka semua catatan terkunci.</p>
        <form id="unlockForm"><input id="pw" type="password" placeholder="Kata sandi" aria-label="Kata sandi" autocomplete="current-password"><button class="btn">Buka</button></form>
        <div class="err" id="pwErr" role="alert"></div>
        <div class="hint">⌘⌥L menutup lagi semua catatan terkunci</div></div>`
      : `<div class="lock"><div class="lock-ico">${I.lock}</div><h2>${lockedTitle(n.title)}</h2>
        <p>Catatan ini terkunci, tapi kata sandi belum dibuat. Buat kata sandi untuk membukanya.</p>
        <button class="btn" id="pwCreate">Buat kata sandi</button></div>`;
  } else if (text === undefined){
    body = `<div class="ed-inner"><p class="empty">Memuat catatan…</p></div>`;
  } else if (ui.mode !== 'read' && !n.trashed){
    const src = `<textarea class="src" id="src" spellcheck="false" placeholder="# Judul catatan&#10;&#10;Mulai menulis…" aria-label="Isi catatan">${esc(text)}</textarea>`;
    body = ui.mode === 'split'
      ? `<div class="ed-split"><div class="pane pane-src" id="paneSrc"><div class="ed-inner">${src}</div></div>
          <div class="pane pane-preview" id="panePreview" aria-label="Pratinjau"><div class="ed-inner"><article class="prose" id="prose">${render(text)}</article></div></div></div>`
      : `<div class="ed-inner">${src}</div>`;
  } else {
    body = `<div class="ed-inner"><article class="prose" id="prose">${render(text)}</article></div>`;
  }
  let foot = '';
  if (!hidden && text !== undefined){
    const w = words(text);
    foot = `<div class="ed-foot"><span id="wc">${w} kata</span><span id="cc">${text.length} karakter</span><span id="rt">${Math.max(1,Math.round(w/200))} menit baca</span><span id="mod">Diubah ${longDate(n.updated)}</span><span id="saveStatus" class="save-status" role="status" aria-live="polite"></span></div>`;
  }
  const panes = sameNote ? [$('paneSrc')?.scrollTop, $('panePreview')?.scrollTop] : [];
  E.innerHTML = bar + `<div class="ed-body${ui.mode === 'split' && !hidden && !n.trashed ? ' is-split' : ''}">${body}</div>` + foot;
  renderStatus();
  decorateProse($('prose'));
  const ta = $('src');
  if (ta){
    autoGrow(ta);
    if (keep){
      const len = ta.value.length;
      ta.setSelectionRange(Math.min(keep.s, len), Math.min(keep.e, len));
      if (keep.focus) ta.focus({ preventScroll: true });
    }
    syncToolbar(ta);
  }
  if (scroll) E.querySelector('.ed-body').scrollTop = scroll;
  if (panes[0] && $('paneSrc')) $('paneSrc').scrollTop = panes[0];
  if (panes[1] && $('panePreview')) $('panePreview').scrollTop = panes[1];
}
const inFilterOrSelectedOk = n => n.trashed ? ui.filter.type === 'trash' : ui.filter.type !== 'trash';
/** Tambah tombol Salin ke setiap blok kode yang dirender. */
function decorateProse(root){
  if (!root) return;
  for (const pre of root.querySelectorAll('pre.code')){
    if (pre.querySelector('.copy-btn')) continue;
    pre.insertAdjacentHTML('beforeend', '<button type="button" class="copy-btn" aria-label="Salin kode">Salin</button>');
  }
}
async function copyCode(btn){
  const code = btn.closest('pre')?.querySelector('code')?.textContent ?? '';
  try { await navigator.clipboard.writeText(code); }
  catch {
    const t = Object.assign(document.createElement('textarea'), { value: code });
    document.body.append(t); t.select(); document.execCommand('copy'); t.remove();
  }
  btn.textContent = 'Tersalin'; btn.classList.add('done');
  setTimeout(() => { btn.textContent = 'Salin'; btn.classList.remove('done'); }, 1500);
}
let previewTimer;
function schedulePreview(){
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    const p = $('prose'), ta = $('src');
    if (!p || !ta || ui.mode !== 'split') return;
    p.innerHTML = render(ta.value);
    decorateProse(p);
  }, 120);
}
function renderAll(){ renderSide(); renderList(); renderEditor(); }

/* ===== Aksi ===== */
function toast(msg){ const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 1800); }

/** Dipanggil saat meninggalkan catatan: simpan sekarang, atau buang kalau catatan baru masih kosong. */
function leave(id){
  if (!id) return;
  if (fresh.has(id)){
    const body = bodies.get(id) ?? '';
    if (body === fresh.get(id) || !body.replace(/^#[ \t]*$/m, '').trim()) return discard(id);
    fresh.delete(id);
  }
  flush(id);
}
async function discard(id){
  const s = saves.get(id);
  if (s){ clearTimeout(s.timer); s.dirty = false; await s.inflight?.catch(() => {}); }
  forget(id);
  try { await api('DELETE', noteUrl(id)); await api('DELETE', `/api/trash/${encodeURIComponent(id)}`); }
  catch { /* tidak fatal: paling buruk catatan kosong tertinggal di Sampah */ }
  renderSide(); renderList();
}

function select(id, mode){
  if (id !== ui.selected) leave(ui.selected);
  ui.selected = id; if (mode) ui.mode = mode; app.dataset.pane = 'editor';
  if (id && !bodies.has(id)) loadBody(id);
  renderList(); renderEditor();
}

async function newNote(title){
  const tagLine = ui.filter.type === 'tag' ? `\n\n#${ui.filter.tag}` : '';
  const text = `# ${title || ''}${tagLine}\n\n`;
  let note;
  try { note = await api('POST', '/api/notes', { body: text }); }
  catch (err) { return toast('Gagal membuat catatan: ' + err.message); }
  leave(ui.selected);
  bodies.set(note.id, note.body); base.set(note.id, note.updated);
  upsert(note);
  if (!title) fresh.set(note.id, note.body);
  if (['trash','locked','todo'].includes(ui.filter.type)) ui.filter = {type:'all'};
  ui.query = ''; ui.searchIds = null; ui.selected = note.id; ui.mode = ui.mode === 'split' ? 'split' : 'write'; app.dataset.pane = 'editor';
  renderAll();
  const ta = $('src'); if (ta){ ta.focus(); ta.setSelectionRange(2, 2 + (title||'').length); }
}
function setFilter(f){
  if (f.type === 'tag') revealTag(f.tag);
  ui.filter = f; ui.query = ''; ui.searchIds = null;
  const v = visibleNotes();
  if (!v.find(n => n.id === ui.selected)) select(v[0]?.id ?? null);
  app.dataset.pane = 'list'; renderAll();
}
function openLink(title){
  const t = title.trim().toLowerCase();
  const n = notes.find(x => !x.trashed && x.title.toLowerCase() === t);
  if (n){ if (ui.filter.type === 'trash') ui.filter = {type:'all'}; select(n.id, 'read'); renderSide(); }
  else newNote(title.trim()).then(() => toast('Catatan baru dibuat: ' + title.trim()));
}

async function setMeta(n, patch, okMsg){
  const prev = { pinned: n.pinned, locked: n.locked };
  Object.assign(n, patch); renderAll();
  try {
    const r = await api('PUT', noteUrl(n.id), patch);
    Object.assign(n, { pinned: r.pinned, locked: r.locked });
    if (!busy(n.id)) base.set(n.id, r.updated);
    toast(okMsg);
  } catch (err) {
    Object.assign(n, prev); toast('Gagal: ' + err.message);
  }
  renderAll();
}

async function moveNote(n, action){
  const next = () => visibleNotes().find(x => x.id !== n.id)?.id ?? null;
  try {
    if (action === 'trash'){
      fresh.delete(n.id);
      await flush(n.id);
      if (busy(n.id)) throw new ApiError(statusOf(n.id)[1] || 'Perubahan belum tersimpan');
      Object.assign(n, await api('DELETE', noteUrl(n.id)));
      ui.selected = next(); app.dataset.pane = 'list'; toast('Dipindahkan ke Sampah');
    } else if (action === 'restore'){
      Object.assign(n, await api('POST', noteUrl(n.id) + '/restore'));
      ui.selected = next(); toast('Catatan dipulihkan');
    } else if (action === 'purge'){
      if (!confirm('Hapus catatan ini secara permanen? Tindakan ini tidak bisa dibatalkan.')) return;
      await api('DELETE', `/api/trash/${encodeURIComponent(n.id)}`);
      ui.selected = next(); forget(n.id); toast('Catatan dihapus permanen');
    }
  } catch (err) {
    toast('Gagal: ' + err.message);
  }
  if (ui.selected && !bodies.has(ui.selected)) loadBody(ui.selected);
  renderAll();
}

function resolveConflict(n, keepMine){
  const s = slot(n.id), theirs = s.conflict;
  if (!theirs) return;
  s.conflict = null; s.error = null;
  base.set(n.id, theirs.updated);
  if (keepMine){ s.dirty = true; flush(n.id); }
  else { s.dirty = false; bodies.set(n.id, theirs.body); upsert(theirs); toast('Versi terbaru dimuat'); }
  renderAll();
}

/* ===== Unduh: Markdown & PDF ===== */
function saveBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Isi catatan apa adanya (tanpa frontmatter Lembar), termasuk ketikan yang belum tersimpan. */
function saveMarkdown(n){
  const body = bodies.get(n.id);
  if (body === undefined) return toast('Catatan belum dimuat');
  saveBlob(new Blob([body], { type: 'text/markdown;charset=utf-8' }), safeFilename(n.title, 'md'));
  toast('Markdown diunduh: ' + safeFilename(n.title, 'md'));
}

// Panel kemajuan di pojok kanan bawah. Pembuatan PDF di server tidak bisa diukur persentasenya,
// jadi tahap itu memakai bar tak-tentu; tahap unduh memakai persentase sungguhan.
let pdfJob = null;
function showTask({ title, detail = '', progress = null, state = 'busy', cancel = false }){
  const el = $('task');
  el.hidden = false;
  el.dataset.state = state;
  el.innerHTML = `<div class="task-head"><span class="task-title">${esc(title)}</span>
      ${cancel ? '<button type="button" class="task-btn" id="taskCancel">Batal</button>' : '<button type="button" class="task-btn" id="taskClose" aria-label="Tutup">✕</button>'}</div>
    <div class="task-bar${progress === null && state === 'busy' ? ' indeterminate' : ''}" role="progressbar" aria-label="${esc(title)}"
      ${progress !== null ? `aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}"` : ''}>
      <span style="width:${state === 'busy' ? (progress ?? 0) : 100}%"></span></div>
    ${detail ? `<div class="task-detail">${esc(detail)}</div>` : ''}`;
}
function hideTask(delay = 0){
  clearTimeout(hideTask.t);
  hideTask.t = setTimeout(() => { $('task').hidden = true; }, delay);
}

async function exportPdf(n){
  if (pdfJob) return toast('PDF lain sedang dibuat');
  const job = pdfJob = { id: n.id, ctrl: new AbortController() };
  clearTimeout(hideTask.t);
  renderEditor();
  const title = 'PDF: ' + n.title;
  let slowHint;
  try {
    showTask({ title, detail: 'Menyimpan perubahan…', cancel: true });
    await flush(n.id);
    if (busy(n.id)) throw new ApiError(statusOf(n.id)[1] || 'Perubahan belum tersimpan');

    showTask({ title, detail: 'Membuat PDF…', cancel: true });
    slowHint = setTimeout(() => pdfJob === job && showTask({ title, cancel: true,
      detail: 'Membuat PDF… (ekspor pertama butuh beberapa detik untuk menyalakan Chrome)' }), 1500);
    let res;
    try {
      res = await fetch(noteUrl(n.id) + '/pdf', { headers: { Accept: 'application/pdf, application/json', ...lockHeader() }, signal: job.ctrl.signal });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      setOffline(true);
      throw new ApiError('Server tidak merespons');
    }
    clearTimeout(slowHint);
    if (!res.ok) throw new ApiError((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);

    // Unduh dengan persentase (PDF dikirim utuh dengan Content-Length).
    const total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body.getReader(), chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      showTask({ title, detail: 'Mengunduh…', progress: total ? (got / total) * 100 : null, cancel: true });
    }
    const cd = res.headers.get('content-disposition') || '';
    const m = cd.match(/filename\*=UTF-8''([^;]+)/i);
    const filename = m ? decodeURIComponent(m[1]) : safeFilename(n.title, 'pdf');
    saveBlob(new Blob(chunks, { type: 'application/pdf' }), filename);
    showTask({ title: 'PDF siap', detail: filename + ' diunduh', state: 'done' });
    hideTask(4000);
  } catch (err) {
    clearTimeout(slowHint);
    if (err.name === 'AbortError') { showTask({ title: 'Ekspor PDF dibatalkan', state: 'done' }); hideTask(1500); }
    else { showTask({ title: 'Gagal membuat PDF', detail: err.message, state: 'error' }); }
  } finally {
    if (pdfJob === job) pdfJob = null;
    renderEditor();
  }
}

/* ===== Tampilan penuh (mode Baca) ===== */
// Sidebar & daftar disembunyikan di dalam jendela (bukan layar penuh browser).
// Keluar lewat tombol, F, atau Esc.
function setFullscreen(on){
  if (on === ui.fullscreen) return;
  ui.fullscreen = on;
  app.classList.toggle('reading-full', on);
  renderEditor();
}
function toggleFullscreen(){
  const n = cur();
  if (!ui.fullscreen && (!n || ui.mode !== 'read' || (!isOpen(n)))) return;
  setFullscreen(!ui.fullscreen);
}

function toggleTheme(){
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('lembar:theme', root.dataset.theme); } catch {}
}

/* ===== Event ===== */
// Penanda daftar (boleh di dalam kutipan) diikuti [ ] atau [x]; sama dengan yang dikenali renderer.
const TASK_LINE_RE = /^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d+[.)])[ \t]+)\[([ xX])\]/;
document.addEventListener('click', e => {
  const el = e.target.closest('button, a, input[type=checkbox]'); if (!el) return;
  const n = cur();
  if (el.dataset.filter) return setFilter({type:el.dataset.filter});
  if (el.matches('.nav-item[data-tag]')) return setFilter({type:'tag', tag:el.dataset.tag});
  if (el.dataset.expand){ const p = el.dataset.expand; ui.collapsed.has(p) ? ui.collapsed.delete(p) : ui.collapsed.add(p); saveTagPrefs(); return renderSide(); }
  if (el.id === 'tagsToggle'){ ui.tagsHidden = !ui.tagsHidden; saveTagPrefs(); return renderSide(); }
  if (el.id === 'tagsAll'){
    const open = el.dataset.open === 'true';
    const parents = [...new Set(notes.filter(n => !n.trashed).flatMap(n => n.tags.flatMap(t => t.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/')))))];
    ui.collapsed = open ? new Set() : new Set(parents);
    saveTagPrefs(); return renderSide();
  }
  if (el.id === 'fullBtn') return toggleFullscreen();
  if (el.matches('.note-item')){ const t = byId(el.dataset.id); return select(t.id, isBlankNote(t) ? 'write' : ui.mode); }
  if (el.id === 'newBtn' || el.id === 'newBtn2') return newNote();
  if (el.dataset.pane){ app.dataset.pane = el.dataset.pane; return; }
  if (el.dataset.mode){ ui.mode = el.dataset.mode; if (ui.mode !== 'read') setFullscreen(false); renderEditor(); if (ui.mode !== 'read') $('src')?.focus(); return; }
  if (el.dataset.fmt) return applyFormat($('src'), el.dataset.fmt);
  if (el.matches('.copy-btn')) return copyCode(el);
  if (el.matches('a.tag')){ e.preventDefault(); return setFilter({type:'tag', tag:el.dataset.tag.toLowerCase()}); }
  if (el.matches('a.wikilink')){ e.preventDefault(); return openLink(el.dataset.link); }
  if (el.matches('.prose input[type=checkbox]') && n && bodies.has(n.id)){
    const L = bodies.get(n.id).split('\n'), i = +el.dataset.line;
    if (!TASK_LINE_RE.test(L[i] ?? '')) return renderEditor(); // sumber berubah; render ulang
    L[i] = L[i].replace(TASK_LINE_RE, (_, lead, mark) => lead + (mark === ' ' ? '[x]' : '[ ]'));
    setBody(n, L.join('\n')); renderAll(); return;
  }
  if (el.id === 'pinBtn' && n) return setMeta(n, { pinned: !n.pinned }, n.pinned ? 'Sematan dilepas' : 'Catatan disematkan');
  if (el.id === 'lockBtn' && n) return n.locked ? setMeta(n, { locked: false }, 'Kunci dihapus') : lockNote(n);
  if (el.id === 'pwBtn') return openPasswordDialog();
  if (el.id === 'pwCreate') return openPasswordDialog();
  if (el.id === 'pdfBtn' && n) return exportPdf(n);
  if (el.id === 'mdBtn' && n) return saveMarkdown(n);
  if (el.id === 'taskCancel'){ pdfJob?.ctrl.abort(); return; }
  if (el.id === 'taskClose') return hideTask();
  if (el.id === 'trashBtn' && n) return moveNote(n, 'trash');
  if (el.id === 'restoreBtn' && n) return moveNote(n, 'restore');
  if (el.id === 'purgeBtn' && n) return moveNote(n, 'purge');
  if (el.id === 'conflictLoad' && n) return resolveConflict(n, false);
  if (el.id === 'conflictKeep' && n) return resolveConflict(n, true);
  if (el.id === 'themeBtn') return toggleTheme();
  if (el.id === 'sideBtn') return toggleSideMini();
});

document.addEventListener('input', e => {
  if (e.target.id === 'q'){
    ui.query = e.target.value; ui.searchIds = null;
    renderList(); runSearch(); return;
  }
  if (e.target.id === 'src'){
    const n = cur(); if (!n) return;
    setBody(n, e.target.value); autoGrow(e.target); revealCaret(e.target);
    renderSide(); renderList(); schedulePreview(); syncToolbar(e.target);
    const text = e.target.value, w = words(text);
    $('wc').textContent = w + ' kata'; $('cc').textContent = text.length + ' karakter';
    $('rt').textContent = Math.max(1, Math.round(w/200)) + ' menit baca'; $('mod').textContent = 'Diubah ' + longDate(n.updated);
  }
});

// Toolbar: klik tombol tidak mengambil fokus dari textarea (seleksi & kursor tetap).
document.addEventListener('mousedown', e => { if (e.target.closest('.fmt button')) e.preventDefault(); });
document.addEventListener('change', e => {
  const ta = $('src'); if (!ta) return;
  if (e.target.id === 'fmtStyle') applyFormat(ta, 'heading', e.target.value);
  if (e.target.id === 'fmtLang' && e.target.value) applyFormat(ta, 'codeblock', e.target.value);
  syncToolbar(ta);
});
// Lebar berubah -> baris terbungkus ulang -> tinggi textarea dihitung lagi.
window.addEventListener('resize', () => { const ta = $('src'); if (ta) autoGrow(ta); });
document.addEventListener('selectionchange', () => {
  const ta = $('src'); if (ta && document.activeElement === ta) syncToolbar(ta);
});
// Mode Belah: pratinjau mengikuti posisi gulir editor.
document.addEventListener('scroll', e => {
  if (e.target.id !== 'paneSrc') return;
  const src = e.target, prev = $('panePreview'); if (!prev) return;
  const ratio = src.scrollTop / Math.max(1, src.scrollHeight - src.clientHeight);
  prev.scrollTop = ratio * (prev.scrollHeight - prev.clientHeight);
}, true);

document.addEventListener('submit', async e => {
  if (e.target.id !== 'unlockForm') return;
  e.preventDefault();
  const pw = $('pw'), errEl = $('pwErr');
  try {
    const { token } = await api('POST', '/api/lock/unlock', { password: pw.value });
    await startSession(token, 'Catatan terkunci dibuka');
  } catch (err) {
    if (!errEl) return;
    errEl.textContent = err.status === 401 ? 'Kata sandi salah. Coba lagi.' : err.message;
    pw.select();
  }
});

document.addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey, typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
  if (mod && e.code === 'KeyL' && (e.shiftKey || e.altKey)){
    e.preventDefault();
    if (e.altKey) return lockToken ? endSession('Semua catatan terkunci ditutup') : toast('Tidak ada catatan terkunci yang terbuka');
    const n = cur(); if (!n || n.trashed) return;
    if (!n.locked) return lockNote(n);
    if (lockToken) return endSession('Catatan terkunci ditutup');
    return $('pw')?.focus();
  }
  if (mod && e.key.toLowerCase() === 's'){ e.preventDefault(); if (ui.selected) flush(ui.selected); return; }
  if (mod && e.key.toLowerCase() === 'e'){
    e.preventDefault(); const n = cur(); if (!n || n.trashed || (!isOpen(n))) return;
    ui.mode = ui.mode === 'read' ? 'write' : 'read'; if (ui.mode !== 'read') setFullscreen(false); renderEditor(); if (ui.mode === 'write') $('src')?.focus(); return;
  }
  if (document.activeElement.id === 'src' && handleEditorKeydown(e, document.activeElement)){ e.preventDefault(); return; }
  // ⌘B di luar editor: ciutkan/lebarkan sidebar (di editor, ⌘B = tebal dan sudah ditangani di atas).
  if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b'){ e.preventDefault(); return toggleSideMini(); }
  if (!typing && !mod && e.key.toLowerCase() === 'n'){ e.preventDefault(); newNote(); }
  if (!typing && !mod && e.key === '/'){ e.preventDefault(); $('q')?.focus(); }
  if (!typing && !mod && !e.altKey && e.key.toLowerCase() === 'f'){ e.preventDefault(); toggleFullscreen(); }
  if (e.key === 'Escape' && ui.fullscreen && !typing){ e.preventDefault(); setFullscreen(false); }
});

// Jangan sampai ketikan terakhir hilang saat tab ditutup.
window.addEventListener('beforeunload', e => {
  if (![...saves.keys()].some(busy)) return;
  flushAll({ keepalive: true });
  e.preventDefault();
});

renderAll();
refreshLockInfo().then(() => renderEditor());
reloadAll();
connectEvents();
