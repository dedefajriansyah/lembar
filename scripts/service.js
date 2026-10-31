// Memasang Lembar sebagai LaunchAgent macOS: server menyala otomatis saat login dan
// dinyalakan ulang oleh macOS kalau crash.
//
//   npm run service:install     pasang / perbarui (juga untuk restart setelah kode berubah)
//   npm run service:uninstall   cabut
//   npm run service:status      cek
//
// NOTES_DIR, PORT, dan CHROME_PATH yang sedang di-set saat install ikut disimpan ke layanan.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const LABEL = 'com.lembar.server';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const LOGS = path.join(os.homedir(), 'Library', 'Logs', 'Lembar');
const DOMAIN = `gui/${process.getuid()}`;
const PORT = Number(process.env.PORT) || 3210;

const xml = s => String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
const launchctl = (...args) => execFileSync('launchctl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const tryLaunchctl = (...args) => { try { return launchctl(...args); } catch { return null; } };

async function serverUp(timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/notes`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return true;
    } catch { /* belum siap */ }
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

async function install() {
  if (process.platform !== 'darwin') throw new Error('LaunchAgent hanya untuk macOS.');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) {
    throw new Error(`Node ${process.versions.node} terlalu lama (butuh >= 22.12). Jalankan "nvm use" dulu.`);
  }
  // Path absolut: layanan latar belakang tidak memakai PATH/nvm dari shell.
  const node = process.execPath;
  const env = Object.fromEntries(['NOTES_DIR', 'PORT', 'CHROME_PATH'].filter(k => process.env[k]).map(k => [k, process.env[k]]));

  await fs.mkdir(path.dirname(PLIST), { recursive: true });
  await fs.mkdir(LOGS, { recursive: true });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(node)}</string>
    <string>${xml(path.join(ROOT, 'server.js'))}</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(ROOT)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(env).map(([k, v]) => `    <key>${k}</key><string>${xml(v)}</string>`).join('\n')}
  </dict>
  <key>RunAtLoad</key><true/>
  <!-- Nyalakan ulang hanya kalau berhenti tidak wajar (crash); berhenti normal dibiarkan. -->
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xml(path.join(LOGS, 'server.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(LOGS, 'error.log'))}</string>
</dict>
</plist>
`;
  await fs.writeFile(PLIST, plist);
  execFileSync('plutil', ['-lint', PLIST], { stdio: 'ignore' });

  tryLaunchctl('bootout', `${DOMAIN}/${LABEL}`);   // versi lama (kalau ada) dihentikan dulu
  await new Promise(r => setTimeout(r, 500));
  launchctl('bootstrap', DOMAIN, PLIST);
  tryLaunchctl('enable', `${DOMAIN}/${LABEL}`);

  console.log(`Layanan dipasang: ${PLIST}`);
  console.log(`Node: ${node}`);
  if (Object.keys(env).length) console.log(`Variabel: ${Object.keys(env).join(', ')}`);
  if (await serverUp(10_000)) {
    console.log(`Lembar berjalan di http://127.0.0.1:${PORT}`);
  } else {
    console.error(`Server belum merespons di port ${PORT}. Cek log: ${path.join(LOGS, 'error.log')}`);
    process.exitCode = 1;
  }
}

async function uninstall() {
  const out = tryLaunchctl('bootout', `${DOMAIN}/${LABEL}`);
  await fs.rm(PLIST, { force: true });
  console.log(out === null ? 'Layanan tidak sedang berjalan.' : 'Layanan dihentikan.');
  console.log(`Plist dihapus. Log tetap ada di ${LOGS}`);
}

async function status() {
  const info = tryLaunchctl('print', `${DOMAIN}/${LABEL}`);
  if (!info) {
    console.log('Layanan tidak terpasang. Pasang dengan: npm run service:install');
    return;
  }
  const field = name => info.match(new RegExp(`^\\s*${name} = (.+)$`, 'm'))?.[1] ?? '-';
  console.log(`Status   : ${field('state')}`);
  console.log(`PID      : ${field('pid')}`);
  console.log(`Exit akhir: ${field('last exit code')}`);
  console.log(`Program  : ${field('program')}`);
  console.log(`HTTP     : ${(await serverUp(1500)) ? `OK (http://127.0.0.1:${PORT})` : 'tidak merespons'}`);
  console.log(`Log      : ${LOGS}`);
}

const cmd = process.argv[2];
const run = { install, uninstall, status }[cmd];
if (!run) {
  console.error('Pakai: node scripts/service.js install|uninstall|status');
  process.exit(2);
}
run().catch(err => { console.error(err.message); process.exit(1); });
