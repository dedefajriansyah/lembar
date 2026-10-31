// Renderer Markdown bersama: modul yang sama dipakai browser dan server (ekspor PDF),
// supaya hasil render identik. markdown-it disuntikkan dari luar karena cara memuatnya
// berbeda: server `import MarkdownIt from 'markdown-it'`, browser memuat build ESM dari /vendor/.
//
// Keamanan: HTML mentah di catatan dimatikan (html: false) sehingga selalu di-escape,
// tautan hanya boleh http/https/mailto, dan semua plugin di bawah meng-escape output-nya.
// Jadi tidak ada jalan bagi isi catatan untuk menyisipkan tag atau atribut sendiri.

import { highlightCode, languageLabel } from './highlight.js';

const SAFE_LINK_RE = /^(?:https?:|mailto:)/i;
const TAG_AT_RE = /#([\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*)/uy;
const WIKILINK_AT_RE = /\[\[([^[\]\n]+?)\]\]/y;
const TASK_RE = /^\[([ xX])\][ \t]/;

/**
 * @param {object} [opts]
 * @param {boolean} [opts.internalLinks=true] false: #tag dan [[wikilink]] jadi <span> biasa
 *   (untuk PDF, di mana tautan internal tidak menuju ke mana pun).
 */
export function createRenderer(MarkdownIt, { internalLinks = true } = {}) {
  const md = new MarkdownIt({ html: false, linkify: true, breaks: true, typographer: false });
  const esc = md.utils.escapeHtml;

  md.validateLink = url => SAFE_LINK_RE.test(url.trim());

  // Tautan luar dibuka di tab baru.
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const t = tokens[idx];
    if (/^https?:/i.test(t.attrGet('href') ?? '')) {
      t.attrSet('target', '_blank');
      t.attrSet('rel', 'noopener noreferrer');
    }
    return self.renderToken(tokens, idx, options);
  };

  md.use(codeBlocks, esc);
  md.use(taskLists);
  md.use(tags, esc, internalLinks);
  md.use(wikilinks, esc, internalLinks);
  md.use(highlight);

  return {
    md,
    /** Render isi catatan (tanpa frontmatter) menjadi HTML yang aman. */
    render: src => md.render(src),
  };
}

/* ===== Blok kode =====
 * <pre class="code"><span class="code-lang">PHP</span><code class="hljs language-php">
 *   <span class="line">…\n</span><span class="line">…</span></code></pre>
 * Tiap baris dibungkus .line supaya PDF bisa memotong halaman di antara baris (bukan di tengah),
 * dan span highlight yang melintasi baris (mis. komentar multi-baris) ditutup/dibuka ulang per baris. */
function codeBlocks(md, esc) {
  const block = (code, lang) => {
    const safeLang = lang.replace(/[^\w+#.-]/g, '').slice(0, 30);
    const label = languageLabel(safeLang);
    const html = highlightCode(code, safeLang) ?? esc(code);
    return `<pre class="code">${label ? `<span class="code-lang">${esc(label)}</span>` : ''}`
      + `<code class="hljs${safeLang ? ` language-${safeLang}` : ''}">${splitLines(html)}</code></pre>\n`;
  };
  md.renderer.rules.fence = (tokens, idx) => {
    const t = tokens[idx];
    return block(t.content, t.info.trim().split(/\s+/)[0] ?? '');
  };
  md.renderer.rules.code_block = (tokens, idx) => block(tokens[idx].content, '');
}

/** Pecah HTML ber-highlight jadi <span class="line"> per baris dengan span yang tetap seimbang. */
export function splitLines(html) {
  const lines = [];
  const open = [];
  let cur = '';
  for (const part of html.replace(/\n$/, '').split(/(<span[^>]*>|<\/span>|\n)/)) {
    if (!part) continue;
    if (part === '\n') {
      lines.push(cur + '</span>'.repeat(open.length) + '\n');
      cur = open.join('');
    } else {
      if (part.startsWith('<span')) open.push(part);
      else if (part === '</span>') open.pop();
      cur += part;
    }
  }
  lines.push(cur);
  return lines.map(l => `<span class="line">${l}</span>`).join('');
}

/* ===== - [ ] task list =====
 * <li class="task [done]"><input type="checkbox" data-line="N">…</li>
 * data-line = nomor baris (mulai 0) item tersebut di sumber, dipakai untuk mencentang. */
function taskLists(md) {
  md.core.ruler.after('inline', 'task_lists', state => {
    const tokens = state.tokens;
    for (let i = 2; i < tokens.length; i++) {
      const inline = tokens[i];
      if (inline.type !== 'inline' || tokens[i - 1].type !== 'paragraph_open' || tokens[i - 2].type !== 'list_item_open') continue;
      const m = inline.content.match(TASK_RE);
      if (!m) continue;
      const first = inline.children[0];
      if (!first || first.type !== 'text' || !TASK_RE.test(first.content)) continue;

      const done = m[1] !== ' ';
      const li = tokens[i - 2];
      li.attrJoin('class', done ? 'task done' : 'task');
      first.content = first.content.replace(TASK_RE, '');

      const box = new state.Token('task_checkbox', 'input', 0);
      box.meta = { done, line: li.map ? li.map[0] : -1 };
      inline.children.unshift(box);

      // Tandai <ul>/<ol> induknya.
      for (let j = i - 3; j >= 0; j--) {
        const t = tokens[j];
        if (t.level === li.level - 1 && (t.type === 'bullet_list_open' || t.type === 'ordered_list_open')) {
          if (!(t.attrGet('class') ?? '').includes('todo')) t.attrJoin('class', 'todo');
          break;
        }
      }
    }
  });
  md.renderer.rules.task_checkbox = (tokens, idx) => {
    const { done, line } = tokens[idx].meta;
    return `<input type="checkbox" data-line="${line}"${done ? ' checked' : ''} aria-label="Tandai selesai">`;
  };
}

/* ===== #tag dan #tag/subtag =====
 * Aturannya sama dengan tagsOf() di lib/text.js: harus diawali awal teks atau spasi.
 * Blok kode dan inline code tidak pernah sampai ke aturan ini. */
function tags(md, esc, asLink) {
  md.inline.ruler.before('emphasis', 'hashtag', (state, silent) => {
    const pos = state.pos;
    if (state.src.charCodeAt(pos) !== 0x23 /* # */) return false;
    if (pos > 0 && !/\s/u.test(state.src[pos - 1])) return false;
    TAG_AT_RE.lastIndex = pos;
    const m = TAG_AT_RE.exec(state.src);
    if (!m) return false;
    if (!silent) {
      const t = state.push('hashtag', 'a', 0);
      t.content = m[1];
      t.markup = '#';
    }
    state.pos += m[0].length;
    return true;
  });
  md.renderer.rules.hashtag = (tokens, idx) => {
    const tag = tokens[idx].content;
    return asLink
      ? `<a href="#" class="tag" data-tag="${esc(tag.toLowerCase())}">#${esc(tag)}</a>`
      : `<span class="tag">#${esc(tag)}</span>`;
  };
}

/* ===== [[Judul catatan]] ===== */
function wikilinks(md, esc, asLink) {
  md.inline.ruler.before('link', 'wikilink', (state, silent) => {
    const pos = state.pos;
    if (state.src.charCodeAt(pos) !== 0x5B /* [ */ || state.src.charCodeAt(pos + 1) !== 0x5B) return false;
    WIKILINK_AT_RE.lastIndex = pos;
    const m = WIKILINK_AT_RE.exec(state.src);
    if (!m || !m[1].trim()) return false;
    if (!silent) {
      const t = state.push('wikilink', 'a', 0);
      t.content = m[1].trim();
    }
    state.pos += m[0].length;
    return true;
  });
  md.renderer.rules.wikilink = (tokens, idx) => {
    const title = tokens[idx].content;
    return asLink
      ? `<a href="#" class="wikilink" data-link="${esc(title)}">${esc(title)}</a>`
      : `<span class="wikilink">${esc(title)}</span>`;
  };
}

/* ===== ==highlight== → <mark> =====
 * Berbasis delimiter seperti ~~coret~~ bawaan markdown-it, jadi bisa berisi format lain
 * (mis. ==**penting**==). Diadaptasi dari markdown-it-mark (MIT). */
function highlight(md) {
  const EQ = 0x3D;

  md.inline.ruler.before('emphasis', 'mark', (state, silent) => {
    if (silent || state.src.charCodeAt(state.pos) !== EQ) return false;
    const scanned = state.scanDelims(state.pos, true);
    let len = scanned.length;
    if (len < 2) return false;
    if (len % 2) {
      state.push('text', '', 0).content = '=';
      len--;
    }
    for (let i = 0; i < len; i += 2) {
      state.push('text', '', 0).content = '==';
      if (!scanned.can_open && !scanned.can_close) continue;
      state.delimiters.push({
        marker: EQ, length: 0, token: state.tokens.length - 1,
        end: -1, open: scanned.can_open, close: scanned.can_close,
      });
    }
    state.pos += scanned.length;
    return true;
  });

  function postProcess(state, delimiters) {
    const lone = [];
    for (const start of delimiters) {
      if (start.marker !== EQ || start.end === -1) continue;
      const end = delimiters[start.end];
      Object.assign(state.tokens[start.token], { type: 'mark_open', tag: 'mark', nesting: 1, markup: '==', content: '' });
      Object.assign(state.tokens[end.token], { type: 'mark_close', tag: 'mark', nesting: -1, markup: '==', content: '' });
      const prev = state.tokens[end.token - 1];
      if (prev.type === 'text' && prev.content === '=') lone.push(end.token - 1);
    }
    // Tanda "=" sisa dipindah ke luar penutup, sama seperti strikethrough bawaan.
    while (lone.length) {
      const i = lone.pop();
      let j = i + 1;
      while (j < state.tokens.length && state.tokens[j].type === 'mark_close') j++;
      j--;
      if (i !== j) [state.tokens[i], state.tokens[j]] = [state.tokens[j], state.tokens[i]];
    }
  }

  md.inline.ruler2.before('emphasis', 'mark', state => {
    postProcess(state, state.delimiters);
    for (const meta of state.tokens_meta) if (meta?.delimiters) postProcess(state, meta.delimiters);
  });
}
