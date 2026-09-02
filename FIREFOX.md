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
- **Client environments used occasionally:** use **Run for this visit only** / temporary site access.
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

## Permanent installation, signing, and GitHub Releases

Normal Firefox installations require distributed add-ons to be signed by Mozilla. This fork uses **unlisted signing**: Mozilla signs the add-on, while GitHub remains the source and distribution location.

The workflow `.github/workflows/firefox-sign.yml` runs tests, packages the runtime files, submits them to Mozilla through `web-ext sign --channel unlisted`, and stores the returned signed `.xpi` as a GitHub Actions artifact.

For tagged releases, the same workflow also publishes the Mozilla-signed `.xpi` as a permanent **GitHub Release asset**. GitHub is therefore the place from which the add-on is downloaded; AMO is used only for the Firefox-required signature.

### One-time signing setup

1. Sign in to the Mozilla Add-ons Developer Hub and create API credentials.
2. In this GitHub repository, open **Settings > Secrets and variables > Actions**.
3. Add these repository secrets:
   - `AMO_JWT_ISSUER` — Mozilla's JWT issuer/API key.
   - `AMO_JWT_SECRET` — Mozilla's JWT secret/API secret.

### Normal release process

1. Merge the desired code into `main`.
2. Increment `manifest.json` to a version that has never been submitted to AMO.
3. Create/push a tag named `firefox-v<version>`, for example `firefox-v1.0.1`.
4. **Sign Firefox add-on** runs automatically.
5. The workflow verifies the tag matches the manifest version, submits the add-on to Mozilla, receives the signed XPI, and publishes it to a GitHub Release with that tag.
6. Download/install the `.xpi` from the repository's **Releases** page.

Each Mozilla submission must use a new add-on version. Do not rerun signing against a version AMO has already accepted; bump the manifest version first.

### Publishing an already-signed build

If a version was signed manually before GitHub Release publishing was enabled, use **Publish existing signed Firefox XPI** in GitHub Actions. Supply the successful signing workflow run ID and the version. It downloads the existing signed artifact and creates the GitHub Release without submitting the version to Mozilla again.

For the original Firefox 1.0.0 build, the successful signing run is `33659202951`.

## Automated upstream maintenance

Upstream project:

`alconroy/acumatica-audit-trail-analyzer`

The workflow `.github/workflows/upstream-sync.yml` runs weekly and can also be run manually. It:

1. fetches the current upstream `main` branch;
2. checks whether the Firefox fork already contains those commits;
3. merges new upstream commits into the automation-only `automation/upstream-sync` branch;
4. opens or refreshes a pull request into this fork's `main` branch;
5. lets the normal Firefox CI test and package the proposed update before it is merged.

The workflow does **not** merge upstream directly into `main`. Review the generated PR first. If the upstream project changes one of the Firefox-specific files and Git cannot merge cleanly, the workflow fails instead of guessing; resolve that conflict while preserving Firefox metadata and packaging behavior.

GitHub Actions needs `contents: write` and `pull-requests: write` for the sync workflow. If GitHub blocks PR creation, enable **Settings > Actions > General > Workflow permissions > Allow GitHub Actions to create and approve pull requests** for this fork.

Keep Firefox-specific changes small. Prefer merging upstream analyzer changes unchanged and resolving only conflicts in Firefox packaging/metadata files.

## Privacy

The analyzer is local and deterministic. It does not call AI or external APIs. See `PRIVACY.md`.
