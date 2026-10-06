# Vendored from AIAE-paicing

The six files in this directory (`dashboard-metrics.js`, `pacing-core.js`, `metric-registry.js`,
`currency.js`, `dashboard-metrics-glue.js`, `alerts-core.js`) are **byte-identical copies**, not a
port. The first four are Pacing's own calculation engine — the same one `dash-gate/lib/merge.mjs`
calls server-side to build `PacingDashboardV1.metrics` — moved into the browser so filters can
recompute the same figures locally (Operational Hub migration §6/filters). The fifth,
`dashboard-metrics-glue.js`, is `buildMetricBag` itself - `merge.mjs`'s own "dashboard response ->
metrics bag" glue function, extracted into `AIAE-paicing/shared/` with no behaviour change (FIX 3,
crown-test hardening) so the crown test (`../build-metrics.crown.test.ts`) can call Pacing's REAL
implementation instead of a hand-written TypeScript re-port of it that could silently drift from
what it's meant to verify. It is loaded only by `../engine-loader.ts`'s `buildServerMetricBag`,
whose only caller is that test - `build-metrics.ts` itself never touches it (it needs
`effLIs`/`range` parametrized by filters, which `buildMetricBag` does not take). The sixth,
`alerts-core.js`, is the shared alert-detection core `dash-gate/lib/health.mjs` (server) and the
retired SPA's own `AlertsBlock.jsx` (browser) both already call - vendored so `../build-alerts.ts`
can compute this pacing's alerts in the browser too, filter-aware, instead of only ever reading the
server's unfiltered `PacingRowV1.alerts` (2026-09-25 filters follow-up, item 3).

- Source repo: `AiDigital-com/AIAE-paicing`
- Source path: `shared/`
- Commit copied from (`dashboard-metrics.js`, `pacing-core.js`, `currency.js`,
  `dashboard-metrics-glue.js`): `e161b91edbb6f2bc3666c69f9240e6778e0a0a94` (copied 2026-09-25, from
  the `paicing-azat` checkout)
- Commit copied from (`alerts-core.js`): `1c57d45` (copied 2026-09-25, from the `paicing-ogan`
  checkout - the read-only reference repo for that day's task; the file is byte-identical between
  both checkouts at copy time, `diff -q` confirmed, so the two sources agree on content even though
  their commit SHAs differ)
- Re-copied 2026-10-01 (`metric-registry.js`): the `paicing-azat` working tree on branch `1.0.0`,
  which had just taken this file from `ogan-team` at `823a42d` as part of the `shared/` sync. The
  registry went from 8 mart metrics to 15 - the video and engagement keys `st` (starts), `q1`/`q2`/
  `q3` (quartiles), `rc` (reach), `lc` (link clicks), `vi` (viewable impressions), plus the derived
  `dc` (dynamic cost) - and `BUILT_IN_KEYS` from 7 sheet roles to 14. A widget naming one of those
  keys is refused as unknown by any copy still on the old list, which is why this one could not stay
  behind. Named as a working tree rather than a commit because the sync was not committed when the
  copy was taken; `diff -q` against `AIAE-paicing/shared/metric-registry.js` is the check that
  matters, not the SHA.

- Re-copied 2026-10-05 (`pacing-core.js`, `dashboard-metrics.js`): the `paicing-azat` working tree
  on branch `1.0.0`, which had just taken Pacing's value-groups change from `ogan-team` at
  `a33ba97` plus the date-child budget fix at `5b77324`. Two behaviour changes, both money:
  `buildVirtualPlanFromDateChild` now reads a selected month's OWN spend as its period budget
  (its `target_spend` when set, else its units' share of its container's spend) instead of always
  taking the line's budget by impression share; and value groups arrived - a line item may declare
  that several delivered values of one naming dimension read as one named value (`dimGroups` on
  its plan), rewritten into the rows wherever they are first read. `dashboard-metrics.js` is
  GENERATED (`AIAE-paicing/scripts/build-dashboard-metrics.mjs`) and was regenerated for the same
  change; it now also exports `groupIndexOf` / `groupedView`, which `../build-metrics.ts` calls in
  `toEngineRaw`. A copy left on the old version would price a period off the wrong budget and
  would answer a split on a group's name with zero delivery - both silently, both green.
  Named as a working tree rather than a commit because the sync was not committed when the copy
  was taken; `diff -q` against `AIAE-paicing/shared/` is the check that matters, not the SHA.

- Re-copied 2026-10-05, second time that day (`dashboard-metrics.js`): the buy-unit fix. A line
  item's rate type names the unit it is bought on, and campM counts each unit only over the lines
  paced on it — so on a CPC or CPV pacing the whole `impr*` family is 0 by design. The Standard
  Delivery card bound that family outright and drew blanks on a live CPC campaign. Seven new
  canonical metrics (`unitActual`, `unitExpected`, `unitPlan`, `unitToDatePct`, `unitDeviation`,
  `neededPerDayUnit`, `paceDeltaUnit`) resolve through `primaryUnit` at render instead; on a CPM
  pacing each is byte-identical to the `impr*` metric it replaces. The same regeneration carries
  `clExpected`, expected clicks to date over the click-paced lines, which the Daily Performance
  table now stacks under its Clicks total instead of the whole planned clicks.
  `vendor/std-entries.js` (the definitions) and `vendor/widget-metrics.js` (the vocabulary that
  decides whether a settings save is accepted at all) moved with it — all three or none.

- Re-copied 2026-10-05, third time that day (`pacing-core.js`, `alerts-core.js`,
  `dashboard-metrics.js`): CPI, the fourth unit a pacing can be bought on (app-install buying).
  It is NOT in `AIAE-paicing`'s own reference checkout — `ogan-team` has no CPI at all, so these
  three files now DIVERGE from it on purpose, and the next sync from that branch must not
  overwrite the divergence. A CPI line reads the CONVERSIONS column: the delivery mart carries no
  installs of its own. Until this, such a line was read as an impressions line — its install goal
  became an impression goal. Everything else about these files is unchanged.

- Re-copied 2026-10-06 (`dashboard-metrics.js` only): the reference catch-up. `AIAE-paicing` took
  six pieces of maths it was missing from `ogan-team` (everything that branch gained between
  2026-09-29 and its head `c8a725d`, bar the CM360 join), and the generated engine was rebuilt on
  each. The five that move a number here:

  - **A campaign's days left run to the LAST line's end** (`972f994`). They were the average of the
    lines' own days, which read «Flight ended» on a pacing whose last two of fourteen lines still
    had three days to go, and hid «Needed per day» behind the same 0. `campaignSpan` is new in
    `pacing-calc.js`; campM gains `flightSpanDay` / `flightSpanDays` and `daysLeft` now comes from
    it. On a pacing whose lines share one flight every figure is what it was.
  - **«Needed per day» is summed line by line** (same commit): each running line's own remaining
    over its own days left. An ended line's unrecoverable shortfall no longer inflates it and a
    line ahead of plan no longer offsets another's. campM gains `neededImprBasis` /
    `neededClicksBasis` / `neededViewsBasis`, which the note under the figure is written from.
  - **«Impressions to Hit Budget»** (`915d01d`, `706f42e`): eleven new canonical metrics —
    `hitBudgetAdd*`, `hitBudgetPerDay*`, `hitBudgetPlan`, `hitBudgetProjected`, `hitBudgetGap` —
    answering how many more units each rate type must deliver to land on its client budget, at its
    own average Dyn rate. `vendor/std-entries.js` carries the card that binds them and
    `vendor/widget-metrics.js` the vocabulary that lets a save through: all three or none.
  - **Formula chips** (`39884a0`..`445b94e`, 26 commits): a formula is now a holder, `{expr, chips}`,
    not a string. The grammar half lands in `vendor/report-v2.js` and `vendor/formula-chips.js`
    (new); the evaluator lives in `spa/chips/` and is not vendored. `and()` and `or()` join the
    formula functions.
  - **The progress bar's marker format** (`3679c20`): `tickFormat` in the grammar, and the format a
    field prints in when none is named.

  Proof the catch-up moved nothing it should not have: `AIAE-paicing`'s campM golden was re-recorded
  against this engine and compared field by field with the reference's own — across six cases and
  both ranges, NOT ONE field both sides answer moved. The sixteen that appeared are all CPI, below.

  OUR DIVERGENCES, carried into this copy on purpose and not to be overwritten by the next sync from
  `ogan-team`: CPI gets its own bucket in «Needed per day» and in «Impressions to Hit Budget» (the
  reference knows three units, so an install-paced line would pay its install goal and its delivered
  IMPRESSIONS into the impressions bucket), and the chip engine's line filter names CPI instead of
  testing for «not CPC and not CPV». Guarded by `AIAE-paicing/tests/rate-type-units-test.mjs`.

  NOT taken: the CM360 join by line item (`0b9dbed`, ~20 functions in `report-render.js`) — that lane
  posts to an n8n that is not deployed; the sections cutover, still unadopted on both sides; and the
  grammar epoch bump 7→8→9, because this service's server sits at 2 and epochs 3–7 include the
  cutover it does not have. Saying 9 would advertise a capability it lacks.

This directory also holds six small sibling `.d.ts` files (`dashboard-metrics.d.ts`,
`pacing-core.d.ts`, `metric-registry.d.ts`, `currency.d.ts`, `dashboard-metrics-glue.d.ts`,
`alerts-core.d.ts`) - these are NOT vendored, we wrote and own them (see `../vendor-types.d.ts`'s
header for why they live here rather than as an ambient module block: TypeScript only resolves a
relative `.js` import's types via a same-named sibling declaration file, not via an ambient
`declare module` for a relative specifier). The drift check below will always show these six
`.d.ts` files as "Only in vendor" - that's expected, they are not part of what gets re-copied.

## Do not edit

Editing these files is forbidden — no reformatting, no TypeScript conversion, no lint/prettier
fixes, no "small improvement". The moment one is edited, updating it stops being a copy-over and
becomes a merge. There is no ESLint/Prettier configured in this project (checked: no `.eslintrc*`,
no `eslint.config.*`, no `.prettierrc*`, no lint script in `package.json`), so there is nothing to
configure to skip this directory — if lint/prettier tooling is added later, exclude this directory
from it rather than reformatting these files.

## Updating

Update only by re-copying the six files from `AIAE-paicing/shared/` at a newer commit, and bump the
commit SHA(s) above. No checksum manifest, no lock test — deliberate (see the migration brief): those
guard the unlikely risk (someone edits the copy) and miss the likely one (upstream moves and nobody
re-copies). The manual drift check is a one-liner run by hand when in doubt:

```
diff -q /Users/azatnabiev/Desktop/work/paicing-azat/AIAE-operational-hub/frontend/src/features/pacing-dashboard/engine/vendor \
        /Users/azatnabiev/Desktop/work/paicing-azat/AIAE-paicing/shared
```

(That diff will always show extra files on the `AIAE-paicing/shared` side — only these six are
vendored here; that's expected. What matters is that the six shared file names report no diff.)

The obligation runs the other way too, and is written down on that side: `AIAE-paicing`'s
`CLAUDE.md` has a section "The engine has a second copy, in another repository" saying this copy
exists and has to move with theirs.

## Why there is no package (2026-09-26)

Do not re-propose publishing the engine as a shared dependency as if it were a fresh idea — it was
built, it works, and it is blocked on something no amount of code will fix.

`shared/` was packaged as a private npm package (`@aidigital-com/pacing-engine`): manifest, publish
workflow, a CI guard that fails a PR changing a packaged file without a version bump, and a full
rehearsal in this repository — typecheck clean, 330 tests green including the crown test, production
build correct, and all six modules loading in a real browser through the package's `exports` map.
The publish is refused by the registry: `403 … Account has reached its billing limit`. The Pacing
repository is private, the organisation's GitHub Packages quota is exhausted, and raising it is an
organisation-owner action.

A git dependency was verified as a workaround (a root manifest that packs only `shared/` installs
cleanly and pins to a commit SHA, no registry involved) and was rejected by the owner: it drags
token handling and git credentials into this repository's install path, for a file set that changes
rarely and that the owner prefers to control by hand.

So the copy in this directory is deliberate, not neglect. If the quota is ever raised, the package
work is all ten files of commit `e6306af` in `AIAE-paicing` (`git show e6306af`) — restore it rather
than rebuild it.

## Why these six and not the whole engine

`dashboard-metrics.js` (5547 lines) is itself already the merge of the retired SPA's
`normalize.js` + `pacing-calc.js` + `metrics.js` + `breakdown-filter.js` + `brick-data.js` +
`widget-status.js` + the formula parser, with their ESM plumbing removed. `pacing-core.js` is the
split/proration/expected-delivery math it depends on. `metric-registry.js` and `currency.js` are
its remaining two dependencies. `dashboard-metrics-glue.js` is `buildMetricBag`, the one function
`merge.mjs` calls to fill `PacingDashboardV1.metrics` - see its own docblock and the note above for
why it's vendored (crown-test-only) rather than used by `build-metrics.ts`. `alerts-core.js` is the
self-contained detector suite `../build-alerts.ts` drives directly - it depends on none of the other
five (its own header: "no DOM, no global state, no I/O", no `require` of any sibling file). All six
are UMD (`if (typeof module !== 'undefined' && module.exports) { module.exports = X } else {
root.X = X }`) — written for both Node and the browser; see each file's own header. No `require`, no
`process`, no Node API (`.fs`/`.fe` hits in a grep are flight-start/flight-end fields, not the Node
`fs` module).

## How they're loaded

Because the UMD guard sees no `module` global in a Vite/browser ES-module context, each file
attaches itself to `globalThis` (`globalThis.DashboardMetrics`, `.PacingCore`, `.MetricRegistry`,
`.Currency`, `.DashboardMetricsGlue`, `.AlertsCore`) rather than exporting anything via
`import`/`export`. `../engine-loader.ts` in the parent directory imports each file once for its side
effect and reads the six globals back out, typed by `./vendor-types.d.ts`. Everything else in this
feature imports the loader, never these files directly.
