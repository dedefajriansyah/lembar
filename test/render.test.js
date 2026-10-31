import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import { createRenderer } from '../lib/render.js';
import { tagsOf } from '../lib/text.js';
import { WELCOME } from '../lib/welcome.js';

const { render } = createRenderer(MarkdownIt);
const has = (html, frag) => assert.ok(html.includes(frag), `tidak ada ${frag} di:\n${html}`);
const lacks = (html, frag) => assert.ok(!html.includes(frag), `seharusnya tidak ada ${frag} di:\n${html}`);

describe('opsi dasar', () => {
  test('satu baris baru = <br> (breaks)', () => {
    assert.equal(render('baris satu\nbaris dua'), '<p>baris satu<br>\nbaris dua</p>\n');
  });
  test('URL lengkap jadi tautan, buka di tab baru', () => {
    has(render('lihat https://contoh.com/a?b=1'), '<a href="https://contoh.com/a?b=1" target="_blank" rel="noopener noreferrer">');
  });
  test('typographer mati: tanda kutip dan -- tidak diubah', () => {
    has(render('"halo" -- dunia'), '&quot;halo&quot; -- dunia');
  });
  test('~~coret~~, **tebal**, *miring*, `kode`, tabel', () => {
    const h = render('~~a~~ **b** *c* `d`\n\n| x | y |\n|---|---|\n| 1 | 2 |');
    for (const f of ['<s>a</s>', '<strong>b</strong>', '<em>c</em>', '<code>d</code>', '<table>']) has(h, f);
  });
});

describe('task list', () => {
  test('checkbox dengan data-line sesuai baris sumber', () => {
    const src = '# Judul\n\n- [x] selesai\n- [ ] belum\n  - [ ] anak';
    const h = render(src);
    has(h, '<ul class="todo">');
    has(h, '<li class="task done"><input type="checkbox" data-line="2" checked aria-label="Tandai selesai">selesai');
    has(h, '<li class="task"><input type="checkbox" data-line="3" aria-label="Tandai selesai">belum');
    has(h, 'data-line="4"');
    const lines = src.split('\n');
    for (const [, n] of h.matchAll(/data-line="(\d+)"/g)) assert.match(lines[n], /\[[ x]\]/);
  });
  test('daftar biasa tetap daftar biasa; [ ] di tengah teks bukan checkbox', () => {
    const h = render('- satu\n- dua [ ] tiga');
    lacks(h, 'checkbox');
    lacks(h, 'todo');
  });
  test('isi task tetap diproses inline', () => {
    has(render('- [ ] beli **kopi** #rumah'), '<strong>kopi</strong> <a href="#" class="tag" data-tag="rumah">#rumah</a>');
  });
  test('task di daftar bernomor dan di dalam kutipan', () => {
    has(render('1. [x] a'), '<ol class="todo">');
    has(render('> - [ ] b'), 'data-line="0"');
  });
});

describe('#tag', () => {
  test('tag bertingkat jadi tautan; data-tag huruf kecil', () => {
    has(render('ada #Kerja/Rapat di sini'), '<a href="#" class="tag" data-tag="kerja/rapat">#Kerja/Rapat</a>');
  });
  test('bukan tag: judul, url#anchor, kode, escape, tanpa spasi di depan', () => {
    const h = render('# Judul\n\nx#bukan http://a.com/#anchor `#kode` \\#escape\n\n```\n#fence\n```\n\n~~~\n#tilde\n~~~');
    lacks(h, 'class="tag"');
  });
  test('tag di renderer sama dengan tagsOf() untuk contoh nyata', () => {
    const samples = [
      WELCOME,
      '#awal baris dan #akhir\n- [ ] #todo/tag\n> kutip #kutip',
      'Inline `#bukan` tapi #ya.\n\n```js\n#bukan\n```\n#lagi',
      '## Rapat #kerja/rapat\n\n| kolom #tabel |\n|---|\n| x |',
    ];
    for (const src of samples) {
      const rendered = [...render(src).matchAll(/data-tag="([^"]+)"/g)].map(m => m[1]);
      assert.deepEqual([...new Set(rendered)].sort(), tagsOf(src).sort(), src);
    }
  });
});

describe('[[wikilink]] dan ==highlight==', () => {
  test('wikilink', () => {
    has(render('lihat [[Ide fitur]].'), '<a href="#" class="wikilink" data-link="Ide fitur">Ide fitur</a>.');
    lacks(render('[[]] [[ ]]'), 'wikilink');
    has(render('`[[bukan]]`'), '<code>[[bukan]]</code>');
  });
  test('highlight, termasuk berisi format lain', () => {
    has(render('ini ==penting== ya'), 'ini <mark>penting</mark> ya');
    has(render('==**sangat** penting=='), '<mark><strong>sangat</strong> penting</mark>');
    lacks(render('a == b dan c = d'), '<mark>');
    has(render('`==kode==`'), '<code>==kode==</code>');
  });
});

describe('XSS', () => {
  const payloads = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<a href="javascript:alert(1)">x</a>',
    '[klik](javascript:alert(1))',
    '[klik](JaVaScRiPt:alert(1))',
    '[klik](  javascript:alert(1))',
    '[klik](vbscript:msgbox(1))',
    '[klik](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
    '![x](javascript:alert(1))',
    '![x](data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+)',
    '[x](file:///etc/passwd)',
    '<javascript:alert(1)>',
    '[[" onmouseover="alert(1)]]',
    '[[<img src=x onerror=alert(1)>]]',
    '#tag"onmouseover="alert(1)',
    '#<script>',
    '==<script>alert(1)</script>==',
    '- [ ] <img src=x onerror=alert(1)>',
    '```"><script>alert(1)</script>\nx\n```',
    '<style>body{display:none}</style>',
    '<iframe src="https://evil.example"></iframe>',
    '[x](https://ok.example "judul\\" onmouseover=\\"alert(1)")',
  ];

  // Periksa tag HTML yang benar-benar dihasilkan (bukan teks yang sudah di-escape).
  const ALLOWED_TAGS = new Set(['p', 'br', 'a', 'code', 'pre', 'mark', 'ul', 'ol', 'li', 'input', 'blockquote', 'strong', 'em', 's', 'span']);
  const ALLOWED_ATTRS = new Set(['href', 'class', 'data-tag', 'data-link', 'data-line', 'type', 'checked', 'aria-label', 'target', 'rel', 'title']);

  test('hanya tag & atribut yang diizinkan; tidak ada skema berbahaya', () => {
    for (const p of payloads) {
      const h = render(p);
      const ctx = `${p}\n→ ${h}`;
      for (const [, name, attrs] of h.matchAll(/<\/?([a-zA-Z][\w-]*)([^>]*)>/g)) {
        assert.ok(ALLOWED_TAGS.has(name.toLowerCase()), `tag <${name}>: ${ctx}`);
        for (const [, attr, val = ''] of attrs.matchAll(/\s([^\s=]+)(?:="([^"]*)")?/g)) {
          assert.ok(ALLOWED_ATTRS.has(attr.toLowerCase()), `atribut ${attr}: ${ctx}`);
          if (attr === 'href') assert.match(val, /^(https?:|mailto:|#$)/i, ctx);
        }
      }
    }
  });

  test('gambar http(s) tetap boleh, tautan mailto boleh', () => {
    has(render('![foto](https://contoh.com/a.png)'), '<img src="https://contoh.com/a.png" alt="foto">');
    has(render('[surel](mailto:a@b.c)'), '<a href="mailto:a@b.c">surel</a>');
  });
});

describe('hasOpenTodo selaras dengan renderer', async () => {
  const { hasOpenTodo } = await import('../lib/text.js');
  test('todo terbuka dikenali di mana pun renderer membuat checkbox', () => {
    for (const src of ['- [ ] a', '* [ ] a', '1. [ ] a', '> - [ ] a', '- [x] a\n  - [ ] anak']) {
      assert.equal(hasOpenTodo(src), true, src);
      assert.match(render(src), /<input type="checkbox" data-line="\d+" aria-label/, src);
    }
    for (const src of ['- [x] a', '```\n- [ ] a\n```', 'teks [ ] biasa', '- satu [ ] dua']) {
      assert.equal(hasOpenTodo(src), false, src);
    }
  });
});

describe('internalLinks: false (untuk PDF)', () => {
  const { render: renderPrint } = createRenderer(MarkdownIt, { internalLinks: false });
  test('tag dan wikilink jadi span, tautan https tetap tautan', () => {
    const h = renderPrint('#kerja/rapat [[Ide fitur]] https://contoh.com');
    has(h, '<span class="tag">#kerja/rapat</span>');
    has(h, '<span class="wikilink">Ide fitur</span>');
    has(h, '<a href="https://contoh.com"');
    lacks(h, 'href="#"');
  });
  test('tetap ter-escape', () => {
    lacks(renderPrint('[[<img src=x onerror=alert(1)>]]'), '<img');
  });
});

describe('blok kode & syntax highlighting', async () => {
  const { splitLines } = await import('../lib/render.js');
  const { highlightCode, languageLabel, LANGUAGES } = await import('../lib/highlight.js');

  test('bahasa yang dipilih ter-highlight, alias dikenali, label sesuai', () => {
    const cases = { php: 'PHP', js: 'JavaScript', ts: 'TypeScript', html: 'HTML', css: 'CSS', json: 'JSON',
      sql: 'SQL', bash: 'Bash', sh: 'Bash', yaml: 'YAML', yml: 'YAML', nginx: 'Nginx', python: 'Python', py: 'Python',
      java: 'Java', go: 'Go', kotlin: 'Kotlin', markdown: 'Markdown', diff: 'Diff', dockerfile: 'Dockerfile', ini: 'INI' };
    for (const [lang, label] of Object.entries(cases)) {
      assert.equal(languageLabel(lang), label, lang);
      assert.notEqual(highlightCode('x = 1 // a', lang), null, lang);
    }
    for (const l of LANGUAGES) assert.ok(l.id === 'text' || highlightCode('x', l.id) !== null, l.id);
  });

  test('render: label, kelas bahasa, dan span hljs', () => {
    const h = render('```php\n<?php echo "hai"; // komentar\n```');
    has(h, '<pre class="code"><span class="code-lang">PHP</span><code class="hljs language-php">');
    has(h, '<span class="hljs-keyword">echo</span>');
    has(h, '<span class="hljs-comment">// komentar</span>');
  });

  test('bahasa tak dikenal / tanpa bahasa: teks ter-escape tanpa warna', () => {
    has(render('```rust\nfn <x>\n```'), '<span class="code-lang">rust</span><code class="hljs language-rust"><span class="line">fn &lt;x&gt;</span>');
    has(render('```\na <b>\n```'), '<pre class="code"><code class="hljs"><span class="line">a &lt;b&gt;</span>');
    has(render('```text\nif x\n```'), '<span class="code-lang">Teks biasa</span>');
    lacks(render('```text\nif x\n```'), 'hljs-');
  });

  test('satu .line per baris sumber; teks utuh; span tetap seimbang di tiap baris', () => {
    const code = '/* satu\ndua */\n\n$x = "a\nb";';
    const h = render('```php\n' + code + '\n```');
    const lines = [...h.matchAll(/<span class="line">([\s\S]*?\n?)<\/span>(?=<span class="line">|<\/code>)/g)].map(m => m[1]);
    assert.equal(lines.length, code.split('\n').length);
    const text = lines.join('').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"');
    assert.equal(text, code);
    for (const l of lines) {
      assert.equal((l.match(/<span/g) || []).length, (l.match(/<\/span>/g) || []).length, l);
    }
  });

  test('splitLines menutup & membuka ulang span lintas baris', () => {
    assert.equal(splitLines('<span class="a">x\ny</span>\nz'),
      '<span class="line"><span class="a">x</span>\n</span><span class="line"><span class="a">y</span>\n</span><span class="line">z</span>');
  });

  test('info string berbahaya tidak lolos ke atribut', () => {
    const h = render('```" onmouseover="alert(1)\nx\n```');
    lacks(h, 'onmouseover="');
    lacks(h, '" onmouseover');
  });

  test('tag di dalam blok kode ber-highlight tetap bukan tag', () => {
    lacks(render('```bash\n# komentar #bukan-tag\n```'), 'class="tag"');
  });
});

describe('safeFilename', async () => {
  const { safeFilename } = await import('../lib/text.js');
  test('karakter terlarang diganti, spasi dirapikan, judul kosong -> catatan', () => {
    assert.equal(safeFilename('Rapat: 5/10 "final"?', 'md'), 'Rapat- 5-10 -final--.md');
    assert.equal(safeFilename('  a \n  b ', 'md'), 'a b.md');
    assert.equal(safeFilename('', 'pdf'), 'catatan.pdf');
    assert.equal(safeFilename('../../etc/passwd', 'md'), '..-..-etc-passwd.md');
  });
});
