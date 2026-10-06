# Vendored from AIAE-paicing — the shared grammar

Byte-identical copies of modules from `AIAE-paicing/shared/`. They are **not ports**: the same
implementation runs in Pacing (dash-gate, the pacing-builder container) and here in the browser, so the
two sides cannot disagree about what a widget id is, which tiles may be switched off, or which
grammar a stored widget is written in.

This directory is **not** `../engine/vendor/`, and the split is deliberate. That one holds six files
and means one thing: *Pacing's calculation engine, one implementation of the maths in two places*.
Its `SOURCE.md`, this repository's `CLAUDE.md` and `AIAE-paicing`'s own `CLAUDE.md` all state the
rule as "those six files", with a `diff -q` recipe written around it. The modules here answer a
different question — the stored shape of a dashboard, not the arithmetic over it — and they do not
have the same lifetime: `dash-blocks.js` tracks each branch's page composition and genuinely differs
between `AIAE-paicing`'s `1.0.0` and `ogan-team` branches, where the engine's six are kept identical
across both. Mixing the two sets would make the engine's `diff -q` recipe lie on a file the branches
hold apart on purpose.

## What is here

Nine of these arrived with the widget builder (2026-10-01); `dash-blocks.js` came first, with the
tile on/off work. All are copied from the `1.0.0` branch of `AIAE-paicing`, whose `shared/` had just
been synced from `ogan-team` at `823a42d`.

| File | Copied from | Branch | Date | sha256 (first 16) | What it governs |
|---|---|---|---|---|---|
| `dash-blocks.js` | `shared/dash-blocks.js` | `1.0.0` | 2026-10-01 | `a596628a9c8711ca…` | widget-instance / group id grammar, the `display.enabled` on/off rule, group normalize + sweep |
| `report-v2.js` | `shared/report-v2.js` | `1.0.0` | 2026-10-01 | `5dd8251070d9f97b…` | the widget-builder v2 wire grammar — every stored widget is normalized and refused by it |
| `std-entries.js` | `shared/std-entries.js` | `1.0.0` | 2026-10-01 | `30c4dbedfef74099…` | the 32 Standard widget templates, and the `std:v2:*` key rule |
| `widget-metrics.js` | `shared/widget-metrics.js` | `1.0.0` | 2026-10-01 | `581b8912beb045b8…` | the two context functions `normReport` runs on: `checkDimKey`, `isCanonicalMetric` |
| `lib-refs.js` | `shared/lib-refs.js` | `1.0.0` | 2026-10-01 | `0427c1153de210f4…` | library-reference identity: which keys are user entries, usage counting |
| `kpi-band.js` | `shared/kpi-band.js` | `1.0.0` | 2026-10-01 | `e6310d67cf8ea5a2…` | KPI band thresholds |
| `value-labels.js` | `shared/value-labels.js` | `1.0.0` | 2026-10-01 | `93a7d3229ac0e764…` | Display names — readable labels for raw conversion-action and creative values |
| `mapping-dims.js` | `shared/mapping-dims.js` | `1.0.0` | 2026-10-01 | `b7df1cbae3b0d931…` | the CM360 mapping dimension vocabulary |
| `layout-geometry.mjs` | `shared/layout-geometry.mjs` | `1.0.0` | 2026-10-01 | `18290a7a0c1537bb…` | saved-layout tile geometry: normalize, compact |
| `layout-materialize.mjs` | `shared/layout-materialize.mjs` | `1.0.0` | 2026-10-01 | `e449812f387d6191…` | applying a saved Layout — mints fresh widget and group instances |
| `formula-chips.js` | `shared/formula-chips.js` | `1.0.0` | 2026-10-06 | `3142ae3cb4167a70…` | the formula-chip catalogue: what a chip is, which settings each takes, and the shape check of a stored chip map |
| `line-item-columns.js` | `shared/line-item-columns.js` | `1.0.0` | 2026-10-06 | `15cab2b17515ae1d…` | `display.lineItems` — the Line Items block's columns, sort, view and rows; dash-gate validates an incoming one with it |
| `refresh-freshness.js` | `shared/refresh-freshness.js` | `1.0.0` | 2026-10-06 | `bae02ce0aff9bba6…` | how far behind a pacing's data is, and the words for it |

Verify any row with:

```
shasum -a 256 ~/Desktop/work/paicing-azat/AIAE-paicing/shared/<file> \
              frontend/src/features/pacing-dashboard/vendor/<file>
```

These are reached by two kinds of importer: this feature's own TypeScript, through `loader.ts`
(`dash-blocks` today), and the moved SPA modules under `../spa/`, which still write
`@shared/report-v2` and are pointed here by an alias in `vite.config.ts` / `vitest.config.ts`.

## Do not edit

No reformatting, no TypeScript conversion, no lint or prettier fixes, no "while I'm here" tidying.
Not because the code is precious, but because the copies must stay identical: a cosmetic edit here
turns the next real update on the Pacing side from a copy-over into a merge, and buys nothing. The
same ban is written on the other side, in `AIAE-paicing/CLAUDE.md`.

The sibling `.d.ts` files are **ours**, written here, and are not part of what gets re-copied — see
`../engine/vendor-types.d.ts`'s header for why a relative `.js` import needs a same-named sibling
declaration rather than an ambient module block. `loader.ts` is ours too.

## Nothing compares the two copies

No CI job, no test, no bot, in either repository. A stale copy here passes every test in this
repository, because every test compares it against itself.

So when `AIAE-paicing/shared/dash-blocks.js` changes: copy it here, update the row above, and **say
it in the report as a headline, not a footnote** — which file, and that this copy needed the same
change. That report line is the only mechanism that exists.

## Expected to grow

The widget Builder is being brought over from Pacing's retired SPA. It needs the rest of the grammar
these modules belong to: `report-v2.js`, `widget-metrics.js`, `std-entries.js`, `lib-refs.js`,
`layout-materialize.mjs`, `layout-geometry.mjs`, `value-labels.js`. They land here, each with its own
row in the table above. The table is per-file on purpose: these modules do not arrive together and
will not be re-synced together.

## Re-copied 2026-10-06 — the reference catch-up

`report-v2.js` (`6f929f1010bc8343…`), `std-entries.js` (`5e49c6e3bf49bb6f…`) and
`widget-metrics.js` (`6c2e36e8f97c3857…`) were re-copied, and the three new rows above landed, when
`AIAE-paicing` took the maths it was missing from `ogan-team` (2026-09-29 … `c8a725d`). What moved
in each:

- `report-v2.js` — formula chips (`39884a0`..`445b94e`): a formula slot now holds `{expr, chips}`,
  not a string, and the grammar reads and normalizes the chip map. Also `tickFormat`, the progress
  bar's marker format (`3679c20`).
- `std-entries.js` — 32 Standard templates became **34**: «Impressions to Hit Budget»
  (`706f42e`/`915d01d`) and the Line items table (`85d353c`). Neither is the sections cutover —
  that shrinks `dash-blocks.js`'s block-id domain, and both of these leave it alone, which is why
  they could come while the cutover still cannot.
- `widget-metrics.js` — the eleven `hitBudget*` canonical metrics. This file is the vocabulary a
  settings save is checked against, so it and `std-entries.js` move together or not at all.

The grammar epoch was deliberately NOT bumped. The reference went 7→8 for chips and 8→9 for
`tickFormat`; `AIAE-paicing`'s server sits at 2, and epochs 3–7 include the sections cutover it has
not adopted, so claiming 9 would advertise a capability it does not have. The client-side constant
in `../spa/report-v2.js` does read 8 — it is inert here, because this app echoes the `capabilities`
object the server sends rather than constructing the marker itself (see `../api.ts`).

OUR DIVERGENCE in `formula-chips.js`, not to be overwritten by the next sync: the line filter names
`cpi` and the catalogue offers «CPI lines». The reference has no CPI rate type, and its filter was
written as «not CPC and not CPV», so an install-paced line passed as impression-paced — which is
also the DEFAULT a rate chip picks. Guarded by `AIAE-paicing/tests/rate-type-units-test.mjs`.

## dim-value-groups.js (added 2026-10-05)

`AIAE-paicing/shared/dim-value-groups.js`, copied byte-identical, same obligation as the rest of
this directory. It is the SAVE half of value groups (spec 2026-10-02) - what a line item's
dictionary may hold, which dash-gate's `db.mjs` and `api-routes.mjs` enforce on every save and
create. The READ half (the rewrite itself) lives in `../engine/vendor/pacing-core.js`.

Reached here only through `../spa/dim-value-groups.js`, the door module moved from the retired
SPA; nothing else in this app imports it directly. Aliased as `@shared/dim-value-groups` in
`vite.config.ts` and `vitest.config.ts`.

