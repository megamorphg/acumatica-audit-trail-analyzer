// Master-data rule pack — customers, vendors, stock items.
//
// Master records are where audit trails get read for the least pleasant
// reasons ("who raised this customer's credit limit?"), so these get explicit
// direction-aware phrasing rather than a bare from/to.

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

  /** "raised" / "lowered" / "changed" depending on direction. */
  function direction(change) {
    const a = numeric(change.from);
    const b = numeric(change.to);
    if (a === null || b === null) return 'changed';
    if (b > a) return 'raised';
    if (b < a) return 'lowered';
    return 'changed';
  }

  function moneyMove(ctx, field, label) {
    const dict = AcuAudit.dictionary;
    const c = ctx.changed(field);
    return direction(c) + ' the ' + label + ' from ' +
      dict.formatMoney(c.from) + ' to ' + dict.formatMoney(c.to);
  }

  AcuAudit.rules.all.push(
    {
      // The field a customer's audit is usually opened to answer questions
      // about. Acumatica writes it on the Business Account row, whose label
      // would otherwise make this read "changed Customer Status" with no verb
      // and no place in the summary — so the account type comes from the field
      // name, not from the table the row happens to live in.
      id: 'masters.account-status',
      priority: 86,
      when: ctx => !!ctx.changed('Customer Status') || !!ctx.changed('Vendor Status'),
      say: ctx => {
        const dict = AcuAudit.dictionary;
        const field = ctx.changed('Customer Status') ? 'Customer Status' : 'Vendor Status';
        const who = field === 'Vendor Status' ? 'vendor' : 'customer';
        const c = ctx.changed(field);
        const to = dict.formatValue(c.to);
        if (dict.isBlank(c.from)) return 'set ' + who + ' status to ' + to;
        const from = dict.formatValue(c.from);
        if (/^credit hold$/i.test(to)) return 'placed the ' + who + ' on credit hold (was ' + from + ')';
        if (/hold$/i.test(to)) return 'put the ' + who + ' on hold (was ' + from + ')';
        if (/^active$/i.test(to) && /hold$/i.test(from)) {
          // "On Hold" already carries its own preposition, so lowercasing it
          // straight into the sentence gives "took the customer off on hold".
          return 'took the ' + who + ' off ' +
            from.toLowerCase().replace(/^on\s+/, '') + ' — now Active';
        }
        return 'changed ' + who + ' status from ' + from + ' to ' + to;
      },
      consumes: ['Customer Status', 'Vendor Status', 'Status'],
    },
    {
      id: 'masters.credit-limit',
      priority: 85,
      when: ctx => !!ctx.changed('Credit Limit'),
      say: ctx => moneyMove(ctx, 'Credit Limit', 'credit limit'),
      consumes: ['Credit Limit'],
    },
    {
      id: 'masters.credit-verification',
      priority: 84,
      when: ctx => !!ctx.changed('Credit Verification'),
      say: ctx => {
        const dict = AcuAudit.dictionary;
        return 'changed credit verification from ' + dict.formatValue(ctx.from('Credit Verification')) +
          ' to ' + dict.formatValue(ctx.to('Credit Verification'));
      },
      consumes: ['Credit Verification'],
    },
    {
      id: 'masters.default-price',
      priority: 80,
      when: ctx => !!ctx.changed('Default Price'),
      say: ctx => moneyMove(ctx, 'Default Price', 'default price'),
      consumes: ['Default Price'],
    },
    {
      id: 'masters.last-cost',
      priority: 79,
      when: ctx => !!ctx.changed('Last Cost'),
      say: ctx => moneyMove(ctx, 'Last Cost', 'last cost'),
      consumes: ['Last Cost'],
    },
    {
      id: 'masters.tax-zone',
      priority: 70,
      when: ctx => !!ctx.changed('Tax Zone'),
      say: ctx => {
        const dict = AcuAudit.dictionary;
        return 'changed the tax zone from ' + dict.formatValue(ctx.from('Tax Zone')) +
          ' to ' + dict.formatValue(ctx.to('Tax Zone'));
      },
      consumes: ['Tax Zone'],
    },
    {
      id: 'masters.class',
      priority: 68,
      when: ctx => !!ctx.changed('Class ID') || !!ctx.changed('Item Class'),
      say: ctx => {
        const dict = AcuAudit.dictionary;
        const f = ctx.changed('Class ID') ? 'Class ID' : 'Item Class';
        return 'moved from class ' + dict.formatValue(ctx.from(f)) +
          ' to ' + dict.formatValue(ctx.to(f));
      },
      consumes: ['Class ID', 'Item Class'],
    },
    {
      id: 'masters.item-status',
      priority: 67,
      when: ctx => !!ctx.changed('Item Status'),
      say: ctx => {
        const dict = AcuAudit.dictionary;
        return 'changed item status from ' + dict.formatValue(ctx.from('Item Status')) +
          ' to ' + dict.formatValue(ctx.to('Item Status'));
      },
      consumes: ['Item Status'],
    }
  );
});
