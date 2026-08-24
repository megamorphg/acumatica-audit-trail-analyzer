// Offline harness: parse a fixture, run the narrative engine, print the result.
//
//   node test/run.mjs                       # default fixture
//   node test/run.mjs path/to/dump.json     # a real diagnostic dump
//   node test/run.mjs --system              # include system/derived fields
//   node test/run.mjs --ai                  # print the AI digest instead

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadAcuAudit } from './load.mjs';

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const fixtureArg = args.find(a => !a.startsWith('--'));

const AcuAudit = loadAcuAudit();

// A 🩺 diagnostic dump wraps the acquired payload in provenance metadata, so
// unwrap it and report what the extension actually managed to read.
function unwrap(raw) {
  if (raw && raw.payload && Array.isArray(raw.payload.batches)) {
    const via = raw.acquiredVia || raw.payload.source || 'unknown';
    const bridgeError = raw.bridgeError || raw.payload.bridgeError;
    console.error(`[dump: acquired via ${via}` +
      (bridgeError ? `, view-model unavailable (${bridgeError})` : '') +
      (raw.capturedAt ? `, captured ${raw.capturedAt}` : '') + ']');
    return raw.payload;
  }
  return raw;
}

async function loadFixture() {
  if (!fixtureArg) {
    return (await import('./fixtures/so004417.mjs')).default;
  }
  const abs = path.resolve(fixtureArg);
  if (abs.endsWith('.json')) return unwrap(JSON.parse(readFileSync(abs, 'utf8')));
  return unwrap((await import('file://' + abs)).default);
}

const raw = await loadFixture();
const model = AcuAudit.parser.buildModel(raw);
const analysis = AcuAudit.narrative.analyze(model);

if (flags.has('--ai')) {
  console.log(AcuAudit.narrative.toAiDigest(analysis));
} else {
  console.log(AcuAudit.narrative.toMarkdown(analysis, {
    showSystemFields: flags.has('--system'),
  }));
}

// A quick read on how much noise was filtered, since that's the whole point.
let total = 0;
let shown = 0;
for (const action of analysis.actions) {
  for (const d of action.details) {
    for (const f of d.fields) {
      total++;
      if (f.tier !== AcuAudit.dictionary.NOISE) shown++;
    }
  }
}
console.error(
  `\n[${analysis.actions.length} actions from ${model.batches.length} batches; ` +
  `${shown}/${total} fields kept, ${total - shown} classified as plumbing]`
);
