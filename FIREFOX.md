# Firefox Add-on

This fork targets Firefox only. The analyzer logic remains intentionally close to the upstream project so future upstream fixes and rule improvements are easy to merge.

## Requirements

- Firefox 128 or newer.
- Acumatica Audit History (`SM205540`) or the classic Audit History window.

Firefox 128 is the minimum because the modern Acumatica acquisition path uses a Manifest V3 content script in the page's `MAIN` execution world to reach Acumatica's Aurelia view-model.

## Site permissions

The manifest intentionally keeps `<all_urls>` so the add-on can work with Acumatica instances hosted on arbitrary client domains. In Firefox Manifest V3, matching a site does not mean the add-on automatically has ongoing access to it: registered content scripts run only when Firefox has granted the add-on host permission for that site.

Recommended usage:

- **Your own sandbox/dev sites:** use Firefox's **Always Allow on this site** option so the analyzer is available whenever you visit that hostname.
- **Client environments used occasionally:** use **Run for this visit only** / temporary site access. This limits access to the current browsing context rather than granting ongoing access to the client hostname.
- **Everything else:** leave access ungranted. The analyzer content scripts will not run there.

Manage access from Firefox's Extensions button or from **Add-ons and themes > Extensions > Acumatica Audit Trail Analyzer > Permissions**. You can revoke persistent site access at any time.

This permission model is preferred over hardcoding Acumatica hostnames because consultants may encounter many unrelated client domains while still keeping the add-on inactive on ordinary websites.

## Test locally

1. Run `npm test`.
2. Run `npm run package` to create the extension package in `dist/`.
3. In Firefox, open `about:debugging#/runtime/this-firefox`.
4. Choose **Load Temporary Add-on**.
5. Select `manifest.json` from the repository, or a packaged extension file as appropriate.
6. Open an Acumatica Audit History screen, grant site access if Firefox requests it, and use **Explain this history**.

Temporary add-ons are for testing and are removed when Firefox restarts.

## Permanent installation

Normal Firefox installations require distributed add-ons to be signed by Mozilla. This fork includes a stable Gecko extension ID in `manifest.json` so it can be submitted to Mozilla Add-ons (AMO) for listed or unlisted signing.

For personal/internal distribution, an **unlisted signed add-on** is the intended deployment model.

## Privacy

The analyzer is local and deterministic. It does not call AI or external APIs. See `PRIVACY.md`.

## Upstream maintenance

Upstream project:

`alconroy/acumatica-audit-trail-analyzer`

Keep Firefox-specific changes small. Prefer merging upstream analyzer changes unchanged and resolving only conflicts in Firefox packaging/metadata files.
