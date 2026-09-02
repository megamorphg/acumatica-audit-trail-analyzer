# Firefox Add-on

This fork targets Firefox only. The analyzer logic remains intentionally close to the upstream project so future upstream fixes and rule improvements are easy to merge.

## Requirements

- Firefox 128 or newer.
- Acumatica Audit History (`SM205540`) or the classic Audit History window.

Firefox 128 is the minimum because the modern Acumatica acquisition path uses a Manifest V3 content script in the page's `MAIN` execution world to reach Acumatica's Aurelia view-model.

## Test locally

1. Run `npm test`.
2. Run `npm run package` to create the extension ZIP in `dist/`.
3. In Firefox, open `about:debugging#/runtime/this-firefox`.
4. Choose **Load Temporary Add-on**.
5. Select `manifest.json` from the repository, or a packaged extension file as appropriate.
6. Open an Acumatica Audit History screen and use **Explain this history**.

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
