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
