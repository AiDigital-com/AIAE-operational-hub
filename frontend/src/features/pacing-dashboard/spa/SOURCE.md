# Moved from Pacing's retired SPA

49 JavaScript modules from `AIAE-paicing/workspace/src/` — the pure-logic half of the widget
builder and of the dashboard calculation pipeline. Taken from the `ogan-team` branch (commit
`823a42d`, copied 2026-10-01), which is the reference checkout for that app.

**A move, not a vendor.** The distinction matters and is the reason this folder is not
`../vendor/`:

- `../vendor/` and `../engine/vendor/` hold **copies of files that still live and change in
  `AIAE-paicing/shared/`**. Each one is a sync obligation: change it there, copy it here, say so.
- These files have no such twin. `workspace/` is retired — not built, not served, kept only as a
  visual reference — so nobody will update the originals. Moving them here makes this the only
  copy, which is why the "do not edit" rule does **not** apply: once the builder is on, these are
  ordinary source files of this app.

**Why moved rather than rewritten in TypeScript.** 21 000 lines of widget-grammar and money
arithmetic retyped by hand is 21 000 chances to fumble a rule, against a reference nobody can
diff. The owner's call (2026-10-01): drag it over.

## What was changed

Nothing inside any function. Only import specifiers, so the files resolve in this tree:

| Was | Is |
|---|---|
| `../pacing-core.js`, `../settings/dim-sources-norm.js`, `../mapping/*.js`, `../../pages/Dashboard/components/Charts/chart-format.js` | `./<same file>.js` — those five modules were copied in beside the rest instead of keeping four levels of the SPA's folder tree |
| `../../../../shared/layout-materialize.mjs`, `layout-geometry.mjs` | `../vendor/<same>` |
| `@shared/*` | unchanged — resolved by an alias in `vite.config.ts` and `vitest.config.ts`, so these files still read the way they do in Pacing |

The `@shared/*` alias maps module by module rather than folder to folder, because the vendored
copies sit in two places on purpose (`engine/vendor/` for the calculation engine, `vendor/` for the
grammar). The alias map in `vite.config.ts` carries the long version of that reason.

## How they are typed

They are not. `tsconfig.json` sets `allowJs: true` and `checkJs: false`: TypeScript infers what it
can at the import boundary and does not demand annotations inside. A consumer that needs a real
contract declares it on its own side — `widgets/widget-tiles.ts` is the worked example.

## State

**The renderer is live.** `widgets/report-board.tsx` draws the dashboard through
`report/ReportWidget.jsx`, replacing the hand-written `widgets/widget-engine.tsx` that covered three
of the grammar's eight view kinds. A `table` widget — the most common thing built in Pacing's
builder, and three of the 32 Standard templates — now draws instead of showing "Unsupported view
kind". Proven end to end on the page in `../pacing-dashboard.test.tsx` and in isolation in
`renderer-loads.test.tsx`, both over Pacing's own Standard definitions rather than hand-made specs.

Also wired: `widgets/widget-tiles.ts` re-exports Pacing's `WIDGET_CAP`, `newWidgetId` and
`copyWidget` instead of its earlier hand-ports.

Not moved yet: the builder's **UI** (`pages/Dashboard/components/Settings/Widgets/**`, about 13 600
lines of JSX) — so a widget can be rendered here but not yet authored here. That phase is JSX → TSX
(or, as it turned out for the renderer, no conversion at all), the `.sp-*` slice of the SPA's
`index.css`, and `ReportBuilder.jsx`, which reaches for the SPA store the way the four renderer
files did and can go through the same seam.

The library panel's card thumbnails still draw through the Hub's own `widget-engine.tsx` /
`brick-registry.tsx` / `chart-view.tsx`. Moving them onto the real renderer is what makes those
~1 400 lines deletable.

## Line Items (PDI_167, 2026-10-01)

`lineitems/` is the fourth move into this folder, and the first of a whole page BLOCK rather than of
pure logic: `LineItemCard.jsx`, `SplitRow.jsx`, `Timeline.jsx`, `PaceBar.jsx` from Pacing's
`pages/Dashboard/components/LineItemList/`, plus `LineItemsTile.jsx`, which is the `LineItemsTile`
entry lifted out of Pacing's `tile-registry.jsx` together with the `SectionCard` / `SectionBoundary`
wrappers it renders inside.

Three more pure modules came with them because nothing here had them yet: `containers.js`,
`split-metrics.js` and `currency-marker.js`. Everything else the block reads — `metrics.js`,
`selectors.js`, `config.js`, `dim-scope.js`, `primary-cv.js`, `format.js` — was already here, which
is most of why this was a move and not a rewrite.

Changed, as everywhere in this folder, only outside function bodies:

| Was | Is |
|---|---|
| `../../../../hooks/useDashboard.js`, `stores/dashboardStore.js`, `hooks/useUrlFilters.js` | `../store.js` — the seam, which grew `useCardLIs`, `useEffRange`, `useBreakdownFacts` and `useSplitScopedMode` for this |
| `../../../../lib/dashboard/*`, `../../../../lib/*` | `../*` |
| `lazyWithRetry(() => import('./SplitRow.jsx'))` | `lazy(...)` — every other lazy boundary in this app is plain `React.lazy`, and the retry wrapper's job (hard-reloading a tab holding pre-deploy chunk hashes) has no counterpart here |

### What it replaced

`containers-table.tsx` is gone. It showed the container readings a card now carries, so keeping both
would have printed the same figures twice on one page — and it hid itself entirely when a pacing had
no containers, which left a line-item-level plan with nowhere to see its line items at all. The
`metrics.containers` computation behind it stays: the engine builds it and the crown test pins it.

### What had to be supplied

`pacing-spa.css` gained `.lis-view` and `.lis-ch-head` (copied from Pacing's `index.css`) and the
`--tl-0..5` / `--edge` tokens in both themes; `tailwind-subset.css` gained 80 utilities. All of them
were found by collecting the class names off the LIVE DOM of the rendered block — the method this
folder's history demands, because the original extraction scanned for `class="..."` literals and
missed everything composed at runtime. `lineitems/line-items-styles.test.tsx` runs that same pass as
a test, so the next edit to a `className` in here reports itself.

### Known, and left as the reference has it

- The **All lines / By channel** switch does not mark which side is active. The markup puts a
  `confirm` class on the chosen button and neither this app's stylesheet nor Pacing's own defines
  `.sp-tp-link.confirm` — only `.sp-tp-link-danger.confirm`. Pacing has the same gap on the same
  control; fixing it here would be a change to the block, not a move of it.
- The block renders even with **no line items** — Pacing's registry entry carries no `visible`
  predicate — so an empty plan shows the card, its heading and the search box with nothing under
  them.
- `SectionCard` draws Pacing's card chrome (`--dash-radius-card`, 6px) while this app's own panels
  beside it use `--radius-lg` (10px). The borders and the heading type are within a pixel of each
  other; the corner radius is the visible difference.

## Updated 2026-10-05 — value groups

Five files here moved again, carrying Pacing's value-groups change (`AIAE-paicing` commit
`a33ba97`, taken through the `paicing-azat` checkout on branch `1.0.0`): `normalize.js`,
`containers.js`, `coef-rebuild.js`, `widget-data.js`, and the new door module
`dim-value-groups.js`. Import specifiers were rewritten the same way as the original move and
nothing inside a function was touched.

Two files beside them are this app's own seam and were edited by hand, not moved:
`store.js` (`usePacingState` now groups the payload's row slices before anything normalizes them,
and keeps the fetched slices on `rawData`) and `report/useWidgetData.js` (hands the renderer the
rewrite index as `dimGroupIndex`).

NOT brought over, and deliberately: the CM360 half of the change (`report-render.js`'s join,
`mapping/group-label-join.js`, `mapping/line-join.js`). It hangs off `third_party`/`mappings_v3`,
which this app's dashboard payload does not carry at all - see `../types.ts`'s
`PacingDashboardV1`. Also not brought over: Pacing's Settings → Pacing editor for authoring a
dictionary, which is JSX against the SPA's own drawer. Until that exists here, a group can be
read on this screen but not created on it.

## Updated 2026-10-05 — the buy unit

Seven more files moved again with Pacing's buy-unit fix: `brick-data.js` (the seven `unit*`
canonical metrics and the `unit: 'buy'` plan gate), `widget-data.js` and `widget-formula.js`
(`clExpected`), `metric-catalog.js` and `report-render.js` (their labels and formats),
`widget-highlights.js` (the buy-unit metrics' facts follow the resolved unit) and
`standard-conversion-format.js` (the read-time upgrade for stored copies of both definitions).
Import specifiers rewritten as before; nothing inside a function touched.

Covered by `rate-type-units.test.ts` beside them, which checks the behaviour HERE rather than
trusting that the vendored copies were re-copied.

## Updated 2026-10-05 — CPI

Four more files moved again for the fourth rate type: `metrics.js` (the `installs*` family in
campM, and `domRateType`), `widget-status.js` (`UNIT_FIELDS.installs`, `primaryUnit`),
`brick-data.js` (the installs plan gate, `neededPerDayInstalls`) and `auto-controls.js` (the
buy-unit map). `metric-catalog.js`, `report-render.js` and `widget-data.js` carry their labels
and the impression-paced gate.

CPI is NOT in Pacing's reference checkout — it diverges there on purpose, which is written down
in `AIAE-paicing/CLAUDE.md`. `rate-type-units.test.ts` beside these files covers all four units.


## Updated 2026-10-06 — the reference catch-up

`AIAE-paicing` took the maths it was missing from `ogan-team` (everything that branch gained
between 2026-09-29 and its head `c8a725d`, bar the CM360 join), and the moved copies here were
brought along with it. 45 files touched, 9 new. What a user can see:

- **Formula chips** (`39884a0`..`445b94e`, 26 commits). A formula is no longer a string the author
  has to remember: it is chips with suggestions, each carrying its own settings — period, which
  lines, which unit, how many days, which source. The engine is the new `chips/` folder, eight
  modules; the editor is `builder/TokenField.jsx` and `builder/ChipSettingsPanel.jsx` (new), with
  `builder/FormulaField.jsx` and `builder/FormulaEditorDialog.jsx` rewritten around them. Legacy
  text formulas are shown as chips automatically (`chips/migrate.js`). `and()` and `or()` join the
  formula functions in `widget-formula.js`.
- **A campaign's days left and «Needed per day»** (`972f994`): `pacing-calc.js` gains
  `campaignSpan`, `metrics.js` sums the need line by line, `layout-readings.js` reads «Day X of Y»
  off the campaign's own flight, and `brick-data.js` writes the note under the figure from the new
  `needed*Basis`. This fixes a pacing printing «Flight ended» while two of its fourteen lines still
  ran.
- **«Impressions to Hit Budget»** (`706f42e`, `915d01d`): the metrics in `metrics.js` /
  `brick-data.js` / `metric-catalog.js` / `widget-highlights.js`, the card in
  `../vendor/std-entries.js`, and the read-time upgrade of its first CPM-only version in
  `standard-conversion-format.js`.
- **Line Items column settings** (`85d353c`): `line-item-columns.js` and `display-norm.js` (both
  new). The engine is here and validated; PERSISTENCE IS NOT — that needs a dash-gate migration
  `AIAE-paicing` has not taken, so a change made in this UI will not survive a reload.
- **Data freshness** (`85d353c`): `refresh-freshness.js`, `relative-time.js` (both new).
- **Chart guides and the progress bar's marker** (`3679c20`): `brick-data.js` learns the format a
  field prints in when none is named.

Not moved, on purpose: `filter-spotlight-core.js` (this app has its own filter bar, and the
reference's version needs three more modules that were never taken), `auto-refresh.js` (it drives a
dash-gate lane that was not ported), and `ChipStrip.jsx` (dead in the reference too once the real
chip field landed).

### Two layering numbers were rebased, and they were already wrong

`FormulaEditorDialog.css`'s `.fxd-scrim` (150 → **305**) and `ChipSettingsPanel.jsx`'s `PANEL_Z`
(160 → **310**). Both came over with Pacing's own z-index scale, where the settings drawer sits at
100 — here it is `.sheet__overlay` at 300, so the whole formula editor painted UNDERNEATH the drawer
that opened it. This is the same rebase `pacing-spa.css` already records for `.sp-pop` and
`.sp-spot-scrim`; these two arrived in a later commit and were missed. The ladder is now
drawer 300 < dialog 305 < popovers and the chip panel 310 < Spotlight 320 < tooltip 330. Pacing's
own 150/160 are correct against its drawer at 100 — do NOT carry this change upstream.

### Our divergence from the reference

The chip line filter names `cpi`, and the catalogue offers «CPI lines». The reference has no CPI
rate type and wrote the test as «not CPC and not CPV», so an install-paced line passed as
impression-paced — in `chips/line-facts.js` twice and in `chips/resolve.js`, where it also summed
an install goal into plan CPM. `impressionPaced` is the first entry of the rate-chip option list,
so that wrong answer arrived by default. Guarded by
`AIAE-paicing/tests/rate-type-units-test.mjs`.
