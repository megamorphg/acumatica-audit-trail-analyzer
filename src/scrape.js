// DOM fallback for when the view-model can't be reached.
//
// Selectors are taken straight from the Acumatica frontend sources
// (FrontendSources/screen/src/screens/SM/SM205540/SM205540.html and .scss):
//
//   qp-data-feed#dfAuditHistoryBatches
//     feed-item                              one audited batch
//       .batches-container-header            Date / Screen / User fieldsets
//       .table-header    -> <b>TableName</b> Operation
//       .table-container
//         .column-container
//           table.table-body
//             tr > td.column-header          the column name
//             tr > td.value.red|.green       old / new value
//
// Booleans render as <qp-icon imagesrc="control@GridCheck|GridUncheck">.
//
// Caveat worth knowing: the feed is virtualized, so this path only sees what
// is currently rendered. It exists as a safety net, not as the primary route.

(function (global, factory) {
  const ns = (global.AcuAudit = global.AcuAudit || {});
  factory(ns);
})(typeof globalThis !== 'undefined' ? globalThis : self, function (AcuAudit) {
  'use strict';

  const FEED = 'qp-data-feed#dfAuditHistoryBatches';
  const COLOR_GREEN = 1;
  const COLOR_RED = 2;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function isPresent() {
    return !!document.querySelector(FEED);
  }

  function clickable(el) {
    if (!el) return null;
    return el.querySelector('button, input[type="button"], a') || el;
  }

  /** Collapsed batches render nothing at all, so expand before reading. */
  async function expandAll() {
    const btn = document.querySelector('#btn_expand') ||
      Array.from(document.querySelectorAll('qp-button'))
        .find(b => /^expand all$/i.test((b.getAttribute('caption') || b.textContent || '').trim()));
    if (!btn) return;
    try {
      clickable(btn).click();
    } catch (e) { /* ignore */ }
    await sleep(300);
  }

  /** Scroll the virtualized feed so more items render. */
  async function scrollThrough() {
    const feed = document.querySelector(FEED);
    const scroller = feed &&
      (feed.querySelector('feed-body') || feed.querySelector('feed') || feed);
    if (!scroller) return;
    let previous = -1;
    for (let pass = 0; pass < 30; pass++) {
      const count = document.querySelectorAll(FEED + ' feed-item').length;
      if (count === previous) break;
      previous = count;
      try {
        scroller.scrollTop = scroller.scrollHeight;
      } catch (e) { /* ignore */ }
      await sleep(200);
    }
  }

  function cellFrom(td) {
    const icon = td.querySelector('qp-icon');
    if (icon) {
      const src = icon.getAttribute('imagesrc') || icon.getAttribute('imageSrc') || '';
      if (/GridUncheck/i.test(src)) return { Value: false, Color: colorOf(td) };
      if (/GridCheck/i.test(src)) return { Value: true, Color: colorOf(td) };
    }
    const text = (td.textContent || '').replace(/\s+/g, ' ').trim();
    return { Value: text === '' ? null : text, Color: colorOf(td) };
  }

  function colorOf(td) {
    if (td.classList.contains('green')) return COLOR_GREEN;
    if (td.classList.contains('red')) return COLOR_RED;
    return 0;
  }

  function readTableBlock(headerEl, containerEl) {
    const bold = headerEl.querySelector('b');
    const tableName = bold ? bold.textContent.trim() : '';
    // The operation is the bare text alongside the bolded table name.
    let operation = '';
    headerEl.childNodes.forEach(n => {
      if (n.nodeType === Node.TEXT_NODE) operation += n.nodeValue;
    });
    operation = operation.replace(/\s+/g, ' ').trim();

    const columns = [];
    containerEl.querySelectorAll('.column-container table.table-body').forEach(tbl => {
      const rows = Array.from(tbl.rows);
      if (!rows.length) return;
      const headerCell = rows[0].querySelector('td.column-header') || rows[0].cells[0];
      const header = headerCell ? headerCell.textContent.replace(/\s+/g, ' ').trim() : '';
      if (!header) return;
      const cells = rows.slice(1)
        .map(r => r.querySelector('td'))
        .filter(Boolean)
        .map(cellFrom);
      columns.push({ Header: header, Align: 0, Cells: cells });
    });

    return { TableName: tableName, Operation: operation, Columns: columns };
  }

  /**
   * Acumatica renders a field's caption more than once inside the fieldset
   * (visible label plus an accessibility copy), so reading textContent yields
   * "SCREEN ID SCREEN ID PO301000". Strip any run of leading label text.
   */
  function stripLabels(text, labels) {
    let out = String(text || '').replace(/\s+/g, ' ').trim();
    for (const label of labels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp('^(?:' + escaped + '\\s*:?\\s*)+', 'i'), '').trim();
    }
    return out;
  }

  function readBatchHeader(item) {
    // The fieldset ids are stable per SM205540.html (A1 = Date, B1 = Screen,
    // C1 = User) but repeat across items, so query within the item.
    const pick = (suffix, labels) => {
      const el = item.querySelector('[id^="fsAuditHistoryBatches' + suffix + '"]');
      if (!el) return '';
      // Prefer the input's own value — it never carries the caption.
      const input = el.querySelector('input, textarea, select');
      if (input && input.value) return String(input.value).replace(/\s+/g, ' ').trim();
      return stripLabels(el.textContent, labels);
    };

    let date = pick('A1', ['Date']);
    let screen = pick('B1', ['Screen ID', 'ScreenID', 'Screen']);
    let user = pick('C1', ['User Name', 'Username', 'User']);

    if (!date || !user || !screen) {
      // Fall back to reading the header line as text.
      const header = item.querySelector('.batches-container-header');
      const text = header ? (header.innerText || header.textContent || '') : '';
      const m = text.match(/Date:\s*(.+?)\s+User:\s*(\S+)\s+Screen:\s*(\S+)/i) ||
        text.match(/Date:\s*(.+?)\s+Screen:\s*(\S+)\s+User:\s*(\S+)/i);
      if (m) {
        date = date || m[1].trim();
        if (/User:/i.test(text.slice(0, text.indexOf('Screen:') + 1))) {
          user = user || m[2];
          screen = screen || m[3];
        } else {
          screen = screen || m[2];
          user = user || m[3];
        }
      }
    }

    return { date, user, screen };
  }

  function readInfo() {
    const text = document.body ? (document.body.innerText || '') : '';
    const grab = label => {
      const m = text.match(new RegExp(label + ':\\s*(.+)'));
      return m ? m[1].trim() : null;
    };
    const fromUrl = name => {
      try {
        return new URLSearchParams(location.search).get(name) || null;
      } catch (e) {
        return null;
      }
    };
    return {
      auditKeys: fromUrl('AuditKeys'),
      rowKeys: fromUrl('RowKeys'),
      createdBy: grab('Created By'),
      createdOn: grab('Created On'),
      createdThrough: grab('Created Through'),
      lastModifiedBy: grab('Last Modified By'),
      lastModifiedOn: grab('Last Modified On'),
      lastModifiedThrough: grab('Last Modified Through'),
      changesLimitReached: /number of audit changes has reached the limit/i.test(text),
    };
  }

  async function collect() {
    if (!isPresent()) return { ok: false, reason: 'feed-not-found' };

    await expandAll();
    await scrollThrough();

    const batches = [];
    document.querySelectorAll(FEED + ' feed-item').forEach(item => {
      const head = readBatchHeader(item);
      const tableData = [];

      const headers = Array.from(item.querySelectorAll('.table-header'));
      for (const headerEl of headers) {
        // The .table-container is the header's next meaningful sibling.
        let container = headerEl.nextElementSibling;
        while (container && !container.classList.contains('table-container')) {
          container = container.nextElementSibling;
        }
        if (!container) continue;
        const block = readTableBlock(headerEl, container);
        if (block.TableName) tableData.push(block);
      }

      batches.push({ date: head.date, user: head.user, screen: head.screen, tableData });
    });

    if (!batches.length) return { ok: false, reason: 'no-batches-rendered' };

    return {
      ok: true,
      payload: { source: 'dom', info: readInfo(), batches },
    };
  }

  AcuAudit.scrape = { collect, isPresent, expandAll };
});
