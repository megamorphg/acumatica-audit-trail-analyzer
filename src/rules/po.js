// Purchase Order / Purchase Receipt rule pack.

(function (global, factory) {
  const ns = (global.AcuAudit = global.AcuAudit || {});
  ns.rules = ns.rules || { all: [] };
  factory(ns);
})(typeof globalThis !== 'undefined' ? globalThis : self, function (AcuAudit) {
  'use strict';

  function numeric(v) {
    if (typeof v === 'number') return v;
    const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : null;
  }

  AcuAudit.rules.all.push(
    {
      // A PO raised from a service order writes its number and status back
      // onto the originating lines. Announcing each of those columns is four
      // sentences that say nothing a reader wanted.
      id: 'po.linked-to-source',
      priority: 79,
      when: ctx => {
        const c = ctx.changed('PO Nbr.');
        return !!c && AcuAudit.dictionary.isBlank(c.from) &&
          !AcuAudit.dictionary.isBlank(c.to);
      },
      say: ctx => {
        const dict = AcuAudit.dictionary;
        const line = ctx.to('PO Line Nbr.');
        return 'linked ' + ctx.record + ' to purchase order ' +
          dict.formatValue(ctx.to('PO Nbr.')) +
          (dict.isBlank(line) ? '' : ' line ' + dict.formatValue(line));
      },
      consumes: ['PO Nbr.', 'PO Line Nbr.', 'PO Status', 'Order Type'],
    },
    {
      // The PO's own status change is already said; the copies Acumatica
      // stamps onto every linked service order and appointment line are the
      // same event, not several.
      id: 'po.status-mirrored',
      scope: 'batch',
      priority: 77,
      when: ctx => {
        const po = ctx.table('Purchase Order');
        return !!po && !!po.changed('Status') &&
          ctx.tables.some(t => t !== po && !!t.changed('PO Status'));
      },
      // No sentence: the PO's own status rule says it. Consuming keeps the
      // mirrors out of the generic fallback while leaving them in the field
      // detail, which is built from the raw tables.
      consumes: ctx => {
        const po = ctx.table('Purchase Order');
        for (const t of ctx.tables) {
          if (t !== po) t.consume(['PO Status']);
        }
      },
    },
    {
      // Acumatica records "we are not going to email this" rather than an
      // email event, and "ticked Do Not Email" makes a reader work that out.
      id: 'po.suppress-print-email',
      priority: 51,
      when: ctx => ctx.turnedOn('Do Not Print') || ctx.turnedOn('Do Not Email'),
      say: ctx => 'marked the ' + ctx.tableLabel + ' as not to be ' +
        (ctx.turnedOn('Do Not Print') ? 'printed' : 'emailed'),
      consumes: ['Do Not Print', 'Do Not Email'],
    },
    {
      id: 'po.unit-cost',
      priority: 75,
      when: ctx => !!ctx.changed('Unit Cost'),
      say: ctx => {
        const dict = AcuAudit.dictionary;
        return 'changed the unit cost on ' + ctx.record + ' from ' +
          dict.formatMoney(ctx.from('Unit Cost')) + ' to ' + dict.formatMoney(ctx.to('Unit Cost'));
      },
      consumes: ['Unit Cost', 'Ext. Cost', 'Extended Cost'],
    },
    {
      id: 'po.received',
      priority: 78,
      when: ctx => {
        const c = ctx.changed('Received Qty.');
        if (!c) return false;
        const a = numeric(c.from);
        const b = numeric(c.to);
        return a !== null && b !== null && b > a;
      },
      say: ctx => {
        const dict = AcuAudit.dictionary;
        return 'received ' + dict.formatValue(ctx.to('Received Qty.')) + ' on ' + ctx.record;
      },
      consumes: ['Received Qty.', 'Open Qty.', 'Base Open Qty.'],
    },
    {
      id: 'po.receipt-released',
      priority: 76,
      when: ctx => /Receipt/i.test(ctx.tableName) &&
        !!ctx.changed('Status') && /released/i.test(String(ctx.to('Status'))),
      say: ctx => 'released the purchase receipt',
      consumes: ['Status', 'Released'],
    },
    {
      id: 'po.promised-date',
      priority: 65,
      when: ctx => !!ctx.changed('Promised On'),
      say: ctx => {
        const dict = AcuAudit.dictionary;
        return 'moved the promised date on ' + ctx.record + ' from ' +
          dict.formatValue(ctx.from('Promised On')) + ' to ' + dict.formatValue(ctx.to('Promised On'));
      },
      consumes: ['Promised On'],
    }
  );
});
