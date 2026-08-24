// Sales Order rule pack.
//
// Three signature actions the generic engine can't read on its own:
//   - drop-ship flagging, which spreads across the line and the header
//   - shipment confirmation, which shows up as counters moving rather than as
//     anything resembling the word "shipped"
//   - tax recalculation, which fires on its own and would otherwise read as
//     eight separate meaningless total changes

(function (global, factory) {
  const ns = (global.AcuAudit = global.AcuAudit || {});
  ns.rules = ns.rules || { all: [] };
  factory(ns);
})(typeof globalThis !== 'undefined' ? globalThis : self, function (AcuAudit) {
  'use strict';

  // Fields Acumatica rewrites as part of a tax recalculation. Anything here is
  // allowed to change without the batch counting as a "real" user edit.
  const TAX_RECALC_FIELDS = [
    'Tax Is Up to Date', 'Order Total', 'Tax Total', 'Line Total',
    'Taxable Total', 'Tax Exempt Total', 'VAT Exempt Total', 'VAT Taxable Total',
    'Freight Tax Total', 'Premium Freight Price', 'Amount',
  ];

  const TAX_SIGNAL = /^(Tax Is Up to Date|Tax Total|Taxable Total|Tax Exempt Total|VAT (Exempt|Taxable) Total|IsOpenTaxValid|IsUnbilledTaxValid|Is.*TaxValid)$/;

  function numeric(v) {
    if (typeof v === 'number') return v;
    const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : null;
  }

  function increased(change) {
    if (!change) return false;
    const a = numeric(change.from);
    const b = numeric(change.to);
    return a !== null && b !== null && b > a;
  }

  AcuAudit.rules.all.push(
    // ---------- drop-ship ----------
    {
      id: 'so.dropship',
      priority: 80,
      when: ctx => ctx.tableName === 'Sales Order Line' && ctx.turnedOn('Mark for PO'),
      say: ctx => {
        const dict = AcuAudit.dictionary;
        const src = ctx.to('PO Source');
        const wh = ctx.to('Purchase Warehouse');
        let s = 'flagged ' + ctx.record + ' for ';
        s += dict.isBlank(src) ? 'purchasing' : dict.formatValue(src).toLowerCase() + ' purchasing';
        if (!dict.isBlank(wh)) s += ' (warehouse ' + dict.formatValue(wh) + ')';
        return s;
      },
      consumes: ['Mark for PO', 'PO Source', 'Purchase Warehouse', 'MarkforDS',
        'DiscountsAppliedToLine', 'Special Order'],
    },
    {
      id: 'so.dropship-header',
      priority: 79,
      when: ctx => ctx.tableName === 'Sales Order' && ctx.turnedOn('MarkforDS'),
      say: () => null, // the line-level rule already said it
      consumes: ['MarkforDS'],
    },

    // ---------- shipment confirmation ----------
    // Reads as counters moving: the line gains shipped quantity while the
    // header's shipment counter ticks up and the order closes.
    {
      id: 'so.shipment-confirmed',
      scope: 'batch',
      priority: 95,
      when: ctx => {
        const line = ctx.table('Sales Order Line');
        const head = ctx.table('Sales Order');
        if (!line || !head) return false;
        const shipped = increased(line.changed('Qty. On Shipments')) ||
          increased(line.changed('BaseShippedQty'));
        const headerMoved = increased(head.changed('ShipmentCntr')) ||
          (head.changed('Status') && /complet|closed|shipp/i.test(String(head.to('Status'))));
        return shipped && headerMoved;
      },
      say: ctx => {
        const dict = AcuAudit.dictionary;
        const line = ctx.table('Sales Order Line');
        const head = ctx.table('Sales Order');
        const qty = line.to('Qty. On Shipments') != null
          ? line.to('Qty. On Shipments') : line.to('BaseShippedQty');
        let s = 'confirmed a shipment — ' + dict.formatValue(qty) + ' of ' + line.record + ' shipped';
        const status = head.to('Status');
        if (status && /complet/i.test(String(status))) s += ', completing the order';
        else if (status) s += ', order now ' + dict.formatValue(status);
        return s;
      },
      consumes: 'all',
    },

    // ---------- tax recalculation ----------
    // Fires on its own save and would otherwise read as a wall of total
    // changes. Collapse it to one line, quoting the totals that moved.
    {
      id: 'so.tax-recalc',
      scope: 'batch',
      priority: 30,
      when: ctx => {
        const dict = AcuAudit.dictionary;
        let sawTaxSignal = false;
        let sawAny = false;
        for (const t of ctx.tables) {
          for (const c of t.changes) {
            sawAny = true;
            if (TAX_SIGNAL.test(c.field)) sawTaxSignal = true;
            const tier = dict.classifyField(c.field);
            const allowed = tier === dict.NOISE || tier === dict.SECONDARY ||
              TAX_RECALC_FIELDS.indexOf(c.field) !== -1;
            if (!allowed) return false;
          }
        }
        return sawAny && sawTaxSignal;
      },
      say: ctx => {
        const dict = AcuAudit.dictionary;
        const head = ctx.table('Sales Order') || ctx.tables[0];
        const total = head && head.changed('Order Total');
        const tax = head && head.changed('Tax Total');
        if (!total && !tax) {
          // Nothing moved but the validity flags — worth recording, not worth
          // putting in the headline story.
          return { text: 'system re-validated tax (no amounts changed)', lowSignal: true };
        }
        let s = 'system recalculated tax';
        if (total) {
          s += ' — order total ' + dict.formatMoney(total.from) + ' → ' + dict.formatMoney(total.to);
        }
        if (tax) {
          s += (total ? ' (tax ' : ' — tax ') + dict.formatMoney(tax.to) + ')';
          if (!total) s = s.replace(/\)$/, '');
        }
        return s;
      },
      consumes: 'all',
    },

    // ---------- shipment record ----------
    {
      id: 'so.shipment-created',
      priority: 92,
      when: ctx => /Shipment$/i.test(ctx.tableName) && ctx.operation === 'Created',
      say: ctx => 'created shipment ' + ctx.record,
      consumes: 'all',
    }
  );
});
