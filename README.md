# Acumatica Audit Trail Analyzer

Chrome extension that turns Acumatica's field-level audit history into a plain-English timeline of who changed what, and when.

Unofficial project — not affiliated with, endorsed by, or sponsored by Acumatica, Inc.

## The problem

With field-level audit enabled, Acumatica's **Audit History (SM205540)** screen is complete and unreadable. Adding one line to a sales order writes ~200 columns, of which maybe eight mean anything to a person. The rest are derived totals, base-currency mirrors, validity flags and counters. Working out what actually happened means eyeballing red/green cell pairs across a dozen collapsed batches, newest-first.

This extension reads the same data and says:

> **4 recorded actions on Sales Order SO004417 by dmorgan@northwind.example and tlawson@northwind.example between 8/5/2026 4:45 PM and 8:15 PM.**
>
> - 4:45 PM · dmorgan — created sales order SO004417 — customer C01187 (HOLLAND, MARIE), customer PO 40928-02; added line 1 — 2 EA of HBX 480J10 (POLY-V BELT 10 RIBS, 48") @ $19.63 = $39.26; system recalculated tax — order total $39.26 → $41.75 (tax $2.49)
> - 4:45 PM · dmorgan — printed the sales order
> - 4:49 PM · dmorgan — flagged line 1 for drop-ship purchasing (warehouse 14)
> - 8:15 PM · tlawson · *Purchase Receipts (PO302000)* — confirmed a shipment — 2 of line 1 shipped, completing the order

One bullet per action, with the full field-level timeline underneath. Everything is derived locally by rules in the extension. Nothing is sent anywhere, and no AI service is called.

## Install

Chrome no longer allows `.crx` files to be installed by hand, so both routes below use **Load unpacked**.

**From a packaged zip:**

1. Unzip `acumatica-audit-trail-analyzer-vX.Y.Z.zip` into a folder of its own.
2. Open `chrome://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the unzipped folder — the one with `manifest.json` in it

**From source:** same steps 2–4, pointing at the repo folder. Build a fresh zip with `npm run package` (output lands in `dist/`).

## Use

Open the audit history for a record — the **Audit History** action on a sales order, invoice, customer, appointment and so on — and a floating button appears bottom-right. Both the modern SM205540 screen and the classic-UI audit window (`Frames/Audit.aspx`, on older instances) are supported.


- **📖 Explain this history** — opens the reader panel: a one-line overview, a bullet per action, then the full chronological timeline (Acumatica shows newest-first, which reads backwards as a story). Each entry expands to the underlying field diff.
- **Filter** — type into the box under the toolbar to answer "did anyone touch the unit cost?" without scrolling. Commas mean *or*, so `unit cost, discount` finds either. It searches field names, old and new values, table and record labels, and the generated sentences; punctuation is optional, so `unitcost` finds `Unit Cost`. Matches are highlighted and shown expanded, and both copy buttons follow the filter. Escape clears the filter; Escape again closes the panel.

  Filtering deliberately searches the fields the classifier hides too — answering "was the unit cost changed" with "no" because the only match sat in a system field would be worse than useless. When that happens the panel says so.
- **📋 Copy summary** — the same thing as markdown, ready for a ticket or an email.
- **🤖 Copy for AI** — a compact digest with the plumbing stripped out, prefixed with your configurable prompt. Typically an order of magnitude smaller than the raw screen, so it fits comfortably in a prompt.
- **🩺 Copy diagnostic dump** — the raw acquired data plus which acquisition path was used. Useful for filing a bug. It contains real audit data, so check it before sharing.

**Show system fields** reveals everything that was filtered out. Nothing is ever discarded — only hidden.

The toolbar icon opens the same actions as a popup, useful if the floating button was dismissed or the screen is inside an iframe.

## How it decides what matters

This is the part worth knowing, because it's the difference between a summary and a wall of numbers.

Acumatica renders each audit column header as the DAC field's `DisplayName`, and falls back to the raw field name when the field has no `[PXUIField]` attribute at all — `Pages/sm/SM205530.aspx.cs` in an Acumatica site does exactly this when building its grid columns. `SOOrder.ShipmentCntr`, for instance, is a bare `[PXDBInt]` with no UI attribute.

So a header that still looks like a C# identifier — `ShipmentCntr`, `IsOpenTaxValid`, `MarkforDS`, `BaseShippedQty` — is by definition a field with no UI presence. A header with spaces or punctuation (`Discount Percent`, `Order Nbr.`), or a plain English word (`Status`, `Printed`), is something a user can actually see. That single signal, plus override lists in [`src/dictionary.js`](src/dictionary.js), does most of the filtering. It also neatly resolves the duplicate pairs Acumatica emits (`Order Total` and `OrderTotal`) by keeping the labelled one.

Fields are sorted into three tiers:

| Tier | Meaning | Where it shows |
|---|---|---|
| `primary` | A user could have typed this | Summary bullets and sentences |
| `secondary` | Real field, but recalculated (`Order Total`, `Estimated Cost Total`, `Margin %`, `Open Qty.`) | Field detail only |
| `noise` | Internal plumbing (`ShipmentCntr`, `IsOpenTaxValid`) | Hidden behind the toggle |

Document totals are deliberately `secondary`. Nobody types an order total — Acumatica rewrites a dozen rollups on every save, and quoting them all is exactly what turns a summary into a wall of numbers. Rules that need a total still read it directly; the tier only governs generic phrasing.

Rules also *consume* what they explain, and a rule that consumed a whole table stops later rules re-describing it — otherwise a created line gets announced twice, once by the entity pack and once by the generic one.

Record identity falls out for free: on a modified row, key columns hold the same value in both the red and green rows, so diffing the two yields both the changed fields and "line 1 of SO004417" in one pass.

A column identical on both rows is a key — unless it is blank on both, which identifies nothing. Live AR and AP lines carry `DiscountsAppliedToLine` as null on both sides, and taken as the key it became the row's entire identity, leaving the real keys to be reported as edits somebody had made by hand.

*Which* record is being audited comes from SM205540's own `AuditKeys` field (`INST` + `0078099-1`), matched against each header table's keys. It used to be inferred by counting header tables and taking the most frequent, which is wrong exactly when it matters: opening an appointment that raised a purchase order gives the PO two batches to the appointment's one, and the panel then announced itself as the history of a document you hadn't asked about. Counting is still the fallback when no keys are available.

Two things make that match less literal than it looks. AR and AP documents repeat the whole key set, separated by a unit separator (`INV` + `AP006763` + `INV` + `AP006763`), so only the first group is read. And `AuditKeys` carries the *stored* value where the grid shows the *display* one — a bill is keyed `INV` but its Type column reads `Bill` — so tables are ranked by how many key values line up rather than having to match all of them. Requiring the same *number* of keys still keeps a child line out, and requiring at least one hit keeps an unrelated document out: that bill's audit also carries purchase order PO001040, two keys, neither of them a match.

That still leaves ties, because Acumatica audits one row under several DAC projections. A customer is both `Customer` and `Business Account` under the identical key; an SO invoice is both `AR Document` and `SO Invoice`; a vendor bill is both `Document` and `AP document`. Nothing in the keys separates them, so the screen the audit was opened from does ([`SCREEN_ENTITIES`](src/dictionary.js)). The projections that lose keep their fields in the detail view but stop announcing themselves — otherwise raising a bill reads as three documents created at once.

Register tables are then renamed from the row's own `Type`, because "Document AP006763" is a table name and "Bill AP006763" is what the thing is called.

## Rules

Actions are described by declarative rules in [`src/rules/`](src/rules). A rule matches either one audited table or a whole batch, and *consumes* the fields it explains so the generic fallback never repeats them:

```js
{
  id: 'so.dropship',
  priority: 80,
  when: ctx => ctx.tableName === 'Sales Order Line' && ctx.turnedOn('Mark for PO'),
  say: ctx => `flagged ${ctx.record} for drop-ship purchasing (warehouse ${ctx.to('Purchase Warehouse')})`,
  consumes: ['Mark for PO', 'PO Source', 'Purchase Warehouse', 'MarkforDS'],
}
```

`common.js` carries most of the weight across every entity — created/deleted, lines added/removed, status transitions, hold, approve, cancel, print, email, complete, and price/quantity/discount edits. Entity packs add only their signature actions:

- **`so.js`** — drop-ship flagging, shipment confirmation (which reads as counters moving, never as the word "shipped"), and tax recalculation collapsed to one line
- **`po.js`** — cost changes, receipts, promised-date moves, receipt release, the link back to the service order a PO was raised from, and the PO status Acumatica stamps onto every linked line
- **`arap.js`** — release, void, paid-in-full, amount, due date, terms
- **`masters.js`** — credit limits, prices, costs, tax zones, class changes, and customer/vendor status, with direction-aware wording ("raised" / "lowered", "placed on credit hold" / "took off credit hold")
- **`fs.js`** — service orders and appointments: rescheduling, staff assignment, actual time, status as verbs, and the appointment/service-order line mirror

Mirrors are the recurring shape in this data. One edit lands on two or three rows — a service order line and its appointment twin, a PO status copied onto every line it was raised for — and each is separately audited. Rules collapse those to one sentence and consume the copies, which stay visible in the field detail. The FS mirror is matched on the *new* value alone: completing a line moves the appointment row from In Process and the service order row from Scheduled, both to Completed, and requiring the old values to agree would let one action through as two.

Anything no rule explains still gets said, just literally: *"changed Discount Percent on line 4 from 0% to 50%"*.

Adjacent batches from one user collapse into a single action, because Acumatica emits one save as several batches — a header write and the line writes that went with it. Two batches that rewrite the *same user-visible field of the same row* are exempt: they are two saves, and merging them makes an action contradict itself. A live invoice put on hold and released two seconds later came out as "put the invoice on hold" sitting beside "took the invoice off hold". Only primary fields count, since the recalculated rollups move on every batch of a save and treating those as conflicts would undo the coalescing entirely.

On a master record the summary is more generous. A customer has no workflow — nobody releases or completes one — so a plain field edit *is* the event, and every action earns a summary bullet rather than only those a rule recognised.

Adjacent batches from the same user within 10 seconds (configurable) collapse into one action, because saving a record in Acumatica routinely writes two or three audit entries a second apart.

## Development

No build step and no dependencies. The `src/` files are plain scripts that attach to `globalThis.AcuAudit`, so the exact same source runs in the content script and under node.

```bash
npm test          # 60 assertions against fixtures from real captures
npm run demo      # print the narrative for the fixture
npm run demo:ai   # print the AI digest instead
npm run serve     # static server for the preview pages under test/
npm run icons     # regenerate icons/ (hand-rolled PNG encoder, no deps)
```

`node test/run.mjs path/to/dump.json` runs the whole pipeline against a **diagnostic dump** copied from a live instance — the fastest way to fix a misclassified field or a rule that didn't fire.

`test/panel-preview.html` renders the reader panel against the fixture, and `test/legacy-preview.html` exercises the classic-UI adapter against a copy of that page's markup — both with no Acumatica instance and no extension install.

### Where the data comes from

The batch list is a `qp-data-feed` backed by `aurelia-ui-virtualization` with infinite scroll, so off-screen batches are **not in the DOM**. Scraping alone silently truncates history.

So [`src/bridge.js`](src/bridge.js) runs in the page's MAIN world and reads Acumatica's Aurelia view-model directly, which yields every batch rather than only the rendered ones. Each batch carries its changes as a JSON string:

```jsonc
[{ "TableName": "Sales Order Line", "Operation": "Modified",
   "Columns": [ { "Header": "Discount Percent",
                  "Cells": [ {"Value": 0,  "Color": 2},      // 2 = red   = old
                             {"Value": 50, "Color": 1} ] } ] // 1 = green = new
}]
```

**The screen view-model is not on `element.au`.** Acumatica's shell mounts the screen through `<compose view-model.bind="screenName">` (`FrontendSources/screen/src/app.html`), and Aurelia's `CompositionEngine.createController` calls `HtmlBehaviorResource.create(childContainer, BehaviorInstruction.dynamic(...))` with no element argument — `create()` only sets `element.au` when it was given one. So walking `au` up from the feed finds `qp-*` control view-models and never the screen. It does still run `container.viewModel = viewModel`, which is the way in:

```
document.body.aurelia.root.viewModel   ->  App        (aurelia sets host.aurelia; the page is <body aurelia-app="main">)
App.viewModel                          ->  SM205540   (set by PXScreen.activate)
```

The bridge tries that, then `aurelia.container.viewModel` (the idiom Acumatica's own `app.ts` uses), then `<customizable>`, then any control's injected `ScreenService.model`, then the old `au` walk — and reports which one worked, so a diagnostic dump from a build that differs says *why* rather than just "not found". On a live screen, `__acuAuditProbe()` in the console prints the same thing.

Paging is `PXViewCollection.fetchRows(start, count)` rather than scripted scrolling: it requests only ranges it hasn't got and corrects `totalRowCount` when the server returns short. If fewer batches load than the feed reports, the panel says so instead of quietly summarizing a partial history.

[`src/scrape.js`](src/scrape.js) is a DOM fallback using the class names from Acumatica's own template (`.table-header`, `.column-container`, `td.value.red|.green`, booleans as `qp-icon[imagesrc*=GridCheck]`). It's a safety net, not the primary route.

### The classic UI

Older instances have no SM205540 at all. The **Audit History** action opens a standalone WebForms window, `Frames/Audit.aspx`, and [`src/legacy.js`](src/legacy.js) reads that — a third acquisition path behind the same payload contract, so the classifier, parser, rule packs, panel and filter are all reused unchanged.

It's the easiest of the three. `Audit.aspx.cs` server-renders every batch in one pass, so there is no virtualization and no paging — nothing can be silently truncated. Collapsed batches are only `display:none` and stay in the DOM, so there is nothing to expand, which matters because the page's own `ExpandAll()` lives in a world a content script can't reach.

The one structural difference is how old and new are marked. `Controls/AuditItem.ascx.cs` sets `oldValueCell.ForeColor = DarkRed` and `newValueCell.ForeColor = DarkGreen`, which ASP.NET renders as an inline style rather than a class — so the colour is read from the style, matched by name and by the `rgb()` form Chrome resolves it to. Operation titles differ too (`Inserted`/`Updated` rather than `Created`/`Modified`) and are mapped onto the modern vocabulary the rules match on; anything unrecognised is left blank so the parser falls back to inferring it from the value colour.

**Times need correcting, and the page tells us how.** `AuditItem.ascx.cs` prints each batch date with a bare `Tag.Date.ToString()` — the stored UTC value — while `Audit.aspx.cs` fills the info panel from `AuditInfo.Panel`, whose fields Acumatica has already converted to the viewing user's timezone. Left alone, a classic timeline reads hours out.

No timezone needs to be known or configured. The page renders the same instant twice: the newest batch *is* the last modification, and the oldest *is* the creation, so subtracting the panel value from the raw one gives that user's offset directly — whether that's −4, +5:30 or +12:45. Both ends are anchored where possible, and if they disagree a DST boundary fell between the two, so each batch takes the offset of whichever anchor is nearer in time. An offset that isn't a whole quarter-hour, or is larger than any real one, means the anchor assumption was wrong: the times are then left exactly as recorded and the panel says so rather than showing times that are quietly wrong. What the page literally said is kept as `rawDate`, so a diagnostic dump stays faithful.

`test/legacy-preview.html` reproduces that markup, quirks and all — including the UTC skew — and is where the adapter is actually verified, since node has no DOM.

If Acumatica truncated the history itself (`ChangesLimitReached`), the panel says so rather than confidently summarizing partial data.

## Known limits

- Only the per-record audit history is read. **Audit History by Screen (SM205530)** — the screen/user/date-range inquiry — is a different question over a different data shape, and is not supported.
- The AR/AP and master-data rule packs were written against Acumatica's DAC and screen definitions rather than observed audit output. Expect a tuning pass the first time you run this on an invoice or a customer — the diagnostic dump makes that a one-shot fix. `fs.js` and `po.js` have since been tuned against live captures.
- Screen IDs map to friendly names from a curated list; unmapped ones fall back to the module ("a Purchasing screen (PO501234)"). The ID is always shown, so a name being absent never loses information.

## Privacy

See [PRIVACY.md](PRIVACY.md). Short version: nothing is collected, stored, or transmitted anywhere — all processing is local to your browser, and no AI service is called.

## Related

[Acumatica Trace Copier](https://github.com/alconroy/acumatica-trace-copier) — same idea for Acumatica trace exceptions.

## License

[MIT](LICENSE)
