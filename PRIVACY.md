# Privacy Policy — Acumatica Audit Trail Analyzer

**Short version: nothing is collected or transmitted anywhere. All audit processing happens locally in Firefox.**

## What the add-on does

The add-on reads the audit data already available on Acumatica's Audit History (SM205540) screen in your browser, turns it into a plain-English timeline, and shows it to you. Optionally, it copies that summary to your clipboard when you click a copy button.

## What is collected

Nothing. The add-on has no analytics, telemetry, error reporting, or remote logging.

## What is transmitted

Nothing. The add-on makes no network requests of its own and contacts no external server, including the author's. Audit data — which may include customer names, prices, and internal document details — never leaves your browser through this add-on.

The plain-English summary is generated entirely by rules bundled inside the add-on. No AI service or external API is called.

If you use **Copy for AI**, the summary is placed on your clipboard. What you subsequently paste, and where, is outside the add-on's control.

## What is stored

Your AI prompt preference and display settings are stored with Firefox's WebExtension `storage.sync` API. No audit data is stored by the add-on.

## Permissions

- `activeTab` / `scripting` — allow the toolbar popup to inject the analyzer into the current tab when needed.
- `storage` — remember prompt and display preferences.
- Page access — content scripts detect Acumatica Audit History and read its audit data locally. The current upstream architecture matches all URLs because Acumatica installations can use arbitrary customer-specific hostnames.

## Firefox data collection declaration

The manifest declares `data_collection_permissions.required: ["none"]`. The add-on does not collect or transmit user data outside the extension.

## Upstream

This Firefox fork is based on the MIT-licensed project:
`alconroy/acumatica-audit-trail-analyzer`.
