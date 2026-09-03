// Orchestration: detect the audit screen, acquire the data, analyze it, show
// the panel. Runs in the isolated world; bridge.js does the MAIN-world work.

(function () {
  'use strict';
  if (window.__acuAuditInjected) return;
  window.__acuAuditInjected = true;

  // The analyzer modules attach to the extension sandbox global. In Firefox
  // content-script sandboxes, that global is not guaranteed to be the same
  // object as the page WindowProxy exposed as `window`.
  const AcuAudit = globalThis.AcuAudit;
  const FEED = 'qp-data-feed#dfAuditHistoryBatches';
  const REQUEST = 'acu-audit-request';
  const RESPONSE = 'acu-audit-response';

  const DEFAULT_SETTINGS = {
    aiPrompt: typeof ACU_AUDIT_DEFAULT_PROMPT !== 'undefined' ? ACU_AUDIT_DEFAULT_PROMPT : '',
    showSystemFields: false,
    coalesceSeconds: 10,
  };

  let lastRaw = null;   // kept for the diagnostic dump
  let lastAnalysis = null;

  // ---------- settings ----------
  function getSettings() {
    return new Promise(resolve => {
      try {
        chrome.storage.sync.get(DEFAULT_SETTINGS, data => {
          resolve(Object.assign({}, DEFAULT_SETTINGS, data || {}));
        });
      } catch (e) {
        resolve(Object.assign({}, DEFAULT_SETTINGS));
      }
    });
  }

  function saveSetting(key, value) {
    try {
      chrome.storage.sync.set({ [key]: value });
    } catch (e) { /* settings are a convenience, not a requirement */ }
  }

  // ---------- clipboard / toast ----------
  function copyToClipboard(text) {
    return navigator.clipboard.writeText(text).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand('copy');
      } finally {
        ta.remove();
      }
    });
  }

  let toastEl = null;
  function showToast(msg, duration = 2600) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.id = 'acu-audit-toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('acu-visible');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.remove('acu-visible'), duration);
  }

  // ---------- acquisition ----------
  function askBridge(timeoutMs = 20000) {
    return new Promise(resolve => {
      const id = 'acu-' + Math.random().toString(36).slice(2);

      function onMessage(event) {
        if (event.source !== window) return;
        const d = event.data;
        if (!d || d.channel !== RESPONSE || d.id !== id) return;
        cleanup();
        resolve(d.result);
      }
      function cleanup() {
        window.removeEventListener('message', onMessage);
        clearTimeout(timer);
      }
      const timer = setTimeout(() => {
        cleanup();
        resolve({ ok: false, reason: 'bridge-timeout' });
      }, timeoutMs);

      window.addEventListener('message', onMessage);
      window.postMessage({ channel: REQUEST, id }, '*');
    });
  }

  async function acquire() {
    // The classic-UI audit window (Frames/Audit.aspx) is a different page
    // entirely — no view-model and no data feed, so neither modern path can
    // say anything useful about it. It also server-renders every batch, which
    // makes it the definitive source when it is the page we are on.
    if (AcuAudit.legacy.isPresent()) {
      const viaLegacy = await AcuAudit.legacy.collect();
      if (viaLegacy.ok) return viaLegacy.payload;
    }

    // The view-model is the preferred source: the feed is virtualized, so the
    // DOM only ever holds the batches currently on screen.
    const viaBridge = await askBridge();
    if (viaBridge && viaBridge.ok && viaBridge.payload.batches.length) {
      return viaBridge.payload;
    }

    const viaDom = await AcuAudit.scrape.collect();
    if (viaDom.ok) {
      viaDom.payload.bridgeError = (viaBridge && viaBridge.reason) || 'unknown';
      // Which view-model routes were attempted. Without this a dump can only
      // say the bridge failed, not why, which is exactly the thing to fix.
      viaDom.payload.bridgeDiagnostics = (viaBridge && viaBridge.diagnostics) || null;
      return viaDom.payload;
    }

    const why = [
      viaBridge && !viaBridge.ok ? 'view-model: ' + viaBridge.reason : null,
      'DOM: ' + viaDom.reason,
      AcuAudit.legacy.isPresent() ? null : 'classic audit frame: not this page',
    ].filter(Boolean).join('; ');
    throw new Error(why);
  }

  // ---------- prompt ----------
  function fillPrompt(template, analysis) {
    const users = Array.from(new Set(analysis.actions.map(a => a.user).filter(Boolean)));
    const values = {
      entity: analysis.entity || 'record',
      record: analysis.record || '',
      users: users.join(', ') || 'unknown users',
      actions: String(analysis.actions.length),
      url: location.href,
    };
    return String(template).replace(
      /\{(entity|record|users|actions|url)\}/g,
      (m, key) => values[key]
    );
  }

  // ---------- main ----------
  async function run() {
    showToast('Reading audit history…');
    let raw;
    try {
      raw = await acquire();
    } catch (e) {
      showToast('Could not read the audit history (' + e.message + '). ' +
        'Make sure the Audit History screen has finished loading.', 7000);
      return;
    }

    const settings = await getSettings();
    lastRaw = raw;

    const model = AcuAudit.parser.buildModel(raw);
    const analysis = AcuAudit.narrative.analyze(model, {
      coalesceSeconds: settings.coalesceSeconds,
    });
    lastAnalysis = analysis;

    if (!analysis.actions.length) {
      showToast('No audit changes found on this screen.', 4000);
      return;
    }

    AcuAudit.panel.open(analysis, {
      showSystem: settings.showSystemFields,
      onToggleSystem: v => saveSetting('showSystemFields', v),
      // `view` is whatever the panel is currently showing — the full analysis,
      // or the filtered one when a filter is active.
      onCopySummary: async (showSystem, view) => {
        const shown = view || analysis;
        await copyToClipboard(AcuAudit.narrative.toMarkdown(shown, { showSystemFields: showSystem }));
        showToast(shown.filter ? 'Filtered summary copied to clipboard'
          : 'Summary copied to clipboard');
      },
      onCopyAi: async view => {
        const shown = view || analysis;
        const prompt = fillPrompt(settings.aiPrompt || DEFAULT_SETTINGS.aiPrompt, shown);
        await copyToClipboard(AcuAudit.narrative.toAiDigest(shown, { prompt }));
        showToast('Digest + prompt copied — paste into Claude or any assistant');
      },
      onCopyDump: async () => {
        // Deliberately the raw acquired payload: if the view-model shape
        // differs on a given Acumatica build, this is what makes it fixable.
        await copyToClipboard(JSON.stringify({
          extension: 'acumatica-audit-trail-analyzer',
          acquiredVia: raw.source,
          // Which view-model route worked, and how the batches were paged in.
          viewModelVia: raw.via || null,
          loadedVia: raw.loadedVia || null,
          bridgeError: raw.bridgeError || null,
          bridgeDiagnostics: raw.bridgeDiagnostics || null,
          url: location.href,
          capturedAt: new Date().toISOString(),
          payload: raw,
        }, null, 2));
        showToast('Diagnostic dump copied (raw audit data — check before sharing)', 5000);
      },
    });
  }

  // ---------- floating button ----------
  let fab = null;

  function injectFab() {
    if (fab) return;
    fab = document.createElement('div');
    fab.id = 'acu-audit-fab';

    const main = document.createElement('button');
    main.type = 'button';
    main.textContent = '📖 Explain this history';
    main.addEventListener('click', run);

    const hide = document.createElement('button');
    hide.type = 'button';
    hide.className = 'acu-secondary';
    hide.textContent = 'Hide';
    hide.addEventListener('click', () => {
      fab.remove();
      fab = null;
    });

    fab.appendChild(main);
    fab.appendChild(hide);
    document.body.appendChild(fab);
  }

  function looksLikeAuditScreen() {
    if (document.querySelector(FEED)) return true;
    const text = document.body ? (document.body.innerText || '') : '';
    return /Created Through/.test(text) && /Last Modified Through/.test(text);
  }

  function checkAndInject() {
    if (fab || !document.body) return;
    if (looksLikeAuditScreen()) injectFab();
  }

  checkAndInject();
  let scanTimer = null;
  const observer = new MutationObserver(() => {
    if (fab) {
      observer.disconnect();
      return;
    }
    clearTimeout(scanTimer);
    scanTimer = setTimeout(checkAndInject, 400);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // ---------- popup messages ----------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg === 'analyze') {
      run();
    } else if (msg === 'copy-summary') {
      if (lastAnalysis) {
        copyToClipboard(AcuAudit.narrative.toMarkdown(lastAnalysis))
          .then(() => showToast('Summary copied to clipboard'));
      } else {
        run();
      }
    } else if (msg === 'show-fab') {
      injectFab();
    } else if (msg === 'is-audit-screen') {
      sendResponse({ ok: looksLikeAuditScreen() });
      return true;
    }
    sendResponse({ ok: true });
  });
})();
