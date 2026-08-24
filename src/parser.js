// Normalizes raw SM205540 batches into an audit model.
//
// Input comes from either bridge.js (the Aurelia view-model, preferred) or
// scrape.js (DOM fallback) in this shape:
//
//   { info: {...}, batches: [ { date, user, screen, tableData } ] }
//
// where `tableData` is the JSON string Acumatica ships in the TableData field:
//
//   [{ TableName, Operation, Columns: [ { Header, Align, Cells: [ {Value, Color} ] } ] }]
//
// Cell colours are CellColor { default:0, green:1, red:2 } — green is the new
// value, red the old one (see SM205540.ts in the Acumatica frontend sources).
//
// This file is pure: no DOM, no chrome APIs, so it runs unchanged under node.

(function (global, factory) {
  const ns = (global.AcuAudit = global.AcuAudit || {});
  factory(ns);
})(typeof globalThis !== 'undefined' ? globalThis : self, function (AcuAudit) {
  'use strict';

  const COLOR_GREEN = 1; // new value
  const COLOR_RED = 2;   // old value

  // SM205540 joins a record's key columns with a NUL, and separates repeated
  // copies of the whole key set with a unit separator. Built from char codes
  // rather than written as escapes so both stay visible in a diff.
  const KEY_GROUP = new RegExp(String.fromCharCode(31) + '|%1f', 'i');
  const KEY_PART = new RegExp(String.fromCharCode(0) + '|%00', 'i');

  // ---------- dates ----------
  // Acumatica renders these in the user's culture, so M/D/YYYY vs D/M/YYYY is
  // genuinely ambiguous. We only use parsed dates for display and for the
  // coalescing gap — ordering comes from the feed itself, which Acumatica
  // already sorts newest-first, so a misread date can't scramble the timeline.
  function parseDate(text) {
    if (!text) return null;
    const s = String(text).trim();

    const m = s.match(
      /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*(AM|PM)?$/i
    );
    if (m) {
      let a = parseInt(m[1], 10);
      let b = parseInt(m[2], 10);
      const year = parseInt(m[3], 10);
      // If the first component can't be a month it must be day-first.
      const dayFirst = a > 12;
      const month = dayFirst ? b : a;
      const day = dayFirst ? a : b;
      let hour = m[4] ? parseInt(m[4], 10) : 0;
      const min = m[5] ? parseInt(m[5], 10) : 0;
      const sec = m[6] ? parseInt(m[6], 10) : 0;
      const ampm = (m[7] || '').toUpperCase();
      if (ampm === 'PM' && hour < 12) hour += 12;
      if (ampm === 'AM' && hour === 12) hour = 0;
      const d = new Date(year, month - 1, day, hour, min, sec);
      if (!isNaN(d.getTime())) return d;
    }

    const fallback = new Date(s);
    return isNaN(fallback.getTime()) ? null : fallback;
  }

  // ---------- cell helpers ----------
  function cellValue(cell) {
    if (cell === null || cell === undefined) return null;
    return Object.prototype.hasOwnProperty.call(cell, 'Value') ? cell.Value : cell;
  }

  function cellColor(cell) {
    if (cell && Object.prototype.hasOwnProperty.call(cell, 'Color')) return cell.Color;
    return 0;
  }

  // A plain decimal, with no leading zero that would make "0078097" and
  // "78097" compare equal as numbers.
  const PLAIN_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?$/;

  function decimals(s) {
    const dot = String(s).indexOf('.');
    return dot === -1 ? 0 : String(s).length - dot - 1;
  }

  // Compare two cell values the way a reader would, so 2 and "2.000000" are
  // the same value and don't get reported as a change.
  //
  // Acumatica also re-renders the same number at different precision across
  // saves — a discount goes from "66.666667" to "66.6667" without anybody
  // touching it. Comparing at the coarser of the two precisions collapses that
  // while still keeping a real edit: 18425.88 and 18425.89 are both 2 dp, so
  // they stay a change.
  function sameValue(a, b) {
    const fmt = AcuAudit.dictionary.formatValue;
    const fa = fmt(a);
    const fb = fmt(b);
    if (fa === fb) return true;

    if (PLAIN_NUMBER.test(fa) && PLAIN_NUMBER.test(fb)) {
      const places = Math.min(decimals(fa), decimals(fb));
      return parseFloat(fa).toFixed(places) === parseFloat(fb).toFixed(places);
    }
    return false;
  }

  // Acumatica renders a field's caption more than once inside its fieldset, so
  // depending on the acquisition path a value can arrive with the label glued
  // to the front: "SCREEN ID SCREEN ID PO301000", "User User sberger".
  // Cleaned here as well as at the source, so every path benefits.
  function stripCaption(value, labels) {
    let out = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    for (const label of labels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const stripped = out.replace(new RegExp('^(?:' + escaped + '\\s*:?\\s*)+', 'i'), '').trim();
      // Never strip the value away entirely — a user really could be "admin".
      if (stripped) out = stripped;
    }
    return out;
  }

  function parseTableData(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  // ---------- table normalization ----------
  function normalizeTable(td) {
    const tableName = String(td.TableName || td.tableName || '').trim();
    const operation = String(td.Operation || td.operation || '').trim();
    const columns = (td.Columns || td.columns || []).map(c => ({
      header: String(c.Header != null ? c.Header : c.header || '').trim(),
      cells: (c.Cells || c.cells || []).map(cell => ({
        value: cellValue(cell),
        color: cellColor(cell),
      })),
    })).filter(c => c.header);

    const rowCount = columns.reduce((n, c) => Math.max(n, c.cells.length), 0);
    const table = { tableName, operation, rowCount, keys: {}, changes: [], values: [] };

    if (rowCount >= 2) {
      // Modified: old row first (red), new row last (green).
      for (const col of columns) {
        const from = col.cells[0] ? col.cells[0].value : null;
        const to = col.cells[col.cells.length - 1] ? col.cells[col.cells.length - 1].value : null;
        if (sameValue(from, to)) {
          // Acumatica only emits changed columns plus the record keys, so a
          // column identical on both rows is a key — unless it is blank on
          // both rows, which identifies nothing. Live AR and AP lines carry
          // DiscountsAppliedToLine as null on both sides, and taken as a key
          // it became the row's whole identity: the real keys were then read
          // as edits, so a bill's audit reported somebody setting Order Nbr.
          // and Line Nbr. on a purchase order line by hand.
          if (!AcuAudit.dictionary.isBlank(from)) table.keys[col.header] = to;
        } else {
          table.changes.push({ field: col.header, from, to });
        }
      }
    } else {
      // Created or Deleted: a single row of values.
      for (const col of columns) {
        const cell = col.cells[0];
        const value = cell ? cell.value : null;
        const color = cell ? cell.color : 0;
        table.values.push({ field: col.header, value, color });
      }
      if (!operation) {
        const anyRed = columns.some(c => c.cells[0] && c.cells[0].color === COLOR_RED);
        table.operation = anyRed ? 'Deleted' : 'Created';
      }
    }

    return table;
  }

  // ---------- key resolution ----------
  // Single-row tables (Created/Deleted) can't reveal their keys by diffing, so
  // borrow the key set observed on a Modified table of the same name, falling
  // back to the curated map in dictionary.js.
  function resolveKeys(model) {
    const learned = {};
    for (const batch of model.batches) {
      for (const t of batch.tables) {
        if (t.rowCount >= 2 && Object.keys(t.keys).length) {
          learned[t.tableName] = learned[t.tableName] || Object.keys(t.keys);
        }
      }
    }

    // When a row is first linked to something — a service order line picking up
    // the PO that was just raised for it — Acumatica writes the key columns as
    // blank -> value. Diffing alone reads those as edits, which both loses the
    // record's identity ("on Service Order Item Detail" instead of "on line 3")
    // and spends a sentence apiece announcing that a key now holds its own
    // value. Only blank originals move, so a genuine re-key still reads as one.
    for (const batch of model.batches) {
      for (const t of batch.tables) {
        if (t.rowCount < 2) continue;
        const keyNames = learned[t.tableName] ||
          AcuAudit.dictionary.ENTITY_KEYS[t.tableName] || [];
        if (!keyNames.length) continue;
        t.changes = t.changes.filter(c => {
          if (keyNames.indexOf(c.field) === -1) return true;
          if (!AcuAudit.dictionary.isBlank(c.from)) return true;
          t.keys[c.field] = c.to;
          return false;
        });
      }
    }

    for (const batch of model.batches) {
      for (const t of batch.tables) {
        if (t.rowCount >= 2) continue;
        const keyNames = learned[t.tableName] ||
          AcuAudit.dictionary.ENTITY_KEYS[t.tableName] || [];
        for (const v of t.values) {
          if (keyNames.indexOf(v.field) !== -1) t.keys[v.field] = v.value;
        }
        // Nothing matched — fall back to leading identifier-ish columns so the
        // record still gets a label rather than reading as "record".
        if (!Object.keys(t.keys).length) {
          for (const v of t.values.slice(0, 4)) {
            if (/\b(Type|Nbr\.?|ID|Line Nbr\.)$/i.test(v.field)) t.keys[v.field] = v.value;
          }
        }
      }
    }
  }

  // ---------- entity ----------
  /**
   * The key values of the record the screen was opened for, from SM205540's
   * own AuditKeys field — "INST<NUL>0078099-1" for appointment 0078099-1.
   * Acumatica joins them with a NUL, so appointment 0078099-1 arrives as
   * "INST\u00000078099-1". Values are often space-padded.
   */
  function auditKeyValues(info) {
    const raw = info && (info.auditKeys || info.rowKeys);
    if (!raw) return [];
    // AR and AP documents arrive with the whole key set repeated, the copies
    // separated by a unit separator: a vendor bill reads
    // "INV<NUL>AP006763<US>INV<NUL>AP006763". Splitting on the NUL alone made
    // that three values, the middle one "AP006763<US>INV", which no table's
    // keys could ever match — so the audited record quietly fell back to being
    // guessed by counting tables. One group is the entire key.
    return String(raw).split(KEY_GROUP)[0]
      .split(KEY_PART)
      .map(s => s.trim())
      .filter(Boolean);
  }

  // The audited document type. Counting header tables and taking the most
  // frequent is only a fallback: opening an appointment that raised a purchase
  // order gives the PO two batches to the appointment's one, and the panel then
  // announces itself as the history of a document you didn't ask about.
  function inferEntity(model) {
    if (model.info && model.info.entity) return model.info.entity;
    const dict = AcuAudit.dictionary;

    const screenEntity = dict.screenEntity(model.info && model.info.screenId);

    // The screen told us which record it was opened for, so find the table
    // whose own keys are those values. Decisive, and needs no curated map.
    //
    // Matching is by how many key values line up rather than all-or-nothing,
    // because AuditKeys carries the stored value where the audit grid shows
    // the display one: an invoice is keyed "INV" but its Type column reads
    // "Invoice", so an exact comparison never fires on an AR or AP document.
    // Requiring the same *number* of keys still keeps a child row out, and
    // requiring at least one hit keeps an unrelated document out — the bill
    // above also audits purchase order PO001040, two keys, neither of them a
    // match.
    const wanted = auditKeyValues(model.info);
    if (wanted.length) {
      const candidates = [];
      for (const batch of model.batches) {
        for (const t of batch.tables) {
          if (dict.isDetailTable(t.tableName)) continue;
          const values = Object.keys(t.keys)
            .map(k => String(t.keys[k] == null ? '' : t.keys[k]).trim());
          // The whole key set, not a superset. A child row carries the parent's
          // keys plus its own line number — FSAppointmentEmployee holds
          // {INST, 0078099-1, 1} — so "contains all of them" picks the child.
          if (values.length !== wanted.length) continue;
          const hits = values.filter(v => wanted.indexOf(v) !== -1).length;
          if (!hits) continue;
          candidates.push({ name: t.tableName, exact: hits === values.length });
        }
      }
      if (candidates.length) {
        const exact = candidates.filter(c => c.exact);
        const pool = exact.length ? exact : candidates;
        // One row, audited under several DAC projections: a customer is both
        // "Customer" and "Business Account" under the identical key, an SO
        // invoice both "AR Document" and "SO Invoice". Nothing in the keys can
        // separate them, so the screen the audit was opened from does.
        const preferred = pool.find(c => c.name === screenEntity);
        return preferred ? preferred.name : pool[0].name;
      }
    }

    const counts = {};
    for (const batch of model.batches) {
      for (const t of batch.tables) {
        if (dict.isDetailTable(t.tableName)) continue;
        counts[t.tableName] = (counts[t.tableName] || 0) + 1;
      }
    }
    if (screenEntity && counts[screenEntity]) return screenEntity;
    let best = null;
    for (const name of Object.keys(counts)) {
      if (!best || counts[name] > counts[best]) best = name;
    }
    return best || 'record';
  }

  /**
   * Build the audit model. Batches are returned oldest-first.
   *
   * Acumatica's feed is ordered newest-first; we reverse the feed rather than
   * sorting on parsed dates, because feed order is authoritative and date text
   * is locale-ambiguous.
   */
  function buildModel(raw) {
    const input = raw || {};
    const rawBatches = Array.isArray(input.batches) ? input.batches : [];

    const model = {
      info: Object.assign({}, input.info),
      source: input.source || 'unknown',
      batches: rawBatches.map((b, index) => ({
        index,
        dateText: stripCaption(b.date, ['Date']),
        // The bridge ships both the user's formatted date and the raw
        // (usually ISO) value. Prefer the raw one — it isn't ambiguous about
        // whether 8/5 means August 5th or the 8th of May.
        date: (b.dateIso != null ? parseDate(b.dateIso) : null) ||
          parseDate(stripCaption(b.date, ['Date'])),
        user: stripCaption(b.user, ['User Name', 'Username', 'User']),
        screen: stripCaption(b.screen, ['Screen ID', 'ScreenID', 'Screen']),
        tables: parseTableData(b.tableData != null ? b.tableData : b.TableData)
          .map(normalizeTable)
          .filter(t => t.tableName),
      })),
    };

    resolveKeys(model);
    model.batches.reverse();
    model.entity = inferEntity(model);
    return model;
  }

  AcuAudit.parser = {
    buildModel,
    auditKeyValues,
    parseDate,
    parseTableData,
    normalizeTable,
    sameValue,
    COLOR_GREEN,
    COLOR_RED,
  };
});
