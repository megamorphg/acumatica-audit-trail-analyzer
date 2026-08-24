// Field Services rule pack — service orders and appointments.
//
// Table names confirmed from PX.Objects.FS/Descriptor/TX.cs:
//   "Service Order", "Appointment",
//   "Service Order Item Detail", "Appointment Item Detail"

(function (global, factory) {
  const ns = (global.AcuAudit = global.AcuAudit || {});
  ns.rules = ns.rules || { all: [] };
  factory(ns);
})(typeof globalThis !== 'undefined' ? globalThis : self, function (AcuAudit) {
  'use strict';

  // Appointment statuses read much better as verbs than as "moved status to X".
  const STATUS_VERBS = [
    [/^in process$/i, 'started work on'],
    [/^completed$/i, 'completed'],
    [/^closed$/i, 'closed'],
    [/^cancell?ed$/i, 'cancelled'],
    [/^on hold$/i, 'put on hold'],
    [/^not started$/i, 'reopened'],
  ];

  function statusVerb(status) {
    const s = String(status == null ? '' : status).trim();
    for (const [re, verb] of STATUS_VERBS) {
      if (re.test(s)) return verb;
    }
    return null;
  }

  const IS_FS = ctx => /^(Service Order|Appointment)/.test(ctx.tableName);

  /** "OT (Overtime)" beats either half on its own. */
  function describeItem(ctx) {
    const dict = AcuAudit.dictionary;
    const id = ctx.value('Service') || ctx.value('Inventory ID');
    const desc = ctx.value('Description');
    if (dict.isBlank(id)) return dict.isBlank(desc) ? '' : dict.formatValue(desc);
    if (dict.isBlank(desc)) return dict.formatValue(id);
    const idText = dict.formatValue(id);
    const descText = dict.formatValue(desc);
    return idText === descText ? idText : idText + ' (' + descText + ')';
  }

  function itemQuantity(ctx) {
    return ctx.value('Quantity') !== undefined ? ctx.value('Quantity')
      : ctx.value('Estimated Quantity');
  }

  function addedLine(ctx) {
    const dict = AcuAudit.dictionary;
    const item = describeItem(ctx);
    const qty = itemQuantity(ctx);
    let s = 'added ' + ctx.record;
    if (item) s += ' — ' + item;
    if (!dict.isBlank(qty)) s += ' × ' + dict.formatValue(qty);
    return s;
  }

  const MIRROR_TABLES = ['Service Order Item Detail', 'Appointment Item Detail'];

  /**
   * The two halves of an FS line mirror, ordered so the one belonging to the
   * document being audited is kept and the other is suppressed. Falls back to
   * keeping the service order line, which is the one that outlives the
   * appointment.
   */
  // On a Modified row the line number is a key, not a change, so it is not in
  // values() — reading it there silently returned undefined and paired nothing.
  function lineNbr(t) {
    return t.keys['Line Nbr.'] != null ? t.keys['Line Nbr.'] : t.value('Line Nbr.');
  }

  function mirrorPair(ctx) {
    const [so, appt] = MIRROR_TABLES.map(n => ctx.table(n));
    if (!so || !appt) return null;
    const a = lineNbr(so);
    const b = lineNbr(appt);
    if (a == null || b == null || String(a) !== String(b)) return null;
    const doc = String(ctx.docRecord || '').trim();
    if (doc && String(appt.keys['Appointment Nbr.'] || '').trim() === doc) {
      return { keep: appt, drop: so };
    }
    return { keep: so, drop: appt };
  }

  /**
   * Fields the mirror row changed to the same destination as its twin.
   *
   * Matched on the new value alone, not the whole diff: completing a line
   * moves the appointment row from In Process and the service order row from
   * Scheduled, both to Completed. That is one action told from two documents'
   * points of view, and requiring the old values to agree would let it through
   * as two. The suppressed row is still in the field detail either way.
   */
  function mirroredFields(pair) {
    return pair.drop.changes
      .filter(d => pair.keep.changes.some(k =>
        k.field === d.field && AcuAudit.parser.sameValue(k.to, d.to)))
      .map(d => d.field);
  }

  AcuAudit.rules.all.push(
    {
      // Every edit to a service order line is written to its appointment line
      // as well, so a single change to the unit cost arrives as two rows.
      // Only fields the mirror agrees on are suppressed — anything it does
      // differently still gets said.
      id: 'fs.line-mirrored',
      scope: 'batch',
      priority: 94,
      when: ctx => {
        const pair = mirrorPair(ctx);
        if (!pair || pair.keep.operation !== 'Modified' ||
          pair.drop.operation !== 'Modified') return false;
        return mirroredFields(pair).length > 0;
      },
      consumes: ctx => {
        const pair = mirrorPair(ctx);
        pair.drop.consume(mirroredFields(pair));
      },
    },
    {
      // Adding a line to an appointment writes the mirror line on the service
      // order (and vice versa), so both tables show a Created row for the same
      // user action. Left alone that reads as two separate additions.
      id: 'fs.line-added-both',
      scope: 'batch',
      priority: 93,
      when: ctx => {
        const appt = ctx.table('Appointment Item Detail');
        const so = ctx.table('Service Order Item Detail');
        if (!appt || !so) return false;
        if (appt.operation !== 'Created' || so.operation !== 'Created') return false;
        // Both line numbers must be present, or two unrelated rows would pair
        // up on undefined === undefined.
        const a = appt.value('Line Nbr.');
        const b = so.value('Line Nbr.');
        return a != null && b != null && String(a) === String(b);
      },
      say: ctx => {
        // The service-order row carries the plain Quantity; the appointment row
        // only has the estimated/actual split, so prefer the former.
        const so = ctx.table('Service Order Item Detail');
        return addedLine(so);
      },
      // Returning nothing tells the engine this rule handled its own
      // consumption — it must take only the two mirrored tables, not the whole
      // batch, which usually also carries real header changes.
      consumes: ctx => {
        ctx.table('Appointment Item Detail').consume('all');
        ctx.table('Service Order Item Detail').consume('all');
      },
    },
    {
      // The staff assigned to an appointment. Acumatica audits this as the bare
      // class name FSAppointmentEmployee, so without a rule it reads as its own
      // generic line addition.
      id: 'fs.staff-added',
      priority: 92,
      when: ctx => ctx.tableName === 'FSAppointmentEmployee' && ctx.operation === 'Created',
      say: ctx => {
        const dict = AcuAudit.dictionary;
        const who = ctx.value('Staff Member');
        return dict.isBlank(who)
          ? 'assigned a staff member to the appointment'
          : 'assigned staff member ' + dict.formatValue(who) + ' to the appointment';
      },
      consumes: 'all',
    },
    {
      // The tax engine's own breakdown rows. Nobody adds one by hand, and
      // "added 0078099-1" is what they read as otherwise. Consumed silently —
      // the header's tax total already carries the story, and the rows stay in
      // the field detail.
      id: 'fs.tax-detail',
      priority: 92,
      when: ctx => /Tax Detail$/i.test(ctx.tableName),
      consumes: 'all',
    },
    {
      // Field service's own bookkeeping when a service order is billed: one
      // row linking the order to the invoice it produced. Read as a record it
      // announces itself as "added 0077749" in the middle of an invoice's
      // history — the invoice creation two lines below already says it.
      id: 'fs.bill-history',
      priority: 92,
      when: ctx => ctx.tableName === 'FSBillHistory',
      consumes: 'all',
    },
    {
      id: 'fs.status-verb',
      priority: 82,
      when: ctx => IS_FS(ctx) && ctx.isHeader && !!ctx.changed('Status') &&
        statusVerb(ctx.to('Status')) !== null,
      say: ctx => statusVerb(ctx.to('Status')) + ' the ' + ctx.tableLabel,
      consumes: ['Status'],
    },
    {
      id: 'fs.rescheduled',
      priority: 86,
      when: ctx => IS_FS(ctx) &&
        (!!ctx.changed('Scheduled Date') || !!ctx.changed('Scheduled Start Time')),
      say: ctx => {
        const dict = AcuAudit.dictionary;
        const c = ctx.changed('Scheduled Date') || ctx.changed('Scheduled Start Time');
        return 'rescheduled the ' + ctx.tableLabel + ' from ' +
          dict.formatValue(c.from) + ' to ' + dict.formatValue(c.to);
      },
      consumes: ['Scheduled Date', 'Scheduled Start Time', 'Scheduled End Time',
        'Estimated Duration'],
    },
    {
      id: 'fs.staff-assigned',
      priority: 84,
      when: ctx => IS_FS(ctx) &&
        (!!ctx.changed('Staff Member') || !!ctx.changed('Employee')),
      say: ctx => {
        const dict = AcuAudit.dictionary;
        const c = ctx.changed('Staff Member') || ctx.changed('Employee');
        return dict.isBlank(c.from)
          ? 'assigned ' + dict.formatValue(c.to) + ' to the ' + ctx.tableLabel
          : 'reassigned the ' + ctx.tableLabel + ' from ' + dict.formatValue(c.from) +
            ' to ' + dict.formatValue(c.to);
      },
      consumes: ['Staff Member', 'Employee'],
    },
    {
      id: 'fs.actual-time',
      priority: 60,
      when: ctx => IS_FS(ctx) &&
        (!!ctx.changed('Actual Duration') || !!ctx.changed('Actual Start Time')),
      say: ctx => {
        const dict = AcuAudit.dictionary;
        const dur = ctx.changed('Actual Duration');
        if (!dur) {
          return 'logged actual start time of ' + dict.formatValue(ctx.to('Actual Start Time'));
        }
        // The header total and the line that moved it both change, so say which
        // is which — otherwise a batch reads "logged actual duration of 2h;
        // logged actual duration of 1h" with nothing to tell them apart.
        return ctx.isDetail
          ? 'logged ' + dict.formatDuration(dur.to) + ' on ' + ctx.record
          : 'logged actual duration of ' + dict.formatDuration(dur.to) +
            ' on the ' + ctx.tableLabel;
      },
      // Log Actual Duration and Appointment Duration are FS's own mirrors of
      // the time just logged, so quoting them as well says the same edit three
      // times over.
      consumes: ['Actual Duration', 'Actual Start Time', 'Actual End Time',
        'Log Actual Duration', 'Appointment Duration'],
    },
    {
      id: 'fs.service-added',
      priority: 91,
      when: ctx => /Item Detail$/.test(ctx.tableName) && ctx.operation === 'Created',
      say: addedLine,
      consumes: 'all',
    }
  );
});
