// node --test test/
//
// Asserts the two things that make or break this extension: that the field
// classifier suppresses Acumatica's derived columns, and that the SO004417
// fixture reads as the story a person would tell about it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAcuAudit } from './load.mjs';
import fixture from './fixtures/so004417.mjs';

const AcuAudit = loadAcuAudit();
const { dictionary: dict, parser, narrative } = AcuAudit;

const model = parser.buildModel(fixture);
const analysis = narrative.analyze(model);

test('classifier hides raw DAC field names', () => {
  for (const f of ['ShipmentCntr', 'OpenLineCntr', 'OpenSiteCntr', 'IsOpenTaxValid',
    'IsUnbilledTaxValid', 'BaseShippedQty', 'OrderTotal', 'TaxTotal', 'OpenAmt',
    'MarkforDS', 'DiscountsAppliedToLine', 'CuryInfoID', 'UnbilledAmt', 'DiscAmt']) {
    assert.equal(dict.classifyField(f), dict.NOISE, `${f} should be noise`);
  }
});

test('classifier keeps fields a user can actually see', () => {
  for (const f of ['Discount Percent', 'Unit Price', 'Quantity', 'Inventory ID',
    'Line Description', 'Status', 'Line Status', 'Printed', 'Completed', 'Ship Via',
    'Mark for PO', 'PO Source', 'Order Nbr.', 'Line Nbr.', 'Return Notes',
    'Delivery Method', 'Subaccount']) {
    assert.equal(dict.classifyField(f), dict.PRIMARY, `${f} should be primary`);
  }
});

test('classifier demotes recalculated totals to detail', () => {
  // Document totals included: nobody types an order total, and quoting every
  // recalculated rollup is what turned a field service order into a wall of
  // numbers. Rules still read them directly; tier only governs generic prose.
  for (const f of ['Unshipped Amount', 'Unbilled Balance', 'Open Qty.', 'Open Line',
    'Qty. On Shipments', 'Tax Is Up to Date', 'Control Total', 'Order Total',
    'Tax Total', 'Line Total', 'Ext. Price', 'Estimated Total', 'Estimated Cost Total',
    'Actual Billable Total', 'Cost Total', 'Actual Tax Total', 'Invoice Total',
    'Ext. Price Total', 'Margin %', 'Margin Amount', 'Mark Up %',
    'Gross Profit $ (Unit)', 'Scheduled Service Count', 'Complete Service Count',
    'Actual Quantity', 'Estimated Duration', 'Max Log Time End']) {
    assert.equal(dict.classifyField(f), dict.SECONDARY, `${f} should be secondary`);
  }
});

test('captions glued to values are stripped, whichever path supplied them', () => {
  const m = parser.buildModel({
    batches: [{
      date: 'Date Date 7/20/2026 11:58 AM',
      user: 'User User sberger',
      screen: 'SCREEN ID SCREEN ID PO301000',
      tableData: [],
    }],
  });
  assert.equal(m.batches[0].user, 'sberger');
  assert.equal(m.batches[0].screen, 'PO301000');
  assert.equal(m.batches[0].dateText, '7/20/2026 11:58 AM');
  assert.ok(m.batches[0].date instanceof Date);
});

test('a username that matches its own caption is not stripped away', () => {
  const m = parser.buildModel({ batches: [{ user: 'User', screen: 'Screen', tableData: [] }] });
  assert.equal(m.batches[0].user, 'User');
  assert.equal(m.batches[0].screen, 'Screen');
});

test('parser orders batches oldest-first and finds the entity', () => {
  assert.equal(model.batches.length, 6);
  assert.equal(model.entity, 'Sales Order');
  assert.equal(model.batches[0].tables.some(t => t.operation === 'Created'), true);
  assert.equal(model.batches[model.batches.length - 1].screen, 'PO302000');
});

test('parser separates keys from changes by diffing the red/green rows', () => {
  const shipBatch = model.batches[model.batches.length - 1];
  const line = shipBatch.tables.find(t => t.tableName === 'Sales Order Line');
  assert.deepEqual(Object.keys(line.keys).sort(), ['Line Nbr.', 'Order Nbr.', 'Order Type']);
  assert.equal(line.keys['Order Nbr.'], 'SO004417');
  assert.equal(line.changes.some(c => c.field === 'Order Type'), false);
  assert.equal(line.changes.find(c => c.field === 'Open Qty.').to, 0);
});

test('parser resolves keys on Created rows, which have nothing to diff', () => {
  const created = model.batches[0].tables.find(t => t.tableName === 'Sales Order Line');
  assert.equal(created.operation, 'Created');
  assert.equal(created.keys['Line Nbr.'], 1);
  assert.equal(created.keys['Order Nbr.'], 'SO004417');
});

test('adjacent batches from one user collapse into single actions', () => {
  // Six batches, but only four things a person would say happened.
  assert.equal(analysis.actions.length, 4);
  assert.equal(analysis.actions[0].user, 'dmorgan@northwind.example');
  assert.equal(analysis.actions[3].user, 'tlawson@northwind.example');
});

test('creation is narrated before the line it contains', () => {
  const first = analysis.actions[0].sentences.map(s => s.text);
  assert.match(first[0], /^created sales order SO004417/);
  assert.match(first[0], /customer C01187 \(HOLLAND, MARIE\)/);
  assert.match(first[1], /^added line 1/);
  assert.match(first[1], /2 EA of HBX 480J10/);
  assert.match(first[1], /\$19\.63 = \$39\.26/);
});

test('tax recalculation collapses to one sentence with the totals', () => {
  const texts = analysis.actions[0].sentences.map(s => s.text);
  assert.ok(texts.some(t => /system recalculated tax — order total \$39\.26 → \$41\.75 \(tax \$2\.49\)/.test(t)));
});

test('printing is its own action', () => {
  assert.deepEqual(analysis.actions[1].sentences.map(s => s.text), ['printed the sales order']);
});

test('drop-ship flagging is read off Mark for PO plus PO Source', () => {
  const texts = analysis.actions[2].sentences.map(s => s.text);
  assert.ok(texts.some(t => t === 'flagged line 1 for drop-ship purchasing (warehouse 14)'));
});

test('shipment confirmation is inferred from counters, not from any "shipped" field', () => {
  const texts = analysis.actions[3].sentences.map(s => s.text);
  assert.ok(texts.some(t => /confirmed a shipment — 2 of line 1 shipped, completing the order/.test(t)));
  assert.equal(analysis.actions[3].screenLabel, 'Purchase Receipts (PO302000)');
});

test('low-signal sentences stay out of the summary but remain in the timeline', () => {
  const revalidated = analysis.actions[2].sentences.find(s => /re-validated tax/.test(s.text));
  assert.ok(revalidated, 'timeline keeps the re-validation');
  assert.equal(revalidated.lowSignal, true);
  const bullets = analysis.highlights.map(h => h.text).join(' | ');
  assert.doesNotMatch(bullets, /re-validated tax/);
});

test('the overview is one scannable line', () => {
  assert.equal(
    analysis.overview,
    '4 recorded actions on Sales Order SO004417 by dmorgan@northwind.example and ' +
    'tlawson@northwind.example between 8/5/2026 4:45 PM and 8:15 PM.'
  );
});

test('the summary is bullets, one per action, in order, flagging foreign screens', () => {
  assert.equal(analysis.highlights.length, 4);
  const [first, printed, dropship, shipped] = analysis.highlights;

  assert.equal(first.user, 'dmorgan@northwind.example');
  assert.match(first.text, /^created sales order SO004417/);
  assert.equal(first.foreign, false);

  assert.equal(printed.text, 'printed the sales order');
  assert.match(dropship.text, /^flagged line 1 for drop-ship purchasing/);

  assert.equal(shipped.user, 'tlawson@northwind.example');
  assert.equal(shipped.foreign, true, 'a purchase receipt closing a sales order is notable');
  assert.equal(shipped.screenLabel, 'Purchase Receipts (PO302000)');
});

test('no action repeats itself', () => {
  for (const action of analysis.actions) {
    const texts = action.sentences.map(s => s.text);
    assert.equal(new Set(texts).size, texts.length,
      'duplicate sentence in action: ' + texts.join(' | '));
  }
});

test('a rule that consumed a whole table stops later rules re-describing it', () => {
  // fs.service-added and common.line-added both match a created detail row;
  // only the more specific one should speak.
  const created = analysis.actions[0].sentences.filter(s => /^added line 1/.test(s.text));
  assert.equal(created.length, 1, 'line creation described exactly once');
});

test('sentences are capped per action so a busy save stays readable', () => {
  const busy = narrative.analyze(parser.buildModel({
    batches: [{
      date: '8/5/2026 1:00:00 PM', user: 'u', screen: 'SO301000',
      tableData: [{
        TableName: 'Sales Order', Operation: 'Modified',
        Columns: [
          { Header: 'Order Nbr.', Cells: [{ Value: 'X', Color: 2 }, { Value: 'X', Color: 1 }] },
          ...Array.from({ length: 30 }, (_, i) => ({
            Header: 'Custom Field ' + i,
            Cells: [{ Value: 'a', Color: 2 }, { Value: 'b', Color: 1 }],
          })),
        ],
      }],
    }],
  }));
  const sentences = busy.actions[0].sentences;
  assert.ok(sentences.length <= narrative.DEFAULTS.maxGenericSentences + 1,
    `expected a capped list, got ${sentences.length}`);
  assert.match(sentences[sentences.length - 1].text, /…and 26 further field changes/);
});

test('a table gets its own label, not the audited document\'s', () => {
  // A service order audit picks up the purchase order it raised; calling that
  // "service order PO002298" is nonsense.
  const mixed = narrative.analyze(parser.buildModel({
    info: { entity: 'Service Order' },
    batches: [{
      date: '8/5/2026 1:00:00 PM', user: 'u', screen: 'PO301000',
      tableData: [{
        TableName: 'Purchase Order', Operation: 'Created',
        Columns: [
          { Header: 'Order Nbr.', Cells: [{ Value: 'PO002298', Color: 1 }] },
          { Header: 'Vendor', Cells: [{ Value: 'V0000031', Color: 1 }] },
        ],
      }],
    }],
  }));
  assert.match(mixed.actions[0].sentences[0].text,
    /^created purchase order PO002298 — vendor V0000031/);
});

test('the AI digest drops plumbing but keeps the diffs', () => {
  const digest = narrative.toAiDigest(analysis);
  assert.doesNotMatch(digest, /ShipmentCntr/);
  assert.doesNotMatch(digest, /IsOpenTaxValid/);
  assert.match(digest, /Unit Price = 19\.63/);
  assert.match(digest, /Status: Open -> Completed/);
  // The whole point is that this fits in a prompt.
  assert.ok(digest.length < 6000, `digest was ${digest.length} chars`);
});

test('screen names fall back to the module, never to nothing', () => {
  assert.equal(dict.describeScreen('SO301000'), 'Sales Orders (SO301000)');
  assert.equal(dict.describeScreen('FS300200'), 'Appointments (FS300200)');
  assert.equal(dict.describeScreen('PO501234'), 'a Purchasing screen (PO501234)');
  assert.equal(dict.describeScreen('ZZ999999'), 'ZZ999999');
});

test('FS durations read as time, not as raw hhmm integers', () => {
  // The audit renders PXDBTimeSpanLong as h:mm with the separator dropped, so
  // "200" is two hours. A minutes value would never come through as "000".
  assert.equal(dict.formatDuration('000'), '0h');
  assert.equal(dict.formatDuration('100'), '1h');
  assert.equal(dict.formatDuration('200'), '2h');
  assert.equal(dict.formatDuration('130'), '1h 30m');
  assert.equal(dict.formatDuration('045'), '45m');
  assert.equal(dict.formatDuration('1230'), '12h 30m');
  assert.equal(dict.formatDuration('2:00'), '2h');
  // Anything that isn't h:mm is left alone rather than mangled.
  assert.equal(dict.formatDuration('199'), '199');
  assert.equal(dict.formatDuration('n/a'), 'n/a');
  assert.ok(dict.isDurationField('Estimated Duration'));
  assert.ok(dict.isDurationField('Log Actual Duration'));
  assert.ok(!dict.isDurationField('Discount Percent'));
});

test('a value re-rendered at different precision is not a change', () => {
  // Acumatica writes the same discount as 66.666667 then 66.6667 without
  // anybody touching it; a real edit of one cent must still register.
  assert.ok(parser.sameValue('66.666667', '66.6667'));
  assert.ok(parser.sameValue('2', '2.000000'));
  assert.ok(!parser.sameValue('18425.88', '18425.89'));
  assert.ok(!parser.sameValue('0', '0.5'));
  // Leading zeros are identifiers, not numbers.
  assert.ok(!parser.sameValue('0078097', '78097'));
});

test('key columns written blank -> value stay keys, not edits', () => {
  // Raising a PO from a service order stamps the link onto the source line, so
  // its key columns arrive as blank -> value. Diffing alone read those as
  // edits, which lost the row's identity and spent a sentence on each.
  const k = (h, v) => ({ Header: h, Cells: [{ Value: v, Color: 2 }, { Value: v, Color: 1 }] });
  const fill = (h, v) => ({ Header: h, Cells: [{ Value: null, Color: 2 }, { Value: v, Color: 1 }] });
  // Acumatica's feed is newest-first; buildModel reverses it.
  const m = parser.buildModel({
    batches: [
      { date: '7/20/2026 11:58 AM', user: 'u', screen: 'PO301000', tableData: [{
        TableName: 'Service Order Item Detail', Operation: 'Modified',
        Columns: [k('Service Order Nbr.', '0078097'), k('Line Nbr.', 3),
          { Header: 'Unit Cost', Cells: [{ Value: 0, Color: 2 }, { Value: 10, Color: 1 }] }],
      }]},
      { date: '7/20/2026 11:57 AM', user: 'u', screen: 'PO505000', tableData: [{
        TableName: 'Service Order Item Detail', Operation: 'Modified',
        Columns: [fill('Service Order Nbr.', '0078097'), fill('Line Nbr.', 3),
          fill('PO Nbr.', 'PO002298')],
      }]},
    ],
  });
  const linked = m.batches[0].tables[0];
  assert.equal(linked.keys['Line Nbr.'], 3);
  assert.equal(linked.keys['Service Order Nbr.'], '0078097');
  // The link itself is still a change; only the keys moved.
  assert.deepEqual(linked.changes.map(c => c.field), ['PO Nbr.']);
});

test('a line on another document is named with that document', () => {
  // On a purchase order audit "line 3" and "line 1" read as two lines of the
  // same order when one of them belongs to the service order behind it.
  const keys = { 'Service Order Nbr.': '0078097', 'Line Nbr.': 3 };
  assert.equal(dict.describeRecord('Service Order Item Detail', keys, 'PO002298'),
    'line 3 of 0078097');
  assert.equal(dict.describeRecord('Service Order Item Detail', keys, '0078097'), 'line 3');
  assert.equal(dict.describeRecord('Service Order Item Detail', keys), 'line 3');
});

test('the classic audit window marks old and new by colour, not class', () => {
  // Controls/AuditItem.ascx.cs sets ForeColor DarkRed on the old value cell and
  // DarkGreen on the new one, which ASP.NET renders as an inline style. Chrome
  // hands that back as rgb() through element.style, so both spellings count.
  const { legacy } = AcuAudit;
  assert.equal(legacy.colorFromStyle('color:DarkRed;background-color:GhostWhite;'), 2);
  assert.equal(legacy.colorFromStyle('color:DarkGreen;background-color:GhostWhite;'), 1);
  assert.equal(legacy.colorFromStyle('rgb(139, 0, 0)'), 2);
  assert.equal(legacy.colorFromStyle('rgb(0, 100, 0)'), 1);
  // The header cell is DarkSlateGray, and must not read as either.
  assert.equal(legacy.colorFromStyle('color:DarkSlateGray;font-weight:bold;'), 0);
  assert.equal(legacy.colorFromStyle(''), 0);
});

test('classic operation titles map onto the modern vocabulary', () => {
  // The rules match on Created/Modified/Deleted; the classic page says
  // Inserted/Updated/Deleted. Anything unrecognised stays blank so the parser
  // falls back to inferring it from whether the value row is red or green.
  const { legacy } = AcuAudit;
  assert.equal(legacy.normalizeOperation('Inserted'), 'Created');
  assert.equal(legacy.normalizeOperation('Updated'), 'Modified');
  assert.equal(legacy.normalizeOperation('Deleted'), 'Deleted');
  assert.equal(legacy.normalizeOperation('Modified'), 'Modified');
  assert.equal(legacy.normalizeOperation('Row Inserted'), 'Created');
  assert.equal(legacy.normalizeOperation(''), '');
  assert.equal(legacy.normalizeOperation('Something Else'), '');
});

test('the classic page gives away the viewer timezone without being asked', () => {
  // Audit.aspx prints batch dates raw (UTC) but converts the info panel to the
  // viewing user's timezone, so the same instant appears twice and the
  // difference is that user's offset. Nothing is assumed about where they are.
  const { legacy } = AcuAudit;
  // Real numbers from a live US-Eastern instance, one second apart by nature
  // of the creation batch being the creation.
  assert.equal(legacy.deriveOffset('8/5/2026 4:14:41 PM', '8/5/2026 8:14:42 PM'), 240);
  // Whole-hour zones east and west, and the half/quarter-hour ones that make a
  // 30-minute rounding step wrong.
  assert.equal(legacy.deriveOffset('8/5/2026 9:00:00 AM', '8/5/2026 4:00:00 PM'), 420);   // PDT
  assert.equal(legacy.deriveOffset('8/5/2026 6:00:00 PM', '8/5/2026 12:30:00 PM'), -330); // IST
  assert.equal(legacy.deriveOffset('8/5/2026 6:00:00 PM', '8/5/2026 5:15:00 AM'), -765);  // Chatham
  // Already aligned — nothing to correct.
  assert.equal(legacy.deriveOffset('8/5/2026 4:14:41 PM', '8/5/2026 4:14:41 PM'), 0);
});

test('an offset that cannot be real is refused rather than guessed', () => {
  const { legacy } = AcuAudit;
  // Beyond any real UTC offset: the anchor assumption must be wrong.
  assert.equal(legacy.deriveOffset('8/5/2026 4:00:00 PM', '8/7/2026 4:00:00 PM'), null);
  // Not a whole quarter-hour, so these two are not the same instant.
  assert.equal(legacy.deriveOffset('8/5/2026 4:00:00 PM', '8/5/2026 8:07:00 PM'), null);
  assert.equal(legacy.deriveOffset(null, '8/5/2026 8:14:42 PM'), null);
  assert.equal(legacy.deriveOffset('8/5/2026 4:14:41 PM', 'not a date'), null);
});

test('classic batch times are shifted onto the panel clock', () => {
  const { legacy } = AcuAudit;
  // Newest first, as the page renders them.
  const batches = [
    { date: '8/5/2026 8:30:53 PM' },
    { date: '8/5/2026 8:16:01 PM' },
    { date: '8/5/2026 8:14:42 PM' },
  ];
  const info = { createdOn: '8/5/2026 4:14:41 PM', lastModifiedOn: '8/5/2026 4:30:53 PM' };
  legacy.applyOffset(batches, info);

  assert.equal(info.timeOffsetMinutes, 240);
  assert.equal(info.timesAreRaw, false);
  assert.equal(batches[0].date, '8/5/2026 4:30:53 PM');
  assert.equal(batches[1].date, '8/5/2026 4:16:01 PM');
  // One second after the panel's created-on, because the creation batch is
  // written a moment after the record itself — the shift is exact, not fitted.
  assert.equal(batches[2].date, '8/5/2026 4:14:42 PM');
  // What the page literally said is kept, so a dump stays faithful.
  assert.equal(batches[2].rawDate, '8/5/2026 8:14:42 PM');
});

test('times are left alone, and flagged, when no anchor is available', () => {
  const { legacy } = AcuAudit;
  const batches = [{ date: '8/5/2026 8:30:53 PM' }];
  const info = { createdOn: null, lastModifiedOn: null };
  legacy.applyOffset(batches, info);
  assert.equal(info.timeOffsetMinutes, null);
  assert.equal(info.timesAreRaw, true);
  assert.equal(batches[0].date, '8/5/2026 8:30:53 PM');
  assert.equal(batches[0].rawDate, undefined);
});
