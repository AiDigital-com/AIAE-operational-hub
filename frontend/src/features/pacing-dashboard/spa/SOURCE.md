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

The CM360 half of the change was NOT brought over at the time, because `third_party` and
`mappings_v3` were absent from this app's dashboard payload. **Both are on the payload now, and
the CM360 half landed 2026-10-09** - see "The CM360 joins" below.

Still not brought over: Pacing's Settings → Pacing editor for authoring a value-group dictionary,
which is JSX against the SPA's own drawer. A group is read on this screen but not created on it.

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
  new). Wired end to end on 2026-10-14 - see "the Line Items block's settings" below. (This line
  used to say persistence needed a dash-gate migration. It did not: dash-gate here keeps no display
  history, so the reference's migration 052 has nothing to change.)
- **Data freshness** (`85d353c`): `refresh-freshness.js`, `relative-time.js` (both new).
- **Chart guides and the progress bar's marker** (`3679c20`): `brick-data.js` learns the format a
  field prints in when none is named.

Not moved, on purpose: `filter-spotlight-core.js` (this app has its own filter bar, and the
reference's version needs three more modules that were never taken), `auto-refresh.js` (it drives a
dash-gate lane that was not ported), and `ChipStrip.jsx` (dead in the reference too once the real
chip field landed).

### Two layering numbers were rebased, and they were already wrong

`FormulaEditorDialog.css`'s `.fxd-scrim` (150 → **324**) and `ChipSettingsPanel.jsx`'s `PANEL_Z`
(160 → **326**). Both came over with Pacing's own z-index scale, where the settings drawer sits at
100 — here it is `.sheet__overlay` at 300, so the whole formula editor painted UNDERNEATH the drawer
that opened it. This is the same rebase `pacing-spa.css` already records for `.sp-pop` and
`.sp-spot-scrim`; these two arrived in a later commit and were missed. The ladder is now
drawer 300 < popovers 310 < Spotlight 320 < formula dialog 324 < chip panel 326 < tooltip 330 — the
same order as Pacing's (popover 120 < Spotlight 130 < dialog 150 < chip panel 160). The first rebase
put the dialog at 305, under the popovers, and a dialog opened FROM a popover (a table's Highlight
settings → ƒx formula) then slid under it, with its Apply button covered. Pacing's own 150/160 are
correct against its drawer at 100 — do NOT carry this change upstream.

### Our divergence from the reference

The chip line filter names `cpi`, and the catalogue offers «CPI lines». The reference has no CPI
rate type and wrote the test as «not CPC and not CPV», so an install-paced line passed as
impression-paced — in `chips/line-facts.js` twice and in `chips/resolve.js`, where it also summed
an install goal into plan CPM. `impressionPaced` is the first entry of the rate-chip option list,
so that wrong answer arrived by default. Guarded by
`AIAE-paicing/tests/rate-type-units-test.mjs`.


## Updated 2026-10-09 — the CM360 joins

`line-join.js` and `group-label-join.js` moved in beside the others, and `report-render.js` was
rebased on the reference's copy to pick up the wiring that hangs off them. Two things this app
could not do before:

- **CM360 per line item** (`docs/2026-09-29-cm360-by-line.md`): the reader gained `atLine`,
  `atDateLine` and the «Other CM360» remainder, and `cmRowJoin` now emits the `line` / `dateLine` /
  `lineOther` grains. Before this, a widget whose rows were line items produced no join at all and
  the CM360 column was blank.
- **CM360 beside a grouped dimension** (value groups, spec 2026-10-02): `atLabel` takes the row's
  dimension, and where any line groups values on it the pivot is read again through each line's own
  dictionary. Before this, a line that reads TX and FL as South got its CM360 attributed to the row
  TX, leaving South empty.

`compare-dataset.js` is byte-identical to the reference again: it carries `dimGroupIndex`, which
`report/ReportWidget.jsx` fills with `groupIndexOf(liPlan)`.

NOT taken from the reference's `report-render.js`, deliberately: this app's CPI/installs labels and
the buy-unit seven in `V2_CANON_LABELS`. CPI does not exist on the reference side at all (see the
root `CLAUDE.md`), so a wholesale copy would have deleted it. Those seven lines are the only place
this file diverges; everything else is the reference's, verbatim.

## Updated 2026-10-13 — the builder's confirm dialog

`ConfirmModal.jsx` is centred by Tailwind's `fixed inset-0`, and neither class was in
`tailwind-subset.css`: the dialog fell into normal flow at the foot of the Widget builder, so
"Remove this element?" could only be found by scrolling. Both are in the subset now.

Its two buttons now wear this app's `.button` family — `button--ghost` Cancel, `button--danger`
for the destructive answer, plain `.button` for a non-destructive primary (`confirmColor:
'var(--accent)'`) — the pair the Hub's own delete dialogs use. Pacing's utility classes and inline
colours drew a bordered native Cancel and a filled red Remove here, with no preflight to strip the
browser's button chrome. This is the one change inside a function in that file; Hub-only, do not
carry it upstream.

## Updated 2026-10-13 — the sections cutover

Breakdown and Daily Performance are Standard widgets on the board now, as in the reference, so the
page's own `BreakdownPanel` and `DailyTable` are gone (the helpers under `../breakdown/` stay:
`dim-runtime.js` and `mapping-columns.js` read `dim-coverage`).

`store.js` grew the «See in Breakdown» handoff the reference keeps in its Zustand store:
`setDimensionHandoff` / `bindDimensionHandoff`, and `useDashboardStore.getState()` for the one
caller outside a render (`report/useReportControls.js`). The axis lives in the module, not in React
state, because that caller relies on a CURRENT read to decide which of two tiles took it first; the
page mirrors it into state only to re-render the tiles. `../pacing-dashboard.tsx`
`openBreakdownFromMapping` is the reference's `SettingsDrawer.jsx` handler, addressed to the board.

The reference's one-shot auto-add (`dashboardStore.js` `applyAutoAdd`, called by `DashboardShell.jsx`
after every load and by the drawer after a CM360 save) is ported as `../widgets/auto-add.ts` plus an
effect in `../pacing-dashboard.tsx` that runs after every payload fetch — the drawer's save refetches,
which covers its call too. It mints the rate-type charts and, since the cutover, «Delivery vs CM360»
where a 3rd-party source is configured, and stores the receipts in `display.autoAdded`.
`../widgets-section.tsx` learns of tiles that land behind an open draft (the reference's
`rebaseFromStore` / minted-tile append), because its save sends `widgets` whole under the live
revision and would otherwise delete them. dash-gate's `settings-audit.js` keeps such a save out of
Slack.

## Updated 2026-10-14 — clear the paused state after Resume (reference `a51e361`)

`metrics.js` and `line-item-columns.js` take the reference's change verbatim: a line's daily need
and campM's paused-remaining goals read `PacingCore.isLiPausedNow` instead of `isLiPaused`, so a
line resumed while the data date still sits inside its now-closed pause demands delivery again.
Our CPI bucket in `metrics.js` reads it too. `chips/line-facts.js`, `lineitems/LineItemCard.jsx`
and `lineitems/SplitRow.jsx` changed comments only. The behaviour itself lives in
`../engine/vendor/pacing-core.js` (`isLiPausedNow` / `isLiAutoPaused`), re-copied the same day.

## Updated 2026-10-14 — Period Scope

`store.js` no longer pins `splitScopedMode` / `splitScopedPlans` / `selectedPeriodKey` to off.
`usePacingState` resolves them the way the reference's `dashboardStore.js` `load` does - the payload's
`campaign.periodScope` / `periodScopeKey` through `resolvePeriodKey` and `buildScopedPlansForPeriod` -
plus `periodScopeState`, and takes the page's optimistic `periodScopeOverride` while a change is being
saved. New hooks `useSelectedPeriodKey`, `usePeriodScopeState` and `periodsOf` (the reference's
`usePeriods.js` cache). Every moved selector, widget and split row already read these fields, so this
alone switched them on. The toggle, the picker and the banner are this app's own
(`../filters/period-scope.tsx`); the save is `POST /api/v1/pacing/dashboards/{slug}/period-scope`.


## Updated 2026-10-14 — the container editor's split tools and value groups

Two moved in for the plan editor (`../../pacing-plan/`), byte for byte apart from import paths:
`dim-groups-editor.js` (reference `lib/settings/dim-groups-editor.js`: what the dim split menu and
the value group editor list, tick and refuse) and `container-warnings.js` (reference
`pages/Dashboard/components/Settings/container-warnings.js`). `Popover.jsx`, `ui/Popover.jsx` and
`menu-placement.js` were brought up to the reference's current copy, which adds `align: 'start'`
(the group editor opens from the start of a row); the default stays `'end'`, so existing callers
draw as before.


## Updated 2026-10-14 — the Line Items block's settings, value-group members, CPI on split rows

**From the reference, moved again.** `lineitems/LineItemCard.jsx`, `SplitRow.jsx` and `PaceBar.jsx`
are the reference's current copies (`85d353c` Line Items settings, `a33ba97` value groups,
`a51e361` comments), import specifiers rewritten as before and `lazyWithRetry` → `lazy` as in the
first move. `lineitems/LineItemsCustomize.jsx` is new, moved from the reference's
`Settings/Widgets/LineItemsCustomize.jsx`. `lineitems/LineItemsTile.jsx`'s function body is the
reference `tile-registry.jsx` `LineItemsTile`, verbatim. What a reader sees:

- The card prints the columns `display.lineItems.columns` names, in that order (`cellFor` in
  `line-item-columns.js`), and its split rows print one cell per column so they line up; the tile
  sorts (`sortLineItems`), opens on the stored view, and shows the stored number of rows before
  "Show all". Nothing stored ≡ today's render.
- A dim split row whose value is one of the line's value groups carries an "N values" toggle and
  opens into its members, each with its own delivery (`sumDimMembers`, which was already here).

Outside function bodies: `SectionCard` takes a `menu`, and `LineItemsTile` hands its `menu` prop
to it - this app's ⋯ in the card header, where every other tile on the board carries its menu,
rather than floated over the cell as the reference's grid does.

`pacing-spa.css` gained `.li-row`, the `--li-cols` split-row grid, `.sp-vg-toggle` and the member
rows, the 960 px / 700 px rules for both, and the `.lic-*` editor rules (from the reference's
`DisplaySettings.css`). The split row's old fixed 56 px spacer and five/six columns (`data-conv`)
are gone with the reference's. The editor's rules differ in three places, said in the file: its
↑ ↓ are scoped under `.lic` (the reference scopes them under its `.settings-drawer`), the narrow
layout is an `@container` on the hosting card (the reference has a `settings` container), and the
app-wide `input, select { min-height: 42px }` is undone for its controls. `tailwind-subset.css`
gained `flex-[0_1_56px]`, `min-w-[20px]` and `rotate-90` - the last was missing before this too: a
card's chevron never turned when opened, and `line-items-styles.test.tsx` did not see it because
it clicked the row (which selects) instead of the chevron (which opens). It clicks the chevron now
and asserts a split row is on screen.

**This app's own half** (ordinary TypeScript, not moved): the tile's ⋯ → Customize…
(`../widgets/report-board.tsx`), the drawer's deep-open (`../pacing-dashboard.tsx`,
`../pacing-settings-drawer.tsx`), the «Page sections» Line Items card with its Customize disclosure
on the widgets tab (`../pacing-dashboard-library.tsx`, the reference's `BlockLibrary.jsx` card),
and the draft key in `../widgets-section.tsx`, which compares it the way the reference's
`display-norm.js` does (absent, null and the defaults are one setting) and sends `null` for «Reset
to default». NOT taken from the reference's block menu and card: «Turn off» and the on/off switch,
and «Show description» - neither was on this tile here before, and a Turn off with no switch to
undo it would strand the block.

### Our divergence from the reference: CPI

The reference has no CPI rate type, so it prices a CPI line as CPM and counts its impressions. Ours
counts installs = conversions (`PacingCore.liActualUnits`), and the card's units cell already did
through `liM`. Brought in line, deliberately:

- `lineitems/SplitRow.jsx`: `nativeUnits` reads `cv` and `rtCost` is spend / conversions on a CPI
  line; a member's units and its rate cell likewise, and both print a dash where the member has no
  conversion number of its own (primary conversions on the line - the Conv cell's own rule).
- `line-item-columns.js` `rateCostOf`: the card's CPI cell is spend / conversions. It printed the
  line's CPM under the label «CPI» before, and the split rows below it would now have disagreed.

Covered by `lineitems/line-item-settings.test.tsx`.


## Updated 2026-10-14 — Settings → Display and Layout mode, moved whole

The Hub's own widgets tab (`pacing-dashboard-library.tsx`, `widget-editor.tsx`, `widget-preview.tsx`)
is GONE. In its place is Pacing's Display tab and Pacing's Layout mode, moved as code, so the two
behave the way the reference does rather than the way a rewrite remembered it. Owner decisions
(2026-10-14): the arrangement History is not taken, library entries have no visibility (all are
visible to everyone), groups are made in Layout mode only.

**Moved** (import specifiers rewritten, nothing else unless listed below):

- `display/`: `BlockLibrary.jsx` (the tab: Page sections, the gallery, the Library and its door),
  `WidgetGallery.jsx`, `LibraryScreen.jsx`, `GroupsSection.jsx`, `ShareEntryDialog.jsx`,
  `WidgetLinkMenu.jsx`, `BlockThumb.jsx`, `Switch.jsx`, `current-tiles.js` (from
  `pages/Dashboard/components/Settings/Widgets/`) and `useEnabledSwitch.js` (from `hooks/`).
- `layout/`: `LayoutMode.jsx`, `DragOverlay.jsx` (from `pages/Dashboard/components/Layout/`).
- `library-reconcile.js`, `layout-preview.js`, `layout-ops.js`, `layout-motion.js` (from
  `lib/dashboard/`), `builder/widget-drafts.js`. `LaunchPlanCard.jsx` and `launch-plan.js` earlier
  the same day. `display-norm.js` (moved before) had a stale import path and had never been loaded;
  fixed to `./line-item-columns.js`.
- `display-layout.css`: the rules those files need that `pacing-spa.css` did not carry, extracted
  from the reference's `index.css` and `DisplaySettings.css` (header in the file).

**Changed inside moved files**, each for an owner decision:
- `display/BlockLibrary.jsx`: the History button and screen are removed.
- ~~`display/ShareEntryDialog.jsx`, `display/WidgetLinkMenu.jsx`: the Visibility pills are not drawn
  (the choice stays `team`); `display/LibraryScreen.jsx`: the card menu's visibility flip is removed.~~
  Reversed 2026-10-26, see below: the three are the reference's again, bar import specifiers.
- `LaunchPlanCard.jsx`: `UNIT_SHORT` gained `CPI: 'installs'` (ours - the reference has no CPI).

**This app's own seam**, ordinary code beside the moved files:
- `tile-registry.jsx`: `DeferredMount`/`SectionSkeleton` verbatim, and `FLOW_REGISTRY` - Launch Plan
  and Line Items are moved code; Alerts and the journal are this app's components, built by the page
  and handed in on the state seam as `sections`, because the registry's components take no props.
- `store.js`: `getState()` answers the live `display`, `displayRev`, `capabilities`; the state carries
  `libraryEntries`, `slug`, `sections` and the drawer's draft preview (`displayOverride`); hooks
  `useLibraryEntries`, `useResolvedWidgets`; `api.library.*` and `api.me` delegate to the page. The
  payload-derived half of `usePacingState` is memoized apart from the cheap overlay.
- `../spa-library-api.ts`: `api.library`/`api.me` over this app's client - camelCase rows mapped to
  Pacing's snake_case ones (`standard` = a `std:` key, `owner_id` = the `mine` flag as `ME`), refusals
  thrown the way Pacing's apiFetch throws them.
- `../pacing-dashboard.tsx` `widgetActions.saveSettings`: every display write the moved code makes;
  `display_rev` goes out exactly as the caller sends it (absent on a per-entry patch - the Hub's
  contract made it optional for this), the answer is adopted into the cached payload unless a newer
  one already was. `mergeLibraryEntries` merges into the payload's `libraryEntries`.
- `../widgets-section.tsx`: the reference drawer's display half - the draft, `normDisplay` dirty, the
  `buildConfig` display patch (no `enabled`/`groups`/`layout`), the save/reset epochs, the deep-opens,
  the display-cas gate and re-base, and the 200 ms draft preview on the board.
- `../pacing-dashboard.tsx`: Layout mode's button beside the gear (900 px and up), the board swapped
  for `LayoutMode` while it is open, the filter bar inert meanwhile, "+ Add" opening Display's
  Library. The four page sections are flow tiles of `../widgets/report-board.tsx` on the reference's
  slots (Launch Plan 100, Alerts 400, Line Items 600, Journal 1100), with the corner ⋯ (Turn off).
- `../spa-toast-bridge.tsx`: the moved code's `toast()` reached nothing (its sink was never mounted);
  it now surfaces as this app's toasts. `remix-icons.css`: the seven Remix glyphs the moved code asks
  for by class, drawn as masks - Pacing loads the whole font from a CDN; nothing here did, so they
  were blank (the Line Items «Customize» chevrons among them).

Covered by `../page-sections.test.tsx`; the drawer and section tests stub the moved tab.

## Updated 2026-10-15 — Delivery tab in source sheet

`delivery-gate.js` moved in byte-identical from `workspace/src/lib/settings/` (the same in the
reference): the cell ceiling and the sentence under the switch. `../data-panel.tsx` uses it with
`ConfirmModal.jsx` for the reference's «Delivery tab in source sheet» switch, now the first row of
the section renamed from «Client cost» to the reference's «Advanced settings». The Hub's contract
gained `deliveryTab` on the data-settings save and `deliveryStats` on the dashboard payload;
dash-gate already stored, built and mirrored the tab.

## Updated 2026-10-26 — Only me / Team, and the Layout picked at create

The 2026-10-14 decision that library entries have no visibility is reversed. It hid a real loss:
Pacing's database never had the column, so the legacy import dropped it and every entry that was
private on the old Pacing came over shared with everyone. dash-gate now has the column back
(`migrations/0011_library-visibility.sql`, the reference's 045) and the reference's flip route.

- `display/ShareEntryDialog.jsx`, `display/WidgetLinkMenu.jsx`: the Visibility pills are drawn again;
  `display/LibraryScreen.jsx`: the card menu's "Make it only me" / "Share with team" is back. All
  three now differ from the reference only in import specifiers.
- `../spa-library-api.ts`: Share carries the chosen visibility, `setVisibility` calls
  `PUT /api/v1/pacing/library/{id}/visibility`, rows carry `visibility`.

The create screen's "Dashboard layout" picker is this app's own TypeScript, not moved code: the
reference's `CreatePacing.jsx` select is rebuilt in `../../pacing-create/create-pacing-panel.tsx`
(Settings block, first row), its `lib/create-layout-options.js` ported to
`../../pacing-create/layout-options.ts`. dash-gate's `lib/creation-layout.mjs` is the reference's,
byte for byte.

