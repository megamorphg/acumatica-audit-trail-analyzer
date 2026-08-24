// Guards the failure the first release actually hit: a real field service
// order audit came out as an unbroken ~4,000-character paragraph, with rules
// firing twice, recalculated rollups quoted as if a person had typed them,
// and captions glued to every user and screen value.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAcuAudit } from './load.mjs';
import fixture from './fixtures/fs-service-order.mjs';

const AcuAudit = loadAcuAudit();
const { parser, narrative } = AcuAudit;

const analysis = narrative.analyze(parser.buildModel(fixture));
const bullets = analysis.highlights.map(h => h.text);

test('the summary is scannable, not a wall of text', () => {
  assert.ok(analysis.highlights.length > 0, 'something should be summarized');
  for (const text of bullets) {
    assert.ok(text.length <= 320, `bullet too long (${text.length}): ${text}`);
  }
  const total = analysis.overview.length + bullets.join('\n').length;
  assert.ok(total < 2600, `summary was ${total} chars; it used to be a ~4000-char paragraph`);
});

test('the overview fits on one line', () => {
  assert.ok(analysis.overview.length < 160, analysis.overview);
  assert.match(analysis.overview, /^14 recorded actions on Appointment 0012045-1 by /);
});

test('recalculated rollups never appear in the summary', () => {
  // Nobody types an Estimated Total or a Mark Up %; Acumatica rewrites them
  // on every save, and quoting them is what produced the wall of text.
  const joined = bullets.join(' | ');
  for (const noise of ['Estimated Total', 'Estimated Cost Total', 'Actual Billable Total',
    'Cost Total', 'Actual Tax Total', 'Invoice Total', 'Ext. Price Total',
    'Margin %', 'Margin Amount', 'Gross Profit', 'Mark Up %',
    'Scheduled Service Count', 'Complete Service Count']) {
    assert.doesNotMatch(joined, new RegExp(noise.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `${noise} leaked into the summary`);
  }
});

test('captions are stripped from users and screens', () => {
  const users = new Set(analysis.actions.map(a => a.user));
  assert.deepEqual([...users].sort(), ['admin', 'pnadeau', 'sberger']);
  for (const action of analysis.actions) {
    assert.doesNotMatch(action.user, /^User\s/, action.user);
    assert.match(action.screen, /^[A-Z]{2}\d{6}$/, action.screen);
  }
});

test('a purchase order raised from a service order is named correctly', () => {
  const po = bullets.find(t => /PO002298/.test(t) && /created/.test(t));
  assert.match(po, /created purchase order PO002298 — vendor V0000031 \(MAIN\)/);
  assert.doesNotMatch(po, /service order PO002298|appointment PO002298/);
});

test('no rule describes the same thing twice', () => {
  for (const action of analysis.actions) {
    const texts = action.sentences.map(s => s.text);
    assert.equal(new Set(texts).size, texts.length,
      'duplicate sentence: ' + texts.join(' | '));
  }
  assert.equal(new Set(bullets).size, bullets.length, 'duplicate bullet');
});

test('created detail rows are described once, by the more specific rule', () => {
  const added = bullets.join(' | ').match(/added line 5[^;)]*/g) || [];
  assert.equal(added.length, 1, 'expected one "added line 5", got: ' + added.join(' / '));
  assert.match(added[0], /added line 5 — OT × 2/);
});

test('money is grouped so large figures stay readable', () => {
  assert.match(bullets.join(' | '), /\$18,425\.88/);
});

test('the AI digest stays small enough to paste into a prompt', () => {
  const digest = narrative.toAiDigest(analysis);
  assert.ok(digest.length < 14000, `digest was ${digest.length} chars`);
  assert.doesNotMatch(digest, /Mark Up %/);
});

// --- shapes taken from a live FS300100 diagnostic dump ---

const cell = (header, value) => ({ Header: header, Cells: [{ Value: value, Color: 1 }] });
const pair = (header, from, to) => ({
  Header: header, Cells: [{ Value: from, Color: 2 }, { Value: to, Color: 1 }],
});

// Adding a line to an appointment mirrors it onto the service order, so the
// batch carries two Created rows for one user action.
const mirroredAdd = {
  source: 'viewmodel',
  info: {},
  batches: [{
    date: '7/24/2026 2:47 PM', user: 'pnadeau', screen: 'FS300200',
    tableData: [
      {
        TableName: 'Appointment Item Detail', Operation: 'Created',
        Columns: [
          cell('Appointment Nbr.', '0012045-1'), cell('Line Nbr.', '5'),
          cell('Inventory ID', 'OT'), cell('Description', 'Overtime'),
          cell('Estimated Quantity', '2'), cell('Estimated Duration', '200'),
        ],
      },
      {
        TableName: 'Service Order Item Detail', Operation: 'Created',
        Columns: [
          cell('Service Order Nbr.', '0078097'), cell('Line Nbr.', '5'),
          cell('Inventory ID', 'OT'), cell('Description', 'Overtime'),
          cell('Quantity', '2'),
        ],
      },
    ],
  }],
};

test('a line mirrored onto the service order is added once, not twice', () => {
  const a = narrative.analyze(parser.buildModel(mirroredAdd));
  const said = a.actions.flatMap(x => x.sentences.map(s => s.text));
  const added = said.filter(t => /^added /.test(t));
  assert.equal(added.length, 1, said.join(' | '));
  // The identifier alone is "OT"; the description alone loses the item code.
  assert.match(added[0], /OT \(Overtime\) × 2$/);
});

test('the record is the audited document, not whichever header came first', () => {
  // Completing an appointment writes the service order too, and the service
  // order is what is being audited — the title used to read 0012045-1.
  const a = narrative.analyze(parser.buildModel({
    source: 'viewmodel',
    info: {},
    batches: [{
      date: '7/20/2026 2:13 PM', user: 'pnadeau', screen: 'FS300200',
      tableData: [
        {
          TableName: 'Appointment', Operation: 'Modified',
          Columns: [pair('Appointment Nbr.', '0012045-1', '0012045-1'),
            pair('Status', 'In Process', 'Completed')],
        },
        {
          TableName: 'Service Order', Operation: 'Modified',
          Columns: [pair('Order Nbr.', '0078097', '0078097'),
            pair('Status', 'Open', 'Completed')],
        },
        {
          TableName: 'Service Order', Operation: 'Modified',
          Columns: [pair('Order Nbr.', '0078097', '0078097'),
            pair('Service Manager Reviewed By', null, '226')],
        },
      ],
    }],
  }));
  assert.equal(a.entity, 'Service Order');
  assert.equal(a.record, '0078097');
});

// --- filtering a long history ---

const filterFixture = {
  source: 'viewmodel',
  info: {},
  batches: [
    {
      date: '7/24/2026 2:47 PM', user: 'pnadeau', screen: 'FS300200',
      tableData: [{
        TableName: 'Service Order Item Detail', Operation: 'Modified',
        Columns: [
          pair('Service Order Nbr.', '0078097', '0078097'),
          pair('Line Nbr.', '5', '5'),
          pair('Unit Cost', '120', '150'),
          // The raw-DAC twin Acumatica emits alongside it, which the tier
          // classifier hides from the timeline.
          pair('UnitCost', '120', '150'),
        ],
      }],
    },
    {
      date: '7/24/2026 3:10 PM', user: 'sberger', screen: 'FS300200',
      tableData: [{
        TableName: 'Service Order Item Detail', Operation: 'Modified',
        Columns: [
          pair('Service Order Nbr.', '0078097', '0078097'),
          pair('Line Nbr.', '2', '2'),
          pair('Discount Percent', '0', '100'),
        ],
      }],
    },
    {
      date: '7/25/2026 9:00 AM', user: 'pnadeau', screen: 'FS300200',
      tableData: [{
        TableName: 'Service Order', Operation: 'Modified',
        Columns: [
          pair('Order Nbr.', '0078097', '0078097'),
          pair('Status', 'Open', 'Completed'),
        ],
      }],
    },
  ],
};

const full = narrative.analyze(parser.buildModel(filterFixture));

test('a filter narrows the history to the terms asked for', () => {
  const f = narrative.filterAnalysis(full, 'unit cost, discount');
  assert.equal(f.filter.matchedActions, 2);
  assert.equal(f.filter.totalActions, 3);
  assert.match(f.overview, /2 of 3 recorded actions match "unit cost" or "discount"/);
  // The status change is not what was asked about.
  const fields = f.actions.flatMap(a => a.details.flatMap(d => d.fields.map(x => x.field)));
  assert.ok(!fields.includes('Status'), fields.join(','));
});

test('a filter finds matches the tier classifier hides', () => {
  // Answering "was the unit cost changed" with "no" because the only match sat
  // in a system field would be worse than useless.
  const f = narrative.filterAnalysis(full, 'unit cost');
  const fields = f.actions.flatMap(a => a.details.flatMap(d => d.fields.map(x => x.field)));
  assert.deepEqual(fields.sort(), ['Unit Cost', 'UnitCost']);
  assert.equal(f.filter.hiddenMatches, 1);
});

test('punctuation in a field name does not have to be typed', () => {
  // Acumatica emits both "Unit Cost" and "UnitCost"; a reader means the same
  // thing by either.
  assert.equal(narrative.filterAnalysis(full, 'unitcost').filter.matchedActions, 1);
  assert.equal(narrative.filterAnalysis(full, 'UNIT COST').filter.matchedActions, 1);
});

test('a filter searches values, not just field names', () => {
  const f = narrative.filterAnalysis(full, 'Completed');
  assert.equal(f.filter.matchedActions, 1);
  assert.equal(f.actions[0].user, 'pnadeau');
});

test('an empty filter means no filter at all', () => {
  assert.equal(narrative.filterAnalysis(full, ''), null);
  assert.equal(narrative.filterAnalysis(full, '   ,  '), null);
});

test('a filter that matches nothing says so rather than looking empty', () => {
  const f = narrative.filterAnalysis(full, 'freight');
  assert.equal(f.actions.length, 0);
  assert.match(f.overview, /^Nothing in this audit history matches "freight"\.$/);
});

test('the copied summary follows the filter', () => {
  const md = narrative.toMarkdown(narrative.filterAnalysis(full, 'discount'));
  assert.match(md, /Filtered to "discount" — 1 of 3 actions\./);
  assert.doesNotMatch(md, /Status/);
});

// --- purchase orders, from a live PO301000 capture ---

const poFixture = {
  source: 'viewmodel',
  info: {},
  batches: [
    // Newest first, as Acumatica's feed delivers them.
    {
      date: '7/20/2026 11:58:57 AM', user: 'sberger', screen: 'PO301000',
      tableData: [
        { TableName: 'Purchase Order', Operation: 'Modified', Columns: [
          pair('Order Nbr.', 'PO002298', 'PO002298'),
          pair('Status', 'On Hold', 'Pending Printing'),
          pair('Hold', true, false),
          pair('Approved', false, true),
        ]},
        { TableName: 'Service Order Item Detail', Operation: 'Modified', Columns: [
          pair('Service Order Nbr.', '0078097', '0078097'),
          pair('Line Nbr.', 3, 3),
          pair('PO Status', 'On Hold', 'Pending Printing'),
        ]},
      ],
    },
    {
      date: '7/20/2026 11:58:35 AM', user: 'sberger', screen: 'PO301000',
      tableData: [
        { TableName: 'PO Line', Operation: 'Modified', Columns: [
          pair('Order Nbr.', 'PO002298', 'PO002298'),
          pair('Line Nbr.', 1, 1),
          pair('Cancelled', false, true),
          pair('Completed', false, true),
        ]},
      ],
    },
    {
      date: '7/20/2026 11:57:27 AM', user: 'sberger', screen: 'PO505000',
      tableData: [
        { TableName: 'Service Order Item Detail', Operation: 'Modified', Columns: [
          { Header: 'Service Order Nbr.', Cells: [{ Value: null, Color: 2 }, { Value: '0078097', Color: 1 }] },
          { Header: 'Line Nbr.', Cells: [{ Value: null, Color: 2 }, { Value: 3, Color: 1 }] },
          { Header: 'PO Nbr.', Cells: [{ Value: null, Color: 2 }, { Value: 'PO002298', Color: 1 }] },
          { Header: 'PO Line Nbr.', Cells: [{ Value: null, Color: 2 }, { Value: 1, Color: 1 }] },
          { Header: 'PO Status', Cells: [{ Value: null, Color: 2 }, { Value: 'On Hold', Color: 1 }] },
        ]},
        { TableName: 'Purchase Order', Operation: 'Created', Columns: [
          cell('Order Nbr.', 'PO002298'), cell('Vendor', 'V0000031'),
          cell('Status', 'On Hold'),
        ]},
      ],
    },
  ],
};

const po = narrative.analyze(parser.buildModel(poFixture));
const poSaid = po.actions.flatMap(a => a.sentences.map(s => s.text));

test('a hold takes its own status change with it', () => {
  // Holding a document moves its status to On Hold and Acumatica audits both;
  // saying both is the same event twice.
  assert.ok(poSaid.includes('took the purchase order off hold'), poSaid.join(' | '));
  assert.ok(!poSaid.some(t => /moved status from On Hold/.test(t)), poSaid.join(' | '));
  // An unrelated status move still gets said.
  assert.ok(poSaid.includes('approved the purchase order'));
});

test('the PO status stamped onto linked lines is not a separate event', () => {
  assert.ok(!poSaid.some(t => /PO Status/.test(t)), poSaid.join(' | '));
});

test('a line linked to a new purchase order says so once', () => {
  const linked = poSaid.filter(t => /^linked /.test(t));
  assert.equal(linked.length, 1, poSaid.join(' | '));
  assert.equal(linked[0], 'linked line 3 of 0078097 to purchase order PO002298 line 1');
});

test('cancelling a line does not also announce closing it', () => {
  assert.ok(poSaid.includes('cancelled line 1'), poSaid.join(' | '));
  assert.ok(!poSaid.includes('closed line 1'), poSaid.join(' | '));
});

test('an edit mirrored onto the appointment line is told once', () => {
  // Every service order line change is written to its appointment line too.
  // Completing a line moves them from different starting statuses to the same
  // one, so matching on the new value is what catches it.
  const a = narrative.analyze(parser.buildModel({
    batches: [{
      date: '7/24/2026 2:50 PM', user: 'pnadeau', screen: 'FS300200',
      tableData: [
        { TableName: 'Service Order', Operation: 'Modified', Columns: [
          pair('Order Nbr.', '0078097', '0078097'), pair('Status', 'Open', 'Completed')]},
        { TableName: 'Service Order Item Detail', Operation: 'Modified', Columns: [
          pair('Service Order Nbr.', '0078097', '0078097'), pair('Line Nbr.', 3, 3),
          pair('Line Status', 'Scheduled', 'Completed'),
          pair('Unit Price', 100, 250)]},
        { TableName: 'Appointment Item Detail', Operation: 'Modified', Columns: [
          pair('Appointment Nbr.', '0012045-1', '0012045-1'), pair('Line Nbr.', 3, 3),
          pair('Line Status', 'In Process', 'Completed'),
          pair('Unit Price', 100, 250),
          // Only on the appointment: must survive.
          pair('Return Notes', null, 'CANCELLED')]},
      ],
    }],
  }));
  const said = a.actions.flatMap(x => x.sentences.map(s => s.text));
  assert.equal(said.filter(t => /line 3/.test(t) && /Completed/.test(t)).length, 1, said.join(' | '));
  assert.equal(said.filter(t => /price on line 3/i.test(t)).length, 1, said.join(' | '));
  assert.ok(said.some(t => /Return Notes/.test(t)), said.join(' | '));
});

test('a credit hold takes its own status change with it', () => {
  // Same shape as the plain hold, found replaying the classic audit window:
  // the status moves to Credit Hold in the same save.
  const a = narrative.analyze(parser.buildModel({
    source: 'legacy',
    info: {},
    batches: [{
      date: '8/5/2026 8:15 PM', user: 'rkeane', screen: 'SO301000',
      tableData: [{
        TableName: 'Sales Order', Operation: 'Modified',
        Columns: [
          pair('Order Nbr.', 'SO256890', 'SO256890'),
          pair('Status', 'Open', 'Credit Hold'),
          pair('Credit Hold', false, true),
        ],
      }],
    }],
  }));
  const said = a.actions.flatMap(x => x.sentences.map(s => s.text));
  assert.ok(said.includes('placed the sales order on credit hold'), said.join(' | '));
  assert.ok(!said.some(t => /moved status/.test(t)), said.join(' | '));
});

test('the audited record wins over whichever table appears most', () => {
  // Opening an appointment that raised a purchase order gives the PO two
  // batches to the appointment's one, so counting header tables titled the
  // panel "Purchase Order PO001039" for an appointment's history. SM205540
  // states which record it was opened for; that settles it.
  const raw = {
    source: 'viewmodel',
    info: { auditKeys: 'INST\u00000078099-1', screenId: 'FS300200' },
    batches: [
      { date: '8/6/2026 9:44:55 AM', user: 'sjohnson', screen: 'PO301000', tableData: [
        { TableName: 'Purchase Order', Operation: 'Modified', Columns: [
          pair('Order Nbr.', 'PO001039', 'PO001039'),
          pair('Status', 'On Hold', 'Pending Printing')]},
      ]},
      { date: '8/6/2026 9:44:25 AM', user: 'sjohnson', screen: 'PO505000', tableData: [
        { TableName: 'Purchase Order', Operation: 'Created', Columns: [
          cell('Order Nbr.', 'PO001039'), cell('Vendor', 'V0000123')]},
      ]},
      { date: '8/6/2026 9:42:14 AM', user: 'sjohnson', screen: 'FS300200', tableData: [
        // Comes before Appointment in the real batch, and carries the same two
        // keys plus its own line number. "Contains all the keys" picks this.
        { TableName: 'FSAppointmentEmployee', Operation: 'Created', Columns: [
          cell('Service Order Type', 'INST'), cell('Appointment Nbr.', '0078099-1'),
          cell('Line Nbr.', 1), cell('Staff Member', '245')]},
        { TableName: 'Appointment', Operation: 'Created', Columns: [
          cell('Service Order Type', 'INST'), cell('Appointment Nbr.', '0078099-1'),
          cell('Customer', 'C0000042')]},
      ]},
    ],
  };
  const a = narrative.analyze(parser.buildModel(raw));
  assert.equal(a.entity, 'Appointment');
  assert.equal(a.record, '0078099-1');
  assert.match(a.overview, /on Appointment 0078099-1 /);
  // Not the child row that happens to carry the same two keys.
  assert.notEqual(a.entity, 'FSAppointmentEmployee');

  // Without the keys it falls back to counting, which is what used to happen.
  const b = narrative.analyze(parser.buildModel(
    Object.assign({}, raw, { info: {} })));
  assert.equal(b.entity, 'Purchase Order');
});

test('audit keys split on NUL, never on whitespace', () => {
  assert.deepEqual(parser.auditKeyValues({ auditKeys: 'INST\u00000078099-1' }),
    ['INST', '0078099-1']);
  // Still URL-encoded, and padded, as Acumatica often sends them.
  assert.deepEqual(parser.auditKeyValues({ auditKeys: 'SVCR%000078097  ' }),
    ['SVCR', '0078097']);
  // A value with a space in it must survive intact.
  assert.deepEqual(parser.auditKeyValues({ auditKeys: 'Net@Work Net@Work' }),
    ['Net@Work Net@Work']);
  assert.deepEqual(parser.auditKeyValues({}), []);
  assert.deepEqual(parser.auditKeyValues(null), []);
});

test('an appointment creation names its parts, not its plumbing tables', () => {
  // From a live FS300200 capture. FSAppointmentEmployee is the staff
  // assignment and Appointment Tax Detail is the tax engine's own breakdown;
  // neither name ends in Line/Detail-the-regex-catches, so both used to read
  // as documents or lines a person added.
  const a = narrative.analyze(parser.buildModel({
    source: 'viewmodel',
    info: { auditKeys: 'INST\u00000078099-1', screenId: 'FS300200' },
    batches: [{
      date: '8/6/2026 9:42:14 AM', user: 'sjohnson', screen: 'FS300200',
      tableData: [
        { TableName: 'Appointment Tax Detail', Operation: 'Created', Columns: [
          cell('Service Order Type', 'INST'), cell('Appointment Nbr.', '0078099-1'),
          cell('Tax ID', 'OREGON'), cell('Taxable Amount', 635.80)]},
        { TableName: 'FSAppointmentEmployee', Operation: 'Created', Columns: [
          cell('Service Order Type', 'INST'), cell('Appointment Nbr.', '0078099-1'),
          cell('Line Nbr.', 1), cell('Staff Member', '245        ')]},
        { TableName: 'Appointment', Operation: 'Created', Columns: [
          cell('Service Order Type', 'INST'), cell('Appointment Nbr.', '0078099-1'),
          cell('Customer', 'C0000042')]},
        { TableName: 'Service Order', Operation: 'Modified', Columns: [
          pair('Order Type', null, 'INST'), pair('Order Nbr.', null, '0078099'),
          pair('Scheduled Service Count', null, 2)]},
      ],
    }],
  }));
  const said = a.actions.flatMap(x => x.sentences.map(s => s.text));

  assert.equal(a.entity, 'Appointment');
  assert.ok(said.includes('created appointment 0078099-1 — customer C0000042'), said.join(' | '));
  // Was "created fsappointmentemployee 0078099-1".
  assert.ok(said.includes('assigned staff member 245 to the appointment'), said.join(' | '));
  assert.ok(!said.some(t => /fsappointmentemployee/i.test(t)), said.join(' | '));
  // Was "added 0078099-1" — the tax breakdown row read as a line someone added.
  assert.ok(!said.some(t => /^added 0078099-1$/.test(t)), said.join(' | '));
  // The service order's own keys arrive blank -> value and must not be edits.
  assert.ok(!said.some(t => /Order Nbr\./.test(t)), said.join(' | '));
});

// ---------------------------------------------------------------------------
// Tuned against three live 26R1 captures: a customer (AR303000 C0000015), an
// SO invoice (SO303000 AR083220) and a vendor bill (AP301000 AP006763).

const NUL = String.fromCharCode(0);
const US = String.fromCharCode(31);

test('audit keys drop the repeated copy AR and AP documents ship', () => {
  // "INV<NUL>AP006763<US>INV<NUL>AP006763" — the whole key set, twice. Split
  // on the NUL alone it became three values with a separator buried in one of
  // them, so no table's keys could ever match and the audited record fell back
  // to whichever table appeared most.
  assert.deepEqual(
    parser.auditKeyValues({ auditKeys: 'INV' + NUL + 'AP006763' + US + 'INV' + NUL + 'AP006763' }),
    ['INV', 'AP006763']);
  // The single-group form still parses the same way.
  assert.deepEqual(parser.auditKeyValues({ auditKeys: 'INV' + NUL + 'AP006763' }),
    ['INV', 'AP006763']);
});

test('a column blank on both rows is not the record key', () => {
  // Live AR and AP lines carry DiscountsAppliedToLine as null on both sides.
  // Read as the key it became the row's whole identity, and the real keys were
  // then reported as edits somebody made by hand.
  const t = parser.normalizeTable({
    TableName: 'PO Line', Operation: 'Modified',
    Columns: [pair('Order Type', null, 'RO'), pair('Order Nbr.', null, 'PO001040'),
      pair('Line Nbr.', null, 1), pair('DiscountsAppliedToLine', null, null),
      pair('Closed', null, true)],
  });
  assert.deepEqual(Object.keys(t.keys), []);
  assert.ok(!t.changes.some(c => c.field === 'DiscountsAppliedToLine'),
    JSON.stringify(t.changes));
});

// A vendor bill raised from a purchase receipt, then released.
const billed = {
  source: 'viewmodel',
  info: { screenId: 'AP301000', auditKeys: 'INV' + NUL + 'AP006763' + US + 'INV' + NUL + 'AP006763' },
  batches: [
    { date: '8/11/2026 2:54:31 PM', user: 'kbroeg', screen: 'AP301000', tableData: [
      { TableName: 'Purchase Order', Operation: 'Modified', Columns: [
        pair('Type', 'Normal', 'Normal'), pair('Order Nbr.', 'PO001040', 'PO001040'),
        pair('Status', null, 'Closed')]},
      { TableName: 'PO Line', Operation: 'Modified', Columns: [
        pair('Order Type', null, 'RO'), pair('Order Nbr.', null, 'PO001040'),
        pair('Line Nbr.', null, 1), pair('DiscountsAppliedToLine', null, null),
        pair('Closed', null, true)]},
      { TableName: 'Document', Operation: 'Modified', Columns: [
        pair('Type', 'Bill', 'Bill'), pair('Reference Nbr.', 'AP006763', 'AP006763'),
        pair('Status', 'Balanced', 'Open')]},
    ]},
    { date: '8/11/2026 2:54:25 PM', user: 'kbroeg', screen: 'AP301000', tableData: [
      { TableName: 'Document', Operation: 'Modified', Columns: [
        pair('Type', 'Bill', 'Bill'), pair('Reference Nbr.', 'AP006763', 'AP006763'),
        pair('Hold', true, false), pair('Approved', false, true),
        pair('Status', 'On Hold', 'Balanced')]},
    ]},
    { date: '8/11/2026 2:54:21 PM', user: 'kbroeg', screen: 'AP301000', tableData: [
      { TableName: 'AP Transactions', Operation: 'Created', Columns: [
        cell('Tran. Type', 'Bill'), cell('Reference Nbr.', 'AP006763'),
        cell('Line Nbr.', 1), cell('Inventory ID', '900-AL26031001   '),
        cell('UOM', 'EA'), cell('Quantity', 1.00), cell('Unit Cost', 6138.00)]},
      { TableName: 'AP document', Operation: 'Created', Columns: [
        cell('Type', 'Bill'), cell('Reference Nbr.', 'AP006763'),
        cell('Terms', 'NET30'), cell('Payment Method', 'CHECK')]},
      { TableName: 'Document', Operation: 'Created', Columns: [
        cell('Type', 'Bill'), cell('Reference Nbr.', 'AP006763'),
        cell('Vendor', 'V0000118   '), cell('Currency', 'USD'),
        cell('Description', 'Ruby Valley HL7 (Inland Imaging)'),
        cell('Hold', true), cell('Status', 'On Hold')]},
    ]},
  ],
};

const bill = narrative.analyze(parser.buildModel(billed));
const billSaid = bill.actions.flatMap(a => a.sentences.map(s => s.text));

test('a bill is called a bill, not the register table it lives in', () => {
  // The audited table is the bare "Document"; the row's own Type is the word
  // anybody uses for it.
  assert.equal(bill.entity, 'Document');
  assert.equal(bill.entityName, 'Bill');
  assert.equal(bill.record, 'AP006763');
  assert.match(bill.overview, /on Bill AP006763 by kbroeg/);
  assert.ok(billSaid.includes('took the bill off hold'), billSaid.join(' | '));
  assert.ok(!billSaid.some(t => /the document/.test(t)), billSaid.join(' | '));
});

test('one document written through several projections is announced once', () => {
  const created = billSaid.filter(t => /^created /.test(t));
  assert.equal(created.length, 1, billSaid.join(' | '));
  assert.equal(created[0],
    'created bill AP006763 — vendor V0000118, description Ruby Valley HL7 (Inland Imaging)');
  // The thinner projection is consumed, not re-announced.
  assert.ok(!billSaid.some(t => /ap document/i.test(t)), billSaid.join(' | '));
});

test('AP and AR transaction rows are lines, not documents of their own', () => {
  assert.ok(billSaid.includes('added line 1 — 1 EA of 900-AL26031001 @ $6,138.00'),
    billSaid.join(' | '));
  assert.ok(!billSaid.some(t => /created ap transactions/i.test(t)), billSaid.join(' | '));
  // And the line's real keys stayed keys.
  assert.ok(!billSaid.some(t => /Order Nbr\.|Line Nbr\./.test(t)), billSaid.join(' | '));
  assert.ok(billSaid.includes('ticked Closed on line 1 of PO001040'), billSaid.join(' | '));
});

test('a status moved on another document says which one', () => {
  // Releasing the bill closes the purchase order behind it. Two bare "moved
  // status" lines in one action leave no way to tell them apart.
  assert.ok(billSaid.includes('moved status on purchase order PO001040 from (blank) to Closed'),
    billSaid.join(' | '));
  assert.ok(billSaid.includes('moved status from Balanced to Open'), billSaid.join(' | '));
});

test('creating a document and releasing it are two actions, not one', () => {
  // Both saves write Document.Hold and Document.Status seconds apart. Merged,
  // the bill read as though it had been born already released.
  const create = bill.actions.findIndex(a => a.sentences.some(s => /^created bill/.test(s.text)));
  const release = bill.actions.findIndex(a => a.sentences.some(s => /off hold/.test(s.text)));
  assert.ok(create !== -1 && release !== -1, billSaid.join(' | '));
  assert.notEqual(create, release);
  assert.ok(create < release, 'creation should come first');
});

test('a hold and the release two seconds later stay separate', () => {
  // One save puts an invoice on hold, the next takes it off. Coalesced, the
  // action contradicted itself: "put the invoice on hold" next to "took the
  // invoice off hold", and "approved" next to "un-ticked Approved".
  const held = {
    source: 'viewmodel',
    info: {
      screenId: 'SO303000',
      auditKeys: 'INV' + NUL + 'AR083220' + US + 'INV' + NUL + 'AR083220',
    },
    batches: [
      { date: '8/14/2026 11:57:57 AM', user: 'aconroy', screen: 'SO303000', tableData: [
        { TableName: 'AR Document', Operation: 'Modified', Columns: [
          pair('Type', 'Invoice', 'Invoice'), pair('Reference Nbr.', 'AR083220', 'AR083220'),
          pair('Hold', true, false), pair('Approved', false, true),
          pair('Status', 'On Hold', 'Balanced')]},
      ]},
      { date: '8/14/2026 11:57:55 AM', user: 'aconroy', screen: 'SO303000', tableData: [
        { TableName: 'AR Document', Operation: 'Modified', Columns: [
          pair('Type', 'Invoice', 'Invoice'), pair('Reference Nbr.', 'AR083220', 'AR083220'),
          pair('Hold', false, true), pair('Approved', true, false),
          pair('Status', 'Balanced', 'On Hold')]},
      ]},
    ],
  };
  const a = narrative.analyze(parser.buildModel(held));
  assert.equal(a.entityName, 'Invoice');
  assert.equal(a.actions.length, 2, 'two saves, two actions');
  for (const action of a.actions) {
    const text = action.sentences.map(s => s.text).join(' | ');
    assert.ok(!(/on hold/.test(text) && /off hold/.test(text)),
      'an action contradicts itself: ' + text);
  }
  // Clearing Approved is what a hold does; it is not a second event.
  const onHold = a.actions.find(x => x.sentences.some(s => /put the invoice on hold/.test(s.text)));
  assert.ok(!onHold.sentences.some(s => /un-ticked Approved/.test(s.text)),
    onHold.sentences.map(s => s.text).join(' | '));
});

// The same customer opened from AR303000: two tables, one key, one record.
const customer = {
  source: 'viewmodel',
  info: { screenId: 'AR303000', auditKeys: 'C0000015' },
  batches: [
    { date: '8/14/2026 11:52:47 AM', user: 'aconroy', screen: 'AR303000', tableData: [
      { TableName: 'Customer', Operation: 'Modified', Columns: [
        pair('Customer ID', 'C0000015   ', 'C0000015   '),
        pair('Print Statements', false, true),
        pair('Send Statements by Email', true, false)]},
    ]},
    { date: '8/14/2026 11:52:40 AM', user: 'aconroy', screen: 'AR303000', tableData: [
      { TableName: 'Customer', Operation: 'Modified', Columns: [
        pair('Customer ID', 'C0000015   ', 'C0000015   '),
        pair('Print Statements', null, false),
        pair('Send Statements by Email', null, true)]},
    ]},
    { date: '8/14/2026 11:52:10 AM', user: 'aconroy', screen: 'AR303000', tableData: [
      { TableName: 'Address', Operation: 'Modified', Columns: [
        pair('Address ID', null, 104146), pair('RevisionID', null, 6)]},
      { TableName: 'Customer', Operation: 'Modified', Columns: [
        pair('Customer ID', null, 'C0000015   '),
        pair('Customer Class', null, 'DEFAULT')]},
    ]},
    { date: '8/14/2026 11:51:50 AM', user: 'aconroy', screen: 'AR303000', tableData: [
      { TableName: 'Business Account', Operation: 'Modified', Columns: [
        pair('Customer ID', 'C0000015   ', 'C0000015   '),
        pair('Customer Status', 'Credit Hold', 'Active')]},
    ]},
  ],
};

const cust = narrative.analyze(parser.buildModel(customer));
const custSaid = cust.actions.flatMap(a => a.sentences.map(s => s.text));

test('the customer screen names the customer, not the business account', () => {
  // Both tables carry the identical key, so the keys cannot choose between
  // them and the older Business Account row won on batch order alone.
  assert.equal(cust.entity, 'Customer');
  // Acumatica space-pads fixed-width keys; the padding used to reach the title.
  assert.equal(cust.record, 'C0000015');
  assert.match(cust.overview, /on Customer C0000015 by aconroy/);
});

test('a customer coming off credit hold reads as an event', () => {
  assert.ok(custSaid.includes('took the customer off credit hold — now Active'),
    custSaid.join(' | '));
  assert.ok(!custSaid.some(t => /off on hold/.test(t)), custSaid.join(' | '));
});

test('the address revision bumped by saving a customer is not an edit', () => {
  assert.ok(!custSaid.some(t => /Address ID|RevisionID/.test(t)), custSaid.join(' | '));
});

test('on a master record a plain field edit reaches the summary', () => {
  // A customer has no workflow to summarise, so leaving generic edits out of
  // the summary left a live history summarising five of its seven actions.
  const bullets = cust.highlights.map(h => h.text).join(' | ');
  assert.equal(cust.highlights.length, cust.actions.filter(a => !a.isSilent).length);
  assert.match(bullets, /Customer Class/);
  assert.match(bullets, /Print Statements/);
});

test('statement preferences ticked then un-ticked never share an action', () => {
  for (const action of cust.actions) {
    const text = action.sentences.map(s => s.text).join(' | ');
    for (const field of ['Print Statements', 'Send Statements by Email']) {
      // Anchored: "un-ticked X" contains "ticked X" as a substring.
      const ticked = new RegExp('(^|[^-])\\bticked ' + field).test(text);
      const unticked = text.includes('un-ticked ' + field);
      assert.ok(!(ticked && unticked), 'an action contradicts itself: ' + text);
    }
  }
});
