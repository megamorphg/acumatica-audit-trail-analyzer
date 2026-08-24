// The in-page reader. Builds the overlay from the analyzed audit.
//
// Every value that came out of Acumatica goes in via textContent, never
// innerHTML — audit data is arbitrary user-entered text (item descriptions,
// customer names) and must never be parsed as markup.

(function (global, factory) {
  const ns = (global.AcuAudit = global.AcuAudit || {});
  factory(ns);
})(typeof globalThis !== 'undefined' ? globalThis : self, function (AcuAudit) {
  'use strict';

  let backdrop = null;
  let state = null;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function button(label, onClick, className) {
    const b = el('button', className, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  function close() {
    if (state) clearTimeout(state.filterTimer);
    if (backdrop) backdrop.remove();
    backdrop = null;
    state = null;
    document.removeEventListener('keydown', onKeyDown, true);
  }

  function onKeyDown(e) {
    if (e.key !== 'Escape') return;
    e.stopPropagation();

    // This listener is on the document in the capture phase, so it is the only
    // place Escape can be handled — a listener on the input itself would never
    // get the chance to stop it. Clear the filter before closing the panel:
    // losing your place in a long history to a stray keypress is worse than
    // pressing Escape twice.
    const input = backdrop && backdrop.querySelector('#acu-audit-filter');
    if (input && input.value) {
      e.preventDefault();
      clearTimeout(state.filterTimer);
      input.value = '';
      applyFilter('');
      return;
    }
    close();
  }

  /**
   * Put the matched substrings in <mark> without ever letting audit text reach
   * innerHTML — the terms are split out and appended as separate text nodes.
   */
  function highlighted(text, className) {
    const node = el('span', className);
    const terms = (state && state.filtered && state.filtered.filter.terms) || [];
    const source = String(text == null ? '' : text);
    if (!terms.length) {
      node.textContent = source;
      return node;
    }

    const lower = source.toLowerCase();
    let cursor = 0;
    while (cursor < source.length) {
      let at = -1;
      let len = 0;
      for (const t of terms) {
        const found = lower.indexOf(t, cursor);
        if (found !== -1 && (at === -1 || found < at)) {
          at = found;
          len = t.length;
        }
      }
      if (at === -1) break;
      if (at > cursor) node.appendChild(document.createTextNode(source.slice(cursor, at)));
      node.appendChild(el('mark', null, source.slice(at, at + len)));
      cursor = at + len;
    }
    node.appendChild(document.createTextNode(source.slice(cursor)));
    return node;
  }

  function cell(tag, className, text) {
    const td = el(tag, className);
    td.appendChild(highlighted(text));
    return td;
  }

  // ---------- pieces ----------
  function renderFieldTable(detail, showSystem) {
    const dict = AcuAudit.dictionary;
    // While filtering, the rows here are already the matches — hiding one
    // behind the system-fields toggle would answer the search with a lie.
    const fields = (state && state.filtered)
      ? detail.fields
      : detail.fields.filter(f => showSystem || f.tier !== dict.NOISE);
    if (!fields.length) return null;

    const table = el('table', 'acu-fields');
    const head = el('tr');
    ['Field', 'From', 'To'].forEach(h => head.appendChild(el('th', null, h)));
    table.appendChild(head);

    for (const f of fields) {
      const tr = el('tr', 'acu-tier-' + f.tier);
      tr.appendChild(cell('td', 'acu-field', f.field));
      if (f.value !== undefined) {
        // A created or deleted row: one value, no diff.
        tr.appendChild(el('td', null, '—'));
        tr.appendChild(cell('td', 'acu-new', dict.formatValue(f.value)));
      } else {
        tr.appendChild(cell('td', 'acu-old', dict.formatValue(f.from)));
        tr.appendChild(cell('td', 'acu-new', dict.formatValue(f.to)));
      }
      table.appendChild(tr);
    }
    return table;
  }

  function renderAction(action, analysis, showSystem) {
    const wrap = el('div', 'acu-action' +
      (action.isSilent ? ' acu-silent' : '') +
      (action.screen && action.screen !== analysis.homeScreen ? ' acu-foreign' : ''));

    const head = el('div', 'acu-action-head');
    head.appendChild(el('span', 'acu-time',
      (action.dateText ? action.dateText + ' ' : '') + action.timeText));
    head.appendChild(el('span', 'acu-user', action.user || '(unknown user)'));
    head.appendChild(el('span', null, action.screenLabel));
    wrap.appendChild(head);

    const filtering = !!(state && state.filtered);

    if (action.sentences.length) {
      const ul = el('ul');
      for (const s of action.sentences) {
        const li = el('li', s.lowSignal ? 'acu-low' : null);
        li.appendChild(highlighted(s.text));
        ul.appendChild(li);
      }
      wrap.appendChild(ul);
    } else if (!filtering) {
      wrap.appendChild(el('p', 'acu-empty', 'System and derived fields only — nothing a user changed directly.'));
    }

    const details = el('details');
    const count = action.details.reduce((n, d) => n + d.fields.length, 0);
    // A search result is worthless collapsed, so open the matches by default.
    if (filtering) details.open = true;
    details.appendChild(el('summary', null,
      (filtering ? 'Matching fields (' : 'Field detail (') + count + ')'));
    let any = false;
    for (const d of action.details) {
      const table = renderFieldTable(d, showSystem);
      if (!table) continue;
      any = true;
      const caption = el('div', 'acu-table-caption');
      caption.appendChild(highlighted(d.tableName + ' ' + d.operation + ' — ' + d.record));
      details.appendChild(caption);
      details.appendChild(table);
    }
    if (!any && !filtering) {
      details.appendChild(el('p', 'acu-empty', 'All fields in this change are internal. Turn on "Show system fields" to see them.'));
    }
    wrap.appendChild(details);

    return wrap;
  }

  function renderBody() {
    const { showSystem } = state;
    // While a filter is active every downstream reader works off the narrowed
    // analysis, which has the same shape — so this stays one render path.
    const analysis = state.filtered || state.analysis;
    const filtering = !!state.filtered;
    const body = el('div');
    body.id = 'acu-audit-body';

    if (analysis.info.changesLimitReached) {
      body.appendChild(el('p', 'acu-warning',
        'Acumatica truncated this audit history — its change limit was reached, ' +
        'so the summary below may be incomplete. The full list is on ' +
        'Audit History by Screen (SM205530).'));
    }

    // Distinct from the limit above: this one means the feed reported more
    // batches than we managed to page in, so the shortfall is ours, not
    // Acumatica's. Silent truncation is the whole reason for saying so.
    if (analysis.info.batchesTruncated) {
      body.appendChild(el('p', 'acu-warning',
        'Only ' + analysis.info.batchesLoaded + ' of ' + analysis.info.batchesTotal +
        ' recorded batches could be read, so the summary below is partial.'));
    }

    const summary = el('div', 'acu-story');
    summary.appendChild(el('p', 'acu-overview', analysis.overview));
    if (analysis.highlights.length) {
      const ul = el('ul', 'acu-highlights');
      for (const h of analysis.highlights) {
        const li = el('li', h.foreign ? 'acu-foreign-line' : null);
        // A meta line above the text, rather than columns: each <li> would be
        // its own grid, so per-row columns would never line up with each other.
        const meta = el('div', 'acu-hl-meta');
        meta.appendChild(el('span', 'acu-hl-when',
          (h.dateText ? h.dateText + ' ' : '') + h.timeText));
        meta.appendChild(el('span', 'acu-hl-user', h.user || 'unknown user'));
        if (h.foreign) meta.appendChild(el('span', 'acu-hl-screen', h.screenLabel));
        li.appendChild(meta);
        li.appendChild(el('div', 'acu-hl-text', h.text));
        ul.appendChild(li);
      }
      summary.appendChild(ul);
    } else if (!filtering) {
      summary.appendChild(el('p', 'acu-empty',
        'No user-visible changes — everything recorded was a system recalculation.'));
    }
    body.appendChild(summary);

    // A match sitting in a field the classifier normally hides is exactly the
    // sort of thing a search is for, so say that it was included rather than
    // letting the toggle look like it was ignored.
    // The classic audit page prints batch times in UTC while its info panel
    // converts to the user's timezone. Normally the two together give us the
    // offset; when they can't, say so rather than showing times that are
    // silently hours out.
    if (analysis.info.timesAreRaw) {
      body.appendChild(el('p', 'acu-warning',
        'Times below are as the audit recorded them, which on this screen is ' +
        'usually UTC — the page did not give enough information to convert ' +
        'them to your timezone.'));
    }

    if (filtering && analysis.filter.hiddenMatches > 0) {
      body.appendChild(el('p', 'acu-note',
        analysis.filter.hiddenMatches + ' of the matches ' +
        (analysis.filter.hiddenMatches === 1 ? 'is' : 'are') +
        ' in a system field. Searching always looks at those, whatever ' +
        '"Show system fields" is set to.'));
    }

    if (analysis.actions.length) {
      body.appendChild(el('h2', 'acu-section-title',
        filtering ? 'Matches (oldest first)' : 'Full timeline (oldest first)'));
    }

    const visible = analysis.actions.filter(a => showSystem || !a.isSilent);
    if (!visible.length) {
      if (!filtering) body.appendChild(el('p', 'acu-empty', 'No changes recorded.'));
    } else {
      for (const action of visible) {
        body.appendChild(renderAction(action, analysis, showSystem));
      }
    }

    if (!showSystem && analysis.silentCount > 0) {
      body.appendChild(el('p', 'acu-empty',
        analysis.silentCount + ' further change' + (analysis.silentCount === 1 ? '' : 's') +
        ' touched only system fields and ' + (analysis.silentCount === 1 ? 'is' : 'are') +
        ' hidden. Turn on "Show system fields" to see them.'));
    }

    return body;
  }

  function refresh() {
    if (!backdrop) return;
    const panel = backdrop.querySelector('#acu-audit-panel');
    const old = panel.querySelector('#acu-audit-body');
    const next = renderBody();
    if (old) panel.replaceChild(next, old);
    else panel.appendChild(next);
  }

  function applyFilter(query) {
    state.query = query;
    state.filtered = AcuAudit.narrative.filterAnalysis(state.analysis, query);
    refresh();
  }

  function renderFilterBox() {
    const wrap = el('div', 'acu-filter');

    const input = document.createElement('input');
    input.type = 'search';
    input.id = 'acu-audit-filter';
    input.placeholder = 'Filter — e.g. unit cost, discount';
    input.setAttribute('aria-label', 'Filter this audit history');
    input.value = state.query || '';

    // Typing in a long history would re-render on every keystroke otherwise.
    // The handle lives on state so the Escape handler can cancel a pending
    // re-render rather than let it undo the clear.
    input.addEventListener('input', () => {
      clearTimeout(state.filterTimer);
      state.filterTimer = setTimeout(() => applyFilter(input.value), 150);
    });

    wrap.appendChild(input);
    wrap.appendChild(el('span', 'acu-filter-hint', 'commas mean "or"'));
    return wrap;
  }

  /**
   * @param analysis  output of AcuAudit.narrative.analyze
   * @param handlers  { onCopySummary, onCopyAi, onCopyDump, onToggleSystem }
   */
  function open(analysis, handlers) {
    close();
    state = {
      analysis,
      showSystem: !!(handlers && handlers.showSystem),
      query: '',
      filtered: null,
      filterTimer: null,
    };
    const h = handlers || {};

    backdrop = el('div');
    backdrop.id = 'acu-audit-backdrop';
    backdrop.addEventListener('click', e => {
      if (e.target === backdrop) close();
    });

    const panel = el('div');
    panel.id = 'acu-audit-panel';

    // --- header ---
    const header = el('header');
    header.appendChild(el('h1', null,
      'Audit history — ' + analysis.entity + (analysis.record ? ' ' + analysis.record : '')));

    const sub = el('div', 'acu-sub');
    const info = analysis.info || {};
    if (info.createdBy) {
      sub.appendChild(el('div', null,
        'Created by ' + info.createdBy + (info.createdOn ? ' · ' + info.createdOn : '')));
    }
    if (info.lastModifiedBy) {
      sub.appendChild(el('div', null,
        'Last modified by ' + info.lastModifiedBy +
        (info.lastModifiedOn ? ' · ' + info.lastModifiedOn : '')));
    }
    // Which acquisition path ran. Matters because the DOM fallback only sees
    // rendered rows, so a "read from page" badge means the history may be
    // partial — and it's the first thing to check when output looks wrong.
    sub.appendChild(el('div', 'acu-source',
      analysis.source === 'viewmodel' ? 'read from Acumatica data'
        : analysis.source === 'legacy' ? 'read from the classic audit window (complete)'
          : analysis.source === 'dom' ? 'read from page (fallback — may be partial)'
            : 'source: ' + (analysis.source || 'unknown')));
    header.appendChild(sub);
    header.appendChild(button('×', close, 'acu-close'));
    panel.appendChild(header);

    // --- toolbar ---
    const toolbar = el('div');
    toolbar.id = 'acu-audit-toolbar';
    // Both copies follow what's on screen: having filtered to the unit-cost
    // changes, copying the whole history back out would be a surprise.
    toolbar.appendChild(button('📋 Copy summary',
      () => h.onCopySummary && h.onCopySummary(state.showSystem, state.filtered || state.analysis)));
    toolbar.appendChild(button('🤖 Copy for AI',
      () => h.onCopyAi && h.onCopyAi(state.filtered || state.analysis)));
    toolbar.appendChild(button('🩺 Copy diagnostic dump', () => h.onCopyDump && h.onCopyDump()));

    const label = el('label');
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = state.showSystem;
    toggle.addEventListener('change', () => {
      state.showSystem = toggle.checked;
      if (h.onToggleSystem) h.onToggleSystem(toggle.checked);
      refresh();
    });
    label.appendChild(toggle);
    label.appendChild(document.createTextNode('Show system fields'));
    toolbar.appendChild(label);
    panel.appendChild(toolbar);

    panel.appendChild(renderFilterBox());
    panel.appendChild(renderBody());
    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);
    document.addEventListener('keydown', onKeyDown, true);
  }

  AcuAudit.panel = { open, close, refresh, isOpen: () => !!backdrop };
});
