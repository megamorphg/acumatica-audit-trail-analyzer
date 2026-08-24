// Popup actions. Useful when the floating button was dismissed, or when the
// audit screen is inside an iframe — tabs.sendMessage reaches every frame.

async function send(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  try {
    await chrome.tabs.sendMessage(tab.id, message);
  } catch (e) {
    // No content script in this tab yet (a page loaded before the extension
    // was installed or reloaded). Inject it, then retry once.
    //
    // The file list is read from the manifest rather than repeated here, for
    // the same reason tools/package.mjs derives its list that way: a hand-kept
    // copy drifts, and omitting one file breaks acquisition at runtime. The
    // manifest's own order is preserved, which keeps the MAIN-world bridge and
    // the isolated-world scripts in the arrangement the content scripts use.
    try {
      const scripts = chrome.runtime.getManifest().content_scripts || [];
      const target = { tabId: tab.id, allFrames: true };

      for (const script of scripts) {
        if (!script.js || !script.js.length) continue;
        await chrome.scripting.executeScript({
          target,
          ...(script.world ? { world: script.world } : {}),
          files: script.js,
        });
      }

      for (const script of scripts) {
        if (!script.css || !script.css.length) continue;
        await chrome.scripting.insertCSS({ target, files: script.css });
      }

      await chrome.tabs.sendMessage(tab.id, message);
    } catch (e2) {
      // Nothing more to be done from here; the page is likely restricted.
    }
  }
  window.close();
}

document.getElementById('analyze').addEventListener('click', () => send('analyze'));
document.getElementById('copy').addEventListener('click', () => send('copy-summary'));
document.getElementById('fab').addEventListener('click', () => send('show-fab'));
document.getElementById('options').addEventListener('click', event => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});
