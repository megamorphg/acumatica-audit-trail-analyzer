# Privacy Policy — Acumatica Audit Trail Analyzer

**Short version: nothing is collected, stored, or transmitted anywhere. All processing happens locally in your browser.**

## What the extension does

The extension reads the audit data already rendered on Acumatica's Audit History (SM205540) screen in your browser, turns it into a plain-English timeline, and shows it to you. Optionally, it copies that summary to your clipboard when you click a copy button.

## What is collected

Nothing. The extension has no analytics, no telemetry, no error reporting, and no remote logging.

## What is transmitted

Nothing. The extension makes no network requests of any kind. It contacts no server, including the author's. Audit data — which may include customer names, prices, and internal document details — never leaves your browser.

The plain-English summary is generated entirely by rules bundled inside the extension. No AI service or external API is called.

If you use the **Copy for AI** button, the summary is placed on your clipboard. What you subsequently paste, and where, is entirely your choice and outside the extension's control.

## What is stored

Your AI prompt preference and display settings are saved using `chrome.storage.sync`, which is Chrome's own settings-sync mechanism tied to your Chrome profile. This stays within your Google account's Chrome sync and is never sent to the author. No audit data is ever stored.

## Permissions

- `activeTab` / `scripting` — read the audit screen you are currently looking at, only when you invoke the extension.
- `clipboardWrite` — copy the summary when you click a copy button.
- `storage` — remember your prompt and display preferences.

## Contact

Questions or concerns: open an issue at
https://github.com/alconroy/acumatica-audit-trail-analyzer/issues
