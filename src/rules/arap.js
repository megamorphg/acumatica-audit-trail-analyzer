// AR / AP document rule pack — invoices, bills, payments.

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
      id: 'arap.released',
      priority: 76,
      when: ctx => ctx.isHeader && !!ctx.changed('Status') &&
        /^released$/i.test(String(ctx.to('Status')).trim()),
      say: ctx => 'released the ' + ctx.tableLabel,
      consumes: ['Status', 'Released'],
    },
    {
      id: 'arap.voided',
      priority: 77,
      when: ctx => ctx.isHeader && !!ctx.changed('Status') &&
        /void/i.test(String(ctx.to('Status'))),
      say: ctx => 'voided the ' + ctx.tableLabel,
      consumes: ['Status', 'Voided'],
    },
    {
      id: 'arap.paid-in-full',
      priority: 78,
      when: ctx => {
        const bal = ctx.changed('Unpaid Balance') || ctx.changed('Balance');
        if (!bal) return false;
        const to = numeric(bal.to);
        const from = numeric(bal.from);
        return to === 0 && from !== null && from > 0;
      },
      say: ctx => 'paid the ' + ctx.tableLabel + ' in full',
      consumes: ['Unpaid Balance', 'Balance', 'Paid Amount', 'Status'],
    },
    {
      id: 'arap.amount',
      priority: 72,
      when: ctx => !!ctx.changed('Amount'),
      say: ctx => {
        const dict = AcuAudit.dictionary;
        const where = ctx.isDetail ? ' on ' + ctx.record : '';
        return 'changed the amount' + where + ' from ' + dict.formatMoney(ctx.from('Amount')) +
          ' to ' + dict.formatMoney(ctx.to('Amount'));
      },
      consumes: ['Amount'],
    },
    {
      id: 'arap.due-date',
      priority: 65,
      when: ctx => !!ctx.changed('Due Date'),
      say: ctx => {
        const dict = AcuAudit.dictionary;
        return 'moved the due date from ' + dict.formatValue(ctx.from('Due Date')) +
          ' to ' + dict.formatValue(ctx.to('Due Date'));
      },
      consumes: ['Due Date', 'Cash Discount Date'],
    },
    {
      id: 'arap.terms',
      priority: 64,
      when: ctx => !!ctx.changed('Terms'),
      say: ctx => {
        const dict = AcuAudit.dictionary;
        return 'changed payment terms from ' + dict.formatValue(ctx.from('Terms')) +
          ' to ' + dict.formatValue(ctx.to('Terms'));
      },
      consumes: ['Terms'],
    }
  );
});
