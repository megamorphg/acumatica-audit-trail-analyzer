// Cross-entity rules. These carry most of the weight — every audited document
// in Acumatica gets created, held, approved, cancelled, printed and completed
// the same way, so entity packs only need to add their signature actions.
//
// A rule matches either a single audited table (`scope: 'table'`, the default)
// or a whole batch (`scope: 'batch'`, for actions that span header and lines).
// Fields listed in `consumes` are absorbed by the rule so the generic
// field-by-field fallback doesn't repeat them.

(function (global, factory) {
  const ns = (global.AcuAudit = global.AcuAudit || {});
  ns.rules = ns.rules || { all: [] };
  factory(ns);
})(typeof globalThis !== 'undefined' ? globalThis : self, function (AcuAudit) {
  'use strict';

  // Fields worth quoting when a record is created, in the order they read
  // best. `label` prefixes the value; `paren` instead appends it in brackets
  // to the previous part, which keeps values that contain commas — contact
  // names especially — from turning the sentence into a word salad.
  const CREATE_SUMMARY = {
    'Sales Order': [
      { field: 'Customer', label: 'customer' },
      { field: 'Contact', paren: true },
      { field: 'Customer PO', label: 'customer PO' },
    ],
    'Purchase Order': [
      { field: 'Vendor', label: 'vendor' },
      { field: 'Location', paren: true },
      { field: 'Promised On', label: 'promised' },
    ],
    'Invoice': [
      { field: 'Customer', label: 'customer' },
      { field: 'Amount', label: 'amount' },
      { field: 'Due Date', label: 'due' },
    ],
    'Customer': [
      { field: 'Customer Name', label: 'name' },
      { field: 'Class ID', label: 'class' },
      { field: 'Terms', label: 'terms' },
    ],
    'Vendor': [
      { field: 'Vendor Name', label: 'name' },
      { field: 'Class ID', label: 'class' },
      { field: 'Terms', label: 'terms' },
    ],
    'Stock Item': [
      { field: 'Description', label: 'description' },
      { field: 'Item Class', label: 'class' },
      { field: 'Base UOM', label: 'base UOM' },
    ],
    'Service Order': [
      { field: 'Customer', label: 'customer' },
      { field: 'Contact', paren: true },
    ],
    'Appointment': [
      { field: 'Customer', label: 'customer' },
      { field: 'Scheduled Date', label: 'scheduled' },
    ],
  };

  const DEFAULT_CREATE_SUMMARY = [
    { field: 'Customer', label: 'customer' },
    { field: 'Vendor', label: 'vendor' },
    { field: 'Description', label: 'description' },
  ];

  /** The first of `fields` the row actually carries a value for. */
  function pick(ctx, ...fields) {
    for (const f of fields) {
      const v = ctx.value(f);
      if (v !== undefined && !AcuAudit.dictionary.isBlank(v)) return v;
    }
    return undefined;
  }

  /** The document number a header row belongs to, however its key is named. */
  function documentKey(keys) {
    const k = (keys || {})['Reference Nbr.'] || (keys || {})['Order Nbr.'] ||
      (keys || {})['Receipt Nbr.'];
    return k == null ? '' : String(k).trim();
  }

  function quote(ctx, specs) {
    const dict = AcuAudit.dictionary;
    const parts = [];
    for (const spec of specs) {
      const v = ctx.value(spec.field);
      if (v === undefined || dict.isBlank(v)) continue;
      const text = dict.formatValue(v);
      if (spec.paren && parts.length) parts[parts.length - 1] += ' (' + text + ')';
      else parts.push((spec.label ? spec.label + ' ' : '') + text);
    }
    return parts;
  }

  /** "2 EA of HBX 480J10 @ $19.63 ($39.26)" */
  function describeLine(ctx) {
    const dict = AcuAudit.dictionary;
    const qty = ctx.value('Quantity');
    const uom = ctx.value('UOM');
    const item = ctx.value('Inventory ID');
    // A purchase or AP line prices itself in cost, not price: an AP301000
    // capture's bill line carried Unit Cost 6138.00 and no Unit Price at all,
    // so the line read as a bare quantity of an inventory ID.
    const price = pick(ctx, 'Unit Price', 'Unit Cost');
    const ext = pick(ctx, 'Ext. Price', 'Ext. Cost');
    const desc = ctx.value('Line Description') || ctx.value('Description');

    let s = '';
    if (!dict.isBlank(qty)) s += dict.formatValue(qty) + (dict.isBlank(uom) ? '' : ' ' + dict.formatValue(uom));
    if (!dict.isBlank(item)) s += (s ? ' of ' : '') + dict.formatValue(item);
    // Brackets rather than quotes — item descriptions are full of inch marks.
    if (!dict.isBlank(desc)) s += ' (' + dict.formatValue(desc) + ')';
    if (!dict.isBlank(price)) s += ' @ ' + dict.formatMoney(price);
    if (!dict.isBlank(ext) && !dict.isBlank(price)) s += ' = ' + dict.formatMoney(ext);
    return s.trim();
  }

  AcuAudit.rules.all.push(
    // ---------- creation / deletion ----------
    {
      // One document row, audited once per DAC projection. Raising a vendor
      // bill records a Created row for both "AP document" and "Document";
      // billing a service order records one for "SO Invoice" and one for
      // "AR Document" — same reference number, same event, announced twice.
      //
      // The projection carrying the most columns is the one with the customer,
      // the vendor and the description in it, so it keeps the sentence and the
      // thinner copies are consumed in silence. Their fields stay in the
      // detail view; only the duplicate announcement goes.
      id: 'common.doc-projection',
      priority: 93,
      when: ctx => {
        if (ctx.operation !== 'Created' || ctx.isDetail) return false;
        const mine = documentKey(ctx.keys);
        if (!mine) return false;
        let best = null;
        ctx.batch.tables.forEach((t, i) => {
          if (t.operation !== 'Created') return;
          if (AcuAudit.dictionary.isDetailTable(t.tableName)) return;
          if (documentKey(t.keys) !== mine) return;
          if (!best || t.values.length > best.size) best = { index: i, size: t.values.length };
        });
        return !!best && best.index !== ctx.tableIdx;
      },
      consumes: 'all',
    },
    {
      id: 'common.doc-created',
      priority: 90,
      when: ctx => ctx.operation === 'Created' && ctx.isHeader,
      say: ctx => {
        const bits = quote(ctx, CREATE_SUMMARY[ctx.tableName] || DEFAULT_CREATE_SUMMARY);
        const who = bits.length ? ' — ' + bits.join(', ') : '';
        // "created sales order SO004417", not "created a sales order SO004417"
        return ctx.record
          ? 'created ' + ctx.tableLabel + ' ' + ctx.record + who
          : 'created ' + ctx.tableArticle + ' ' + ctx.tableLabel + who;
      },
      consumes: 'all',
    },
    {
      id: 'common.line-added',
      priority: 90,
      when: ctx => ctx.operation === 'Created' && ctx.isDetail,
      say: ctx => {
        const detail = describeLine(ctx);
        return 'added ' + ctx.record + (detail ? ' — ' + detail : '');
      },
      consumes: 'all',
    },
    {
      id: 'common.doc-deleted',
      priority: 90,
      when: ctx => ctx.operation === 'Deleted' && ctx.isHeader,
      say: ctx => 'deleted ' + ctx.tableArticle + ' ' + ctx.tableLabel + ' ' + ctx.record,
      consumes: 'all',
    },
    {
      id: 'common.line-removed',
      priority: 90,
      when: ctx => ctx.operation === 'Deleted' && ctx.isDetail,
      say: ctx => {
        const item = ctx.value('Inventory ID');
        return 'removed ' + ctx.record +
          (AcuAudit.dictionary.isBlank(item) ? '' : ' (' + AcuAudit.dictionary.formatValue(item) + ')');
      },
      consumes: 'all',
    },

    // ---------- workflow flags ----------
    {
      id: 'common.printed',
      priority: 50,
      when: ctx => ctx.turnedOn('Printed'),
      say: ctx => 'printed the ' + ctx.tableLabel,
      consumes: ['Printed'],
    },
    {
      id: 'common.emailed',
      priority: 50,
      when: ctx => ctx.turnedOn('Emailed'),
      say: ctx => 'emailed the ' + ctx.tableLabel,
      consumes: ['Emailed'],
    },
    // Putting a document on hold moves its status to On Hold, and Acumatica
    // audits both. Quoting the status as well says the same thing twice, so
    // the hold takes the status with it — but only when the status transition
    // really is the hold, never when an unrelated status change rode along.
    //
    // Putting one on hold clears Approved the same way, and a live AR invoice
    // read "put the invoice on hold; un-ticked Approved" for a single button
    // press. Only the clearing is absorbed: an approval is something a person
    // did, and PO301000 showed it is worth its own sentence even when it
    // arrives in the same save as the release.
    {
      id: 'common.hold-on',
      priority: 55,
      when: ctx => ctx.turnedOn('Hold'),
      say: ctx => 'put the ' + ctx.tableLabel + ' on hold',
      consumes: ctx => ['Hold']
        .concat(/hold/i.test(String(ctx.to('Status') || '')) ? ['Status'] : [])
        .concat(ctx.turnedOff('Approved') ? ['Approved'] : []),
    },
    {
      id: 'common.hold-off',
      priority: 55,
      when: ctx => ctx.turnedOff('Hold'),
      say: ctx => 'took the ' + ctx.tableLabel + ' off hold',
      consumes: ctx => /hold/i.test(String(ctx.from('Status') || ''))
        ? ['Hold', 'Status'] : ['Hold'],
    },
    {
      id: 'common.approved',
      priority: 55,
      when: ctx => ctx.turnedOn('Approved'),
      say: ctx => 'approved the ' + ctx.tableLabel,
      consumes: ['Approved'],
    },
    {
      id: 'common.credit-hold',
      priority: 55,
      when: ctx => ctx.turnedOn('Credit Hold'),
      say: ctx => 'placed the ' + ctx.tableLabel + ' on credit hold',
      // Same shape as the plain hold: the status moves to Credit Hold in the
      // same save, and saying both is one event told twice.
      consumes: ctx => /credit hold/i.test(String(ctx.to('Status') || ''))
        ? ['Credit Hold', 'Status'] : ['Credit Hold'],
    },
    {
      id: 'common.cancelled',
      priority: 60,
      when: ctx => ctx.turnedOn('Cancelled') || ctx.turnedOn('Canceled'),
      // On a detail row this is a line being cancelled, and "cancelled the po
      // line" is neither grammatical nor specific about which one.
      say: ctx => ctx.isDetail
        ? 'cancelled ' + ctx.record
        : 'cancelled the ' + ctx.tableLabel,
      // Cancelling a line closes it, so Acumatica sets Completed in the same
      // breath — "cancelled line 1; closed line 1" is one event, said twice.
      consumes: ['Cancelled', 'Canceled', 'Completed', 'Closed'],
    },
    {
      id: 'common.completed',
      priority: 40,
      when: ctx => ctx.turnedOn('Completed'),
      say: ctx => ctx.isDetail
        ? 'closed ' + ctx.record
        : 'completed the ' + ctx.tableLabel,
      consumes: ['Completed'],
    },
    {
      // Line-level status churn is high-volume — "set line 3 to Completed"
      // rather than "changed Line Status on line 3 from Scheduled to
      // Completed" keeps a busy document readable.
      id: 'common.line-status',
      priority: 46,
      when: ctx => !!ctx.changed('Line Status'),
      say: ctx => 'set ' + ctx.record + ' to ' +
        AcuAudit.dictionary.formatValue(ctx.to('Line Status')),
      consumes: ['Line Status'],
    },
    {
      id: 'common.status',
      priority: 45,
      when: ctx => !!ctx.changed('Status'),
      say: ctx => {
        const dict = AcuAudit.dictionary;
        // A save routinely moves a status on a document other than the one
        // being audited — releasing a bill closes the purchase order behind
        // it — and two bare "moved status" lines in one action leave the
        // reader with no way to tell which document each belongs to.
        const where = ctx.tableName === ctx.entity ? ''
          : ' on ' + ctx.tableLabel + ' ' + ctx.record;
        return 'moved status' + where + ' from ' + dict.formatValue(ctx.from('Status')) +
          ' to ' + dict.formatValue(ctx.to('Status'));
      },
      consumes: ['Status'],
    },

    // ---------- line economics ----------
    {
      id: 'common.discount-percent',
      priority: 70,
      when: ctx => !!ctx.changed('Discount Percent'),
      say: ctx => {
        const dict = AcuAudit.dictionary;
        return 'changed the discount on ' + ctx.record + ' from ' +
          dict.formatValue(ctx.from('Discount Percent')) + '% to ' +
          dict.formatValue(ctx.to('Discount Percent')) + '%';
      },
      consumes: ['Discount Percent', 'Discount Amount', 'Manual Discount', 'Discount Code'],
    },
    {
      id: 'common.unit-price',
      priority: 70,
      when: ctx => !!ctx.changed('Unit Price'),
      say: ctx => {
        const dict = AcuAudit.dictionary;
        return 'changed the unit price on ' + ctx.record + ' from ' +
          dict.formatMoney(ctx.from('Unit Price')) + ' to ' +
          dict.formatMoney(ctx.to('Unit Price'));
      },
      consumes: ['Unit Price', 'Manual Price', 'Ext. Price'],
    },
    {
      id: 'common.quantity',
      priority: 70,
      when: ctx => !!ctx.changed('Quantity'),
      say: ctx => {
        const dict = AcuAudit.dictionary;
        return 'changed the quantity on ' + ctx.record + ' from ' +
          dict.formatValue(ctx.from('Quantity')) + ' to ' +
          dict.formatValue(ctx.to('Quantity'));
      },
      consumes: ['Quantity', 'Ext. Price'],
    }
  );

  AcuAudit.rules.helpers = {
    describeLine, quote, documentKey, CREATE_SUMMARY, DEFAULT_CREATE_SUMMARY,
  };
});
