// Builds dist/acumatica-audit-trail-analyzer-v<version>.zip — the loadable
// extension, without the test harness, tooling or repo scaffolding.
//
// Chrome refuses manually-installed .crx files, so a zip that the user
// unpacks and loads via "Load unpacked" is the distributable format.
//
// The zip writer is hand-rolled for the same reason as the PNG encoder: node's
// zlib is all it needs, and the repo stays dependency-free.
//
//   node tools/package.mjs

import { deflateRawSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from './crc32.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));

// Everything the extension needs at runtime, and nothing else. Derived from
// the manifest where possible so a new content script can't be left out.
const FILES = [
  'manifest.json',
  'popup.html',
  'popup.js',
  'options.html',
  'options.js',
  'LICENSE',
  'PRIVACY.md',
  'README.md',
  ...manifest.content_scripts.flatMap(c => [...(c.js || []), ...(c.css || [])]),
  ...Object.values(manifest.icons),
];

const unique = [...new Set(FILES)];

// ---------- zip ----------
function dosTime(date) {
  return ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;
}

function dosDate(date) {
  return (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
}

function buildZip(entries) {
  const now = new Date();
  const time = dosTime(now);
  const date = dosDate(now);
  const locals = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const deflated = deflateRawSync(entry.data, { level: 9 });
    // Storing is better than inflating a file that doesn't compress.
    const useDeflate = deflated.length < entry.data.length;
    const body = useDeflate ? deflated : entry.data;
    const method = useDeflate ? 8 : 0;
    const sum = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0, 6);           // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);          // extra field length
    locals.push(local, name, body);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);            // version made by
    dir.writeUInt16LE(20, 6);            // version needed
    dir.writeUInt16LE(0, 8);             // flags
    dir.writeUInt16LE(method, 10);
    dir.writeUInt16LE(time, 12);
    dir.writeUInt16LE(date, 14);
    dir.writeUInt32LE(sum, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(entry.data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt16LE(0, 30);            // extra
    dir.writeUInt16LE(0, 32);            // comment
    dir.writeUInt16LE(0, 34);            // disk number start
    dir.writeUInt16LE(0, 36);            // internal attributes
    dir.writeUInt32LE(0o644 << 16, 38);  // external attributes
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);

    offset += local.length + name.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, end]);
}

// ---------- build ----------
const entries = unique.map(rel => {
  const abs = path.join(root, rel);
  statSync(abs); // fail loudly if the manifest references something missing
  return { name: rel.split(path.sep).join('/'), data: readFileSync(abs) };
});

mkdirSync(path.join(root, 'dist'), { recursive: true });
const outName = `acumatica-audit-trail-analyzer-v${manifest.version}.zip`;
const outPath = path.join(root, 'dist', outName);
writeFileSync(outPath, buildZip(entries));

const kb = (statSync(outPath).size / 1024).toFixed(1);
console.log(`dist/${outName}  (${entries.length} files, ${kb} KB)`);
for (const e of entries) console.log('  ' + e.name);
