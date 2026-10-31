// Syntax highlighting untuk blok kode, dipakai renderer di browser dan server (PDF).
// Path impor yang sama berjalan di keduanya: Node membacanya dari node_modules, browser lewat
// import map di public/index.html yang mengarah ke /vendor/hljs/.
import hljs from '@highlightjs/cdn-assets/es/core.min.js';
import bash from '@highlightjs/cdn-assets/es/languages/bash.min.js';
import css from '@highlightjs/cdn-assets/es/languages/css.min.js';
import diff from '@highlightjs/cdn-assets/es/languages/diff.min.js';
import dockerfile from '@highlightjs/cdn-assets/es/languages/dockerfile.min.js';
import go from '@highlightjs/cdn-assets/es/languages/go.min.js';
import ini from '@highlightjs/cdn-assets/es/languages/ini.min.js';
import java from '@highlightjs/cdn-assets/es/languages/java.min.js';
import javascript from '@highlightjs/cdn-assets/es/languages/javascript.min.js';
import json from '@highlightjs/cdn-assets/es/languages/json.min.js';
import kotlin from '@highlightjs/cdn-assets/es/languages/kotlin.min.js';
import markdown from '@highlightjs/cdn-assets/es/languages/markdown.min.js';
import nginx from '@highlightjs/cdn-assets/es/languages/nginx.min.js';
import php from '@highlightjs/cdn-assets/es/languages/php.min.js';
import plaintext from '@highlightjs/cdn-assets/es/languages/plaintext.min.js';
import python from '@highlightjs/cdn-assets/es/languages/python.min.js';
import shell from '@highlightjs/cdn-assets/es/languages/shell.min.js';
import sql from '@highlightjs/cdn-assets/es/languages/sql.min.js';
import typescript from '@highlightjs/cdn-assets/es/languages/typescript.min.js';
import xml from '@highlightjs/cdn-assets/es/languages/xml.min.js';
import yaml from '@highlightjs/cdn-assets/es/languages/yaml.min.js';

for (const [name, grammar] of Object.entries({
  bash, css, diff, dockerfile, go, ini, java, javascript, json, kotlin, markdown,
  nginx, php, plaintext, python, shell, sql, typescript, xml, yaml,
})) hljs.registerLanguage(name, grammar);

/** Pilihan bahasa di toolbar editor: id = yang ditulis setelah ``` */
export const LANGUAGES = [
  { id: 'php', label: 'PHP' },
  { id: 'js', label: 'JavaScript' },
  { id: 'ts', label: 'TypeScript' },
  { id: 'html', label: 'HTML' },
  { id: 'css', label: 'CSS' },
  { id: 'json', label: 'JSON' },
  { id: 'sql', label: 'SQL' },
  { id: 'bash', label: 'Bash' },
  { id: 'yaml', label: 'YAML' },
  { id: 'nginx', label: 'Nginx' },
  { id: 'python', label: 'Python' },
  { id: 'java', label: 'Java' },
  { id: 'go', label: 'Go' },
  { id: 'kotlin', label: 'Kotlin' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'diff', label: 'Diff' },
  { id: 'dockerfile', label: 'Dockerfile' },
  { id: 'ini', label: 'INI' },
  { id: 'text', label: 'Teks biasa' },
];

// Label untuk nama resmi grammar (alias seperti js/ts/sh/yml/html ikut terpetakan).
const LABEL_BY_GRAMMAR = {
  bash: 'Bash', css: 'CSS', diff: 'Diff', dockerfile: 'Dockerfile', go: 'Go', ini: 'INI', java: 'Java',
  javascript: 'JavaScript', json: 'JSON', kotlin: 'Kotlin', markdown: 'Markdown', nginx: 'Nginx',
  php: 'PHP', plaintext: 'Teks', python: 'Python', shell: 'Shell', sql: 'SQL', typescript: 'TypeScript',
  xml: 'XML', yaml: 'YAML',
};
const LABEL_BY_ID = Object.fromEntries(LANGUAGES.map(l => [l.id, l.label]));

function grammarName(lang) {
  const g = lang && hljs.getLanguage(lang);
  return g ? Object.keys(LABEL_BY_GRAMMAR).find(k => hljs.getLanguage(k) === g) ?? null : null;
}

/** Label untuk ditampilkan, mis. "js" -> "JavaScript". Bahasa tak dikenal: apa adanya. */
export function languageLabel(lang) {
  const key = String(lang || '').toLowerCase();
  if (!key) return '';
  return LABEL_BY_ID[key] ?? LABEL_BY_GRAMMAR[grammarName(key)] ?? lang;
}

/**
 * HTML ber-highlight (sudah di-escape oleh highlight.js), atau null kalau bahasa tak dikenal.
 * Output hanya berisi teks ter-escape dan <span class="hljs-…">.
 */
export function highlightCode(code, lang) {
  const key = String(lang || '').toLowerCase();
  if (!key || key === 'text' || !hljs.getLanguage(key)) return null;
  return hljs.highlight(code, { language: key, ignoreIllegals: true }).value;
}
