// Loads the extension's source files into this node process.
//
// The src/ files are plain scripts that attach to globalThis.AcuAudit — no
// modules, no build step — so the exact same source runs in the content script
// and here. vm.runInThisContext is all that's needed to bridge the two.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, '..', 'src');

// Load order matters: dictionary before parser, rules before narrative uses them.
const FILES = [
  'dictionary.js',
  'parser.js',
  'rules/common.js',
  'rules/so.js',
  'rules/po.js',
  'rules/arap.js',
  'rules/masters.js',
  'rules/fs.js',
  'narrative.js',
  // DOM adapters: they only touch document inside functions, so they load
  // cleanly here and their pure helpers can be tested.
  'legacy.js',
];

export function loadAcuAudit() {
  delete globalThis.AcuAudit;
  for (const file of FILES) {
    const code = readFileSync(path.join(srcDir, file), 'utf8');
    vm.runInThisContext(code, { filename: 'src/' + file });
  }
  return globalThis.AcuAudit;
}

export { FILES };
