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
- Commit copied from (`dashboard-metrics.js`, `pacing-core.js`, `metric-registry.js`, `currency.js`,
  `dashboard-metrics-glue.js`): `e161b91edbb6f2bc3666c69f9240e6778e0a0a94` (copied 2026-09-25, from
  the `paicing-azat` checkout)
- Commit copied from (`alerts-core.js`): `1c57d45` (copied 2026-09-25, from the `paicing-ogan`
  checkout - the read-only reference repo for that day's task; the file is byte-identical between
  both checkouts at copy time, `diff -q` confirmed, so the two sources agree on content even though
  their commit SHAs differ)

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
