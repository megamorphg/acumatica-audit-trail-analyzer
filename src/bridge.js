// Runs in the page's MAIN world so it can reach Acumatica's Aurelia view-model.
//
// SM205540's batch list is a qp-data-feed backed by aurelia-ui-virtualization
// with infinite scroll, so off-screen batches simply are not in the DOM.
// Reading the view-model instead gets every loaded batch, with values still
// typed — real booleans and numbers rather than rendered cells.
//
// Talks to the isolated-world content script over window.postMessage.
//
// ---------------------------------------------------------------------------
// Why the screen view-model is NOT on element.au
// ---------------------------------------------------------------------------
// Acumatica's shell (FrontendSources/screen/src/app.html) mounts the screen
// through `<compose view-model.bind="screenName">`, and Aurelia's
// CompositionEngine.createController calls
//
//   HtmlBehaviorResource.create(childContainer, BehaviorInstruction.dynamic(...))
//
// with no `element` argument. create() only does `element.au = ...` when an
// element was passed, so a composed view-model is never hung off the DOM —
// walking `au` up from the feed can find qp-* control view-models and nothing
// else. It does still run `container.viewModel = viewModel`, which is why the
// routes below go through the container / root controller instead.
//
// Aurelia's bootstrapper mounts on `<body aurelia-app="main">` (see the served
// Scripts/Screens/SM205540.html) and Aurelia._configureHost sets
// `host.aurelia = this`, so:
//
//   document.body.aurelia.root.viewModel   -> App        (app.ts)
//   App.viewModel                          -> SM205540   (PXScreen)
//
// App.viewModel is assigned by PXScreen.activate (`model.viewModel = this`) on
// the compose path, and by CustomizableCustomElement.compile on the other.
// Acumatica's own app.ts reads `document.body.aurelia.container.viewModel`, so
// that idiom is covered too.

(function () {
  'use strict';
  if (window.__acuAuditBridge) return;
  window.__acuAuditBridge = true;

  const REQUEST = 'acu-audit-request';
  const RESPONSE = 'acu-audit-response';
  const FEED_SELECTOR = 'qp-data-feed#dfAuditHistoryBatches';

  // fetchRows() hits the server, so page rather than asking for 5000 at once.
  const FETCH_CHUNK = 200;
  const MAX_BATCHES = 5000;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---------- field reads ----------
  // PXFieldState carries `value` (typed) plus a `textValue` getter that applies
  // the user's own formatting. Older builds exposed `displayValue`; both are
  // handled. Anything that isn't a field state is passed through as-is.
  function rawValue(f) {
    if (f === null || f === undefined) return null;
    if (typeof f !== 'object') return f;
    if ('value' in f) return normalize(f.value);
    if ('displayValue' in f) return normalize(f.displayValue);
    return null;
  }

  function textValue(f) {
    if (f === null || f === undefined) return null;
    if (typeof f !== 'object') return normalize(f);
    try {
      if (typeof f.textValue === 'string' && f.textValue !== '') return f.textValue;
    } catch (e) { /* the getter can throw on a half-built field state */ }
    if (f.displayValue !== undefined && f.displayValue !== null) return normalize(f.displayValue);
    if ('value' in f) return normalize(f.value);
    return null;
  }

  // Keep the payload structured-clone-safe and JSON-stable for the dump.
  function normalize(v) {
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString();
    if (v === undefined) return null;
    return v;
  }

  // ---------- locating things ----------
  function auControllers() {
    const out = [];
    const seen = new Set();
    for (const node of document.querySelectorAll('*')) {
      const au = node.au;
      if (!au) continue;
      for (const key of Object.keys(au)) {
        const vm = au[key] && au[key].viewModel;
        if (!vm || seen.has(vm)) continue;
        seen.add(vm);
        out.push(vm);
      }
    }
    return out;
  }

  function isScreenVm(v) {
    return !!(v && typeof v === 'object' && v.AuditHistoryBatches && v.AuditInfo);
  }

  function aureliaHosts() {
    return [
      document.querySelector('[aurelia-app]'),
      document.body,
      document.getElementById('applicationHost'),
      document.documentElement,
    ].filter(Boolean);
  }

  /**
   * Ordered list of routes to the SM205540 view-model. Each entry is tried in
   * turn and the one that worked is reported back, so a future dump says which
   * shape this Acumatica build actually has rather than just "not found".
   */
  function screenVmStrategies() {
    return [
      ['aurelia-root', () => {
        for (const host of aureliaHosts()) {
          const app = host.aurelia && host.aurelia.root && host.aurelia.root.viewModel;
          if (app && isScreenVm(app.viewModel)) return app.viewModel;
          if (isScreenVm(app)) return app;
        }
        return null;
      }],
      ['aurelia-container', () => {
        for (const host of aureliaHosts()) {
          const app = host.aurelia && host.aurelia.container && host.aurelia.container.viewModel;
          if (app && isScreenVm(app.viewModel)) return app.viewModel;
          if (isScreenVm(app)) return app;
        }
        return null;
      }],
      ['customizable', () => {
        for (const el of document.querySelectorAll('customizable')) {
          const vm = el.au && el.au.controller && el.au.controller.viewModel;
          if (vm && isScreenVm(vm.currentViewModel)) return vm.currentViewModel;
        }
        return null;
      }],
      // Every qp-* control is injected the ScreenService, whose `model` is the
      // screen view-model. The feed is guaranteed to be on this screen.
      ['screen-service', () => {
        for (const vm of auControllers()) {
          const model = vm.screen && vm.screen.model;
          if (isScreenVm(model)) return model;
          if (isScreenVm(vm.screenService && vm.screenService.model)) return vm.screenService.model;
        }
        return null;
      }],
      // Last resort: a build where the screen really is a custom element.
      ['au-walk', () => {
        for (const vm of auControllers()) {
          if (isScreenVm(vm)) return vm;
        }
        return null;
      }],
    ];
  }

  function findScreenViewModel() {
    const tried = [];
    for (const [name, fn] of screenVmStrategies()) {
      let vm = null;
      try {
        vm = fn();
      } catch (e) {
        tried.push(name + ':error');
        continue;
      }
      if (vm) return { vm, via: name, tried };
      tried.push(name);
    }
    return { vm: null, via: null, tried };
  }

  function looksLikeCollection(c) {
    return !!(c && typeof c === 'object' && Array.isArray(c.records));
  }

  /**
   * The batch collection without the screen view-model: qp-data-feed keeps its
   * bound view on `config.view` (see QpDataFeedControl), so the feed element's
   * own controller is enough to enumerate every batch.
   */
  function findBatchCollectionDirectly() {
    const feed = document.querySelector(FEED_SELECTOR);
    const vm = feed && feed.au && feed.au.controller && feed.au.controller.viewModel;
    if (!vm) return null;
    const candidates = [vm.config && vm.config.view, vm.view];
    for (const c of candidates) {
      if (looksLikeCollection(c)) return c;
    }
    return null;
  }

  /** AuditInfo is a single view; find it by shape rather than by binding name. */
  function findAuditInfoDirectly() {
    for (const vm of auControllers()) {
      for (const c of [vm.config && vm.config.view, vm.view]) {
        if (c && typeof c === 'object' && c.ChangesLimitReached && c.CreatedByID) return c;
      }
    }
    return null;
  }

  // ---------- loading every batch ----------
  function recordsOf(collection) {
    if (!collection) return [];
    if (Array.isArray(collection.records)) return collection.records;
    if (Array.isArray(collection)) return collection;
    return [];
  }

  function totalOf(collection) {
    const n = collection && collection.totalRowCount;
    return typeof n === 'number' && n >= 0 ? n : null;
  }

  /**
   * The feed pages in from the server as you scroll. PXViewCollection.fetchRows
   * does the same paging without the DOM: it only requests ranges it hasn't
   * already got, and corrects totalRowCount when the server returns short.
   * Falls back to scrolling the feed for builds where fetchRows isn't usable.
   */
  async function loadAll(collection) {
    const total = totalOf(collection);

    if (typeof collection.fetchRows === 'function' && total) {
      try {
        const want = Math.min(total, MAX_BATCHES);
        for (let start = 0; start < want; start += FETCH_CHUNK) {
          const count = Math.min(FETCH_CHUNK, want - start);
          await collection.fetchRows(start, count);
          // The server can shrink totalRowCount mid-run; respect that.
          const now = totalOf(collection);
          if (now !== null && now < want && start + count >= now) break;
        }
        return 'fetchRows';
      } catch (e) { /* fall through to scrolling */ }
    }

    const feed = document.querySelector(FEED_SELECTOR);
    const scroller = feed &&
      (feed.querySelector('feed-body') || feed.querySelector('feed') || feed);
    if (!scroller) return total ? 'none' : 'unknown';

    let previous = -1;
    for (let pass = 0; pass < 40; pass++) {
      const count = recordsOf(collection).length;
      if (count === previous) break;
      previous = count;
      try {
        scroller.scrollTop = scroller.scrollHeight;
      } catch (e) { /* not scrollable; nothing to do */ }
      await sleep(250);
    }
    return 'scroll';
  }

  // ---------- payload ----------
  /** SM205540 is opened with the record's keys in the query string too. */
  function keysFromUrl(name) {
    try {
      const v = new URLSearchParams(location.search).get(name);
      return v || null;
    } catch (e) {
      return null;
    }
  }

  function readInfo(auditInfo) {
    const i = auditInfo || {};
    return {
      screenId: rawValue(i.ScreenID),
      // Which record the screen was opened for. Without this the entity is
      // guessed by counting header tables, and an appointment that raised a
      // purchase order is announced as the purchase order's history.
      auditKeys: rawValue(i.AuditKeys) || keysFromUrl('AuditKeys'),
      rowKeys: rawValue(i.RowKeys) || keysFromUrl('RowKeys'),
      createdBy: textValue(i.CreatedByID),
      createdOn: textValue(i.CreatedDateTime),
      createdThrough: rawValue(i.CreatedByScreenID),
      lastModifiedBy: textValue(i.LastModifiedByID),
      lastModifiedOn: textValue(i.LastModifiedDateTime),
      lastModifiedThrough: rawValue(i.LastModifiedByScreenID),
      changesLimitReached: !!rawValue(i.ChangesLimitReached),
    };
  }

  function readBatch(r) {
    return {
      // textValue keeps the user's own date formatting; value is the typed one,
      // normalized to ISO, which isn't ambiguous about 8/5 vs 5/8. Ship both
      // and let the parser choose.
      date: textValue(r.Date),
      dateIso: rawValue(r.Date),
      user: textValue(r.User),
      screen: rawValue(r.Screen),
      tableData: rawValue(r.TableData),
    };
  }

  async function collect() {
    const found = findScreenViewModel();
    let collection = found.vm && found.vm.AuditHistoryBatches;
    let auditInfo = found.vm && found.vm.AuditInfo;
    let via = found.via;

    if (!looksLikeCollection(collection)) {
      // No screen view-model, but the feed control alone can still enumerate
      // every batch — better than dropping to DOM scraping.
      collection = findBatchCollectionDirectly();
      auditInfo = auditInfo || findAuditInfoDirectly();
      via = collection ? 'feed-control' : null;
    }

    if (!looksLikeCollection(collection)) {
      return {
        ok: false,
        reason: 'view-model-not-found',
        diagnostics: { tried: found.tried, feedPresent: !!document.querySelector(FEED_SELECTOR) },
      };
    }

    let loadedVia = 'none';
    try {
      loadedVia = await loadAll(collection);
    } catch (e) { /* partial data still beats none */ }

    const records = recordsOf(collection);
    const total = totalOf(collection);
    const batches = records.map(readBatch);

    const info = readInfo(auditInfo);
    info.batchesLoaded = batches.length;
    info.batchesTotal = total;
    // Only claim truncation when the server told us how many there are.
    info.batchesTruncated = total !== null && batches.length < total;

    return {
      ok: true,
      payload: {
        source: 'viewmodel',
        via,
        loadedVia,
        info,
        batches,
      },
    };
  }

  window.addEventListener('message', async event => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.channel !== REQUEST) return;

    let result;
    try {
      result = await collect();
    } catch (e) {
      result = { ok: false, reason: 'bridge-error: ' + (e && e.message) };
    }
    window.postMessage({ channel: RESPONSE, id: data.id, result }, '*');
  });

  // Callable from the page console on a live instance — the fastest way to see
  // which route resolves on a given Acumatica build without a round trip
  // through the panel. Runs in the MAIN world, so `__acuAuditProbe()` in
  // DevTools just works.
  window.__acuAuditProbe = function () {
    const found = findScreenViewModel();
    const collection = (found.vm && found.vm.AuditHistoryBatches) || findBatchCollectionDirectly();
    return {
      via: found.via || (collection ? 'feed-control' : null),
      tried: found.tried,
      feedPresent: !!document.querySelector(FEED_SELECTOR),
      records: recordsOf(collection).length,
      totalRowCount: totalOf(collection),
      canFetchRows: !!(collection && typeof collection.fetchRows === 'function'),
    };
  };

  // Let the content script know the bridge is live, in case it loaded first.
  window.postMessage({ channel: 'acu-audit-bridge-ready' }, '*');
})();
