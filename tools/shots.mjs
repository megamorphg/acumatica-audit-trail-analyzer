// Rebuilds the Chrome Web Store screenshots in icons/images/screenshots/.
//
// The store wants 1280x800 PNGs without an alpha channel; headless Chrome
// writes exactly that, so no image library is needed and the repo stays
// dependency-free, same as tools/make-icons.mjs and tools/package.mjs.
//
// Shots come from test/shot.html, which drives the real panel against a
// fixture into one fixed state, so a re-run reproduces the same frames.
//
//   node tools/shots.mjs
//
// Nothing here invents UI: the only dressing is the settings page, which
// Chrome shows as a modal dialog (options_ui.open_in_tab is false) and which
// needs a chrome.storage stub to load its own defaults outside the extension.

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'icons/images/screenshots');
const PORT = 8123;
const base = `http://localhost:${PORT}`;

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const chrome = CHROMES.find(p => p && existsSync(p));
if (!chrome) {
  console.error('No Chrome found. Edit CHROMES in tools/shots.mjs.');
  process.exit(1);
}

const SHOTS = [
  ['01-timeline.png',      '/test/shot.html?shot=panel'],
  ['02-dense-history.png', '/test/shot.html?shot=panel&fixture=fs-service-order'],
  ['03-filter.png',        '/test/shot.html?shot=filter&q=tax'],
  ['04-field-detail.png',  '/test/shot.html?shot=expanded&expand=2&scroll=520'],
  ['05-settings.png',      '/_shot-options.html'],
];

// The settings page is generated, captured and removed, so no half-real copy
// of options.html is left lying in the repo to drift out of sync with it.
const shotOptions = path.join(root, '_shot-options.html');
function writeShotOptions() {
  let html = readFileSync(path.join(root, 'options.html'), 'utf8');
  const stub = '  <script>\n' +
    '    window.chrome = window.chrome || {};\n' +
    '    chrome.storage = { sync: { get: (d, cb) => cb({}), set: (v, cb) => cb && cb() } };\n' +
    '  </' + 'script>\n';
  const frame = '  <style>\n' +
    '    html { background: linear-gradient(160deg, #e8edf3 0%, #dbe3ec 100%); min-height: 100%; }\n' +
    '    body { margin: 56px auto; border-radius: 10px; box-shadow: 0 18px 48px rgba(20,32,48,.22); }\n' +
    '  </' + 'style>\n';
  html = html.replace('</head>', frame + '</head>');
  html = html.replace('  <script src="src/prompts.js"></' + 'script>',
    stub + '  <script src="src/prompts.js"></' + 'script>');
  writeFileSync(shotOptions, html);
}

mkdirSync(outDir, { recursive: true });
writeShotOptions();

const server = spawn(process.execPath, [path.join(root, 'tools/serve.mjs'), String(PORT)], {
  stdio: 'ignore',
});

// The server binds immediately; a short settle avoids racing the first capture.
await new Promise(r => setTimeout(r, 600));

try {
  for (const [name, url] of SHOTS) {
    const res = spawnSync(chrome, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars',
      '--force-device-scale-factor=1', '--window-size=1280,800',
      '--virtual-time-budget=8000',
      `--screenshot=${path.join(outDir, name)}`,
      base + url,
    ], { encoding: 'utf8' });
    if (res.status !== 0) throw new Error(`capture failed for ${name}`);

    const png = readFileSync(path.join(outDir, name));
    const w = png.readUInt32BE(16), h = png.readUInt32BE(20), colour = png[25];
    const ok = w === 1280 && h === 800 && colour === 2;   // 2 = RGB, no alpha
    console.log(`  ${ok ? 'ok ' : 'BAD'}  ${name.padEnd(22)} ${w}x${h} colour-type ${colour}`);
    if (!ok) throw new Error(`${name} is not a 1280x800 alpha-free PNG`);
  }
  console.log(`\n${SHOTS.length} screenshots in icons/images/screenshots/`);
} finally {
  server.kill();
  rmSync(shotOptions, { force: true });
}
