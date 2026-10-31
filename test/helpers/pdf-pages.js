// Pembaca PDF minimal khusus untuk tes: mengembalikan content stream (sudah di-inflate) per halaman,
// sesuai urutan /Kids. Cukup untuk PDF yang dihasilkan Chrome; bukan parser PDF umum.
import zlib from 'node:zlib';

export function pageContents(buf) {
  const s = buf.toString('latin1');
  const objStart = id => {
    const m = new RegExp(`(?:^|\\n)${id} 0 obj\\s*`).exec(s);
    if (!m) throw new Error(`objek ${id} tidak ada`);
    return m.index + m[0].length;
  };
  const kids = s.match(/\/Type \/Pages[\s\S]*?\/Kids \[([^\]]*)\]/)[1].match(/\d+(?= 0 R)/g);
  return kids.map(pageId => {
    const at = objStart(pageId);
    const contentsId = s.slice(at, s.indexOf('endobj', at)).match(/\/Contents (\d+) 0 R/)[1];
    const cAt = objStart(contentsId);
    const head = s.slice(cAt, s.indexOf('stream', cAt));
    const len = Number(head.match(/\/Length (\d+)/)[1]);
    let dataAt = s.indexOf('stream', cAt) + 'stream'.length;
    if (s[dataAt] === '\r') dataAt++;
    if (s[dataAt] === '\n') dataAt++;
    const raw = buf.subarray(dataAt, dataAt + len);
    return (/FlateDecode/.test(head) ? zlib.inflateSync(raw) : raw).toString('latin1');
  });
}

/** Warna isian (operator rg) yang dipakai di setiap halaman, dibulatkan 3 desimal. */
export function fillColorsPerPage(buf) {
  return pageContents(buf).map(c => new Set(
    [...c.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) rg/g)].map(m => m.slice(1, 4).map(v => (+v).toFixed(3)).join(' ')),
  ));
}
