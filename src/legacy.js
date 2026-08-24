// Adapter for the classic-UI audit window, Frames/Audit.aspx.
//
// Before the Aurelia rewrite, the "Audit History" action opened a standalone
// WebForms page — no SM205540, no view-model, no data feed. Instances on older
// builds still use it, so this sits beside bridge.js (modern view-model) and
// scrape.js (modern DOM) as a third acquisition path behind the same contract.
//
// Structure, from Frames/Audit.aspx and Controls/AuditItem.ascx(.cs):
//
//   h1#auditTitle                    "Audit History: Sales Order"
//   div#caption                      the record's key fields
//   div#panelHolder table.placeholder Created By / Through / On, Last Modified …
//   div#placeholder
//     div[id$=_pnlTraceItem]         one per batch
//       table.container
//         [id$=_txtDate] [id$=_txtUser] [id$=_txtScreen]
//         div[id$=_outputDiv]        collapsed with display:none
//           table[id$=_tblDetails]
//             caption row            <b>TableName</b> Operation
//             details row            one <table> per audited column
//
// Two things make this page easier than the modern one:
//
//   - Audit.aspx.cs server-renders every batch (`foreach (AuditBatch batch in
//     info)`), so there is no virtualization and no paging. Nothing can be
//     silently truncated the way the modern feed can.
//   - Collapsed batches are only display:none, so their content is still in
//     the DOM. No expanding needed — which matters, because ExpandAll() lives
//     in the page's world and a content script cannot call it.
//
// The one real difference from the modern markup: AuditItem.ascx.cs sets
// `oldValueCell.ForeColor = DarkRed` and `newValueCell.ForeColor = DarkGreen`,
// which ASP.NET renders as an inline style rather than a class. So old/new is
// read from the colour, not from .red/.green.

(function (global, factory) {
  const ns = (global.AcuAudit = global.AcuAudit || {});
  factory(ns);
})(typeof globalThis !== 'undefined' ? globalThis : self, function (AcuAudit) {
  'use strict';

  const COLOR_GREEN = 1; // new value
  const COLOR_RED = 2;   // old value

  // Chrome resolves an inline `color:DarkRed` to rgb() when read through
  // element.style, but leaves the name alone in the attribute. Match both.
  const RED = /darkred|rgb\(\s*139\s*,\s*0\s*,\s*0\s*\)/i;
  const GREEN = /darkgreen|rgb\(\s*0\s*,\s*100\s*,\s*0\s*\)/i;

  function text(el) {
    return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  function isPresent() {
    return !!(document.getElementById('placeholder') &&
      document.querySelector('[id$="_tblDetails"]'));
  }

  /** Old or new, from the cell's own inline colour. */
  function colorFromStyle(style) {
    const s = String(style || '');
    if (RED.test(s)) return COLOR_RED;
    if (GREEN.test(s)) return COLOR_GREEN;
    return 0;
  }

  function colorOf(td) {
    const inline = td.getAttribute ? td.getAttribute('style') : null;
    const resolved = td.style ? td.style.color : '';
    return colorFromStyle(inline) || colorFromStyle(resolved);
  }

  const ALIGN = { left: 0, center: 1, right: 2 };

  function alignOf(td) {
    if (!td) return 0;
    const a = String(td.getAttribute('align') || td.style.textAlign || '').toLowerCase();
    return ALIGN[a] !== undefined ? ALIGN[a] : 0;
  }

  /**
   * The rules match on the modern screen's vocabulary, so map the legacy
   * operation titles onto it. Anything unrecognised is returned blank rather
   * than guessed at — the parser then infers Created/Deleted from whether the
   * single value row is red or green, which is the same signal.
   */
  function normalizeOperation(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    if (/delet|remov/i.test(s)) return 'Deleted';
    if (/updat|modif|chang/i.test(s)) return 'Modified';
    if (/insert|creat|add|new/i.test(s)) return 'Created';
    return '';
  }

  /**
   * Booleans render through PXImage, which depending on the build is an <img>
   * or a sprite div carrying the icon name in an attribute or a class. Check
   * all three rather than betting on one.
   */
  function booleanFrom(td) {
    const probe = [
      td.innerHTML || '',
      td.getAttribute && td.getAttribute('icon') || '',
    ].join(' ');
    const img = td.querySelector && td.querySelector('img, [icon], [class*="Grid"]');
    const extra = img
      ? [img.getAttribute('src') || '', img.getAttribute('icon') || '',
        img.className || '', img.innerHTML || ''].join(' ')
      : '';
    const all = probe + ' ' + extra;
    if (/GridUncheck/i.test(all)) return false;
    if (/GridCheck/i.test(all)) return true;
    return undefined;
  }

  function cellFrom(td) {
    const bool = booleanFrom(td);
    if (bool !== undefined) return { Value: bool, Color: colorOf(td) };
    // A blank value is rendered as <br>, which leaves no text behind.
    const t = text(td);
    return { Value: t === '' ? null : t, Color: colorOf(td) };
  }

  /** One audited column: header row, then one or two value rows. */
  function readColumn(tbl) {
    const rows = Array.from(tbl.rows || []);
    if (rows.length < 2) return null;
    const header = text(rows[0].cells[0]);
    if (!header) return null;
    const cells = rows.slice(1)
      .map(r => r.cells[0])
      .filter(Boolean)
      .map(cellFrom);
    if (!cells.length) return null;
    return { Header: header, Align: alignOf(rows[1].cells[0]), Cells: cells };
  }

  /**
   * The caption row holds two labels: the audited table in bold, then the
   * operation. Both are ASP.NET Labels, so they render as spans with an inline
   * font-weight rather than a <b>.
   */
  function readCaption(row) {
    const parts = [];
    row.querySelectorAll('span, label, b, strong').forEach(el => {
      if (el.querySelector('span, label, b, strong')) return; // leaves only
      const t = text(el);
      if (!t) return;
      const style = el.getAttribute('style') || '';
      parts.push({
        text: t,
        bold: /font-weight\s*:\s*bold/i.test(style) || /^(B|STRONG)$/.test(el.tagName),
      });
    });

    if (!parts.length) {
      const raw = text(row);
      return { tableName: raw, operation: '' };
    }
    const boldIdx = parts.findIndex(p => p.bold);
    const nameIdx = boldIdx === -1 ? 0 : boldIdx;
    const tableName = parts[nameIdx].text;
    const operation = parts.filter((p, i) => i !== nameIdx).map(p => p.text).join(' ');
    return { tableName, operation };
  }

  /**
   * tblDetails alternates caption row / details row, one pair per audited
   * table. Rather than assuming the alternation holds, a row carrying nested
   * tables is the details for whichever caption came last.
   */
  function readDetails(tbl) {
    const out = [];
    let pending = null;
    for (const row of Array.from(tbl.rows || [])) {
      const nested = row.querySelectorAll('table');
      if (!nested.length) {
        pending = readCaption(row);
        continue;
      }
      if (!pending) continue;
      const columns = [];
      nested.forEach(t => {
        // Only leaf tables are columns; PXPanel can wrap them in another.
        if (t.querySelector('table')) return;
        const col = readColumn(t);
        if (col) columns.push(col);
      });
      if (columns.length) {
        out.push({
          TableName: pending.tableName,
          Operation: normalizeOperation(pending.operation),
          Columns: columns,
        });
      }
      pending = null;
    }
    return out;
  }

  // ---------- timezone ----------
  // AuditItem.ascx.cs prints the batch date with a bare Tag.Date.ToString(),
  // which is the stored UTC value, while Audit.aspx.cs prints the info panel
  // from AuditInfo.Panel, whose fields Acumatica has already converted to the
  // viewing user's timezone. The two disagree by that user's offset, so a
  // classic timeline reads hours out.
  //
  // We never need to know which timezone they are in. The page renders the
  // same instant both ways — the newest batch is the last modification, and
  // the oldest is the creation — so subtracting one from the other gives the
  // offset directly, whether that's -4, +5:30 or +12:45.

  const MAX_OFFSET_MINUTES = 14 * 60; // the largest real UTC offset
  const OFFSET_STEP = 15;             // India is +5:30, Nepal +5:45, Chatham +12:45
  const OFFSET_TOLERANCE = 1.5;       // minutes; the anchors are seconds apart at most

  /**
   * Minutes to subtract from a raw batch date, from one (converted, raw) pair.
   * Returns null when the pair can't be an offset — which is the signal that
   * the anchor assumption is wrong and nothing should be touched.
   */
  function deriveOffset(convertedText, rawText) {
    const parse = AcuAudit.parser.parseDate;
    const converted = parse(convertedText);
    const raw = parse(rawText);
    if (!converted || !raw) return null;

    const diff = (raw.getTime() - converted.getTime()) / 60000;
    if (!isFinite(diff) || Math.abs(diff) > MAX_OFFSET_MINUTES) return null;

    const rounded = Math.round(diff / OFFSET_STEP) * OFFSET_STEP;
    if (Math.abs(diff - rounded) > OFFSET_TOLERANCE) return null;
    return rounded;
  }

  function formatLocal(d) {
    const pad = n => String(n).padStart(2, '0');
    let h = d.getHours() % 12;
    if (h === 0) h = 12;
    return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear() + ' ' +
      h + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + ' ' +
      (d.getHours() >= 12 ? 'PM' : 'AM');
  }

  /**
   * Shift every batch onto the same clock the info panel uses.
   *
   * Both ends are anchored where possible. If they disagree, a DST boundary
   * fell between the record being created and last touched, so each batch takes
   * the offset of whichever anchor is nearer in time — which is right on both
   * sides of the transition without needing a timezone database.
   */
  function applyOffset(batches, info) {
    const parse = AcuAudit.parser.parseDate;
    const anchors = [];

    // Newest first, as the page renders them. Last-modified is the sturdier
    // anchor: truncation drops the oldest batches, never the newest.
    const newest = batches[0];
    const oldest = batches[batches.length - 1];
    const fromModified = newest && deriveOffset(info.lastModifiedOn, newest.date);
    const fromCreated = oldest && deriveOffset(info.createdOn, oldest.date);

    if (fromModified !== null && fromModified !== undefined) {
      anchors.push({ minutes: fromModified, at: parse(newest.date) });
    }
    if (fromCreated !== null && fromCreated !== undefined) {
      anchors.push({ minutes: fromCreated, at: parse(oldest.date) });
    }
    if (!anchors.length) {
      info.timeOffsetMinutes = null;
      info.timesAreRaw = true;
      return batches;
    }

    const pick = at => {
      let best = anchors[0];
      for (const a of anchors) {
        if (!a.at || !at) continue;
        if (Math.abs(at - a.at) < Math.abs(at - best.at)) best = a;
      }
      return best.minutes;
    };

    for (const b of batches) {
      const raw = parse(b.date);
      if (!raw) continue;
      const minutes = pick(raw);
      if (!minutes) continue;
      b.rawDate = b.date; // keep what the page literally said, for the dump
      b.date = formatLocal(new Date(raw.getTime() - minutes * 60000));
    }

    info.timeOffsetMinutes = anchors[0].minutes;
    info.timesAreRaw = false;
    return batches;
  }

  function readBatch(panel) {
    const pick = suffix => text(panel.querySelector('[id$="' + suffix + '"]'));
    const details = panel.querySelector('[id$="_tblDetails"]');
    return {
      date: pick('_txtDate'),
      user: pick('_txtUser'),
      screen: pick('_txtScreen'),
      tableData: details ? readDetails(details) : [],
    };
  }

  function readInfo() {
    const info = {
      createdBy: null, createdOn: null, createdThrough: null,
      lastModifiedBy: null, lastModifiedOn: null, lastModifiedThrough: null,
      changesLimitReached: false,
    };
    const LABELS = {
      'created by': 'createdBy',
      'created through': 'createdThrough',
      'created on': 'createdOn',
      'last modified by': 'lastModifiedBy',
      'last modified through': 'lastModifiedThrough',
      'last modified on': 'lastModifiedOn',
    };

    const holder = document.getElementById('panelHolder');
    if (holder) {
      holder.querySelectorAll('td').forEach(td => {
        const b = td.querySelector('b');
        if (!b) return;
        const label = text(b).replace(/:\s*$/, '').toLowerCase();
        const key = LABELS[label];
        if (!key) return;
        // The cell is "<b>Created By: </b>value" — drop the label it opens with.
        const whole = text(td);
        const value = whole.slice(text(b).length).trim();
        if (value) info[key] = value;
      });
    }

    // The classic page words this differently from the modern one.
    const body = document.body ? (document.body.innerText || document.body.textContent || '') : '';
    info.changesLimitReached =
      /limit for the number of audit changes has been reached/i.test(body) ||
      /number of audit changes has reached the limit/i.test(body);

    // "Audit History: Sales Order" names the audited table outright, which the
    // modern screen leaves us to infer from which table shows up most.
    const title = text(document.getElementById('auditTitle'));
    const m = title.match(/audit history\s*:\s*(.+)$/i);
    if (m && m[1]) info.entity = m[1].trim();

    return info;
  }

  async function collect() {
    if (!isPresent()) return { ok: false, reason: 'audit-frame-not-found' };

    const panels = Array.from(document.querySelectorAll('[id$="_pnlTraceItem"]'));
    const batches = panels
      .map(readBatch)
      .filter(b => b.tableData.length);

    if (!batches.length) return { ok: false, reason: 'no-batches-rendered' };

    const info = readInfo();
    applyOffset(batches, info);

    // Every batch is server-rendered into the page, so what we read is all
    // there is — worth stating, since the modern path cannot promise it.
    info.batchesLoaded = batches.length;
    info.batchesTotal = batches.length;
    info.batchesTruncated = false;

    return {
      ok: true,
      payload: { source: 'legacy', via: 'audit.aspx', loadedVia: 'server-rendered', info, batches },
    };
  }

  AcuAudit.legacy = {
    collect, isPresent,
    // Exported for tests: the decisions that are pure and worth pinning.
    colorFromStyle, normalizeOperation, deriveOffset, applyOffset, formatLocal,
  };
});
