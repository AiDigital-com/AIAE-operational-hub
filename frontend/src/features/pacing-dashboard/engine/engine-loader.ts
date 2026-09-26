/**
 * Loads Pacing's vendored calculation engine (`./vendor/`, see `vendor/SOURCE.md`) and hands back
 * one ready `DashboardMetricsEngine` instance.
 *
 * The six vendor files are UMD scripts with no `import`/`export` statements (see
 * `vendor-types.d.ts`'s header): `if (typeof module !== 'undefined' && module.exports) {
 * module.exports = X } else { root.X = X }`. Which branch runs depends on who is asking, and the
 * two environments this code runs in disagree - measured, not assumed:
 *
 *   - **Vitest** (`vite-node`) provides a `module`/`exports` pair for CJS interop, so the file
 *     populates `module.exports`, which surfaces as the module's `default`. `globalThis.Currency`
 *     stays `undefined`.
 *   - **A real browser** (Vite dev server, native ESM) has no `module` global, so the file attaches
 *     to `globalThis` - and the ES module it is served as has **no exports at all**.
 *
 * Hence the dynamic `await import(...)` below rather than `import X from "./vendor/x.js"`. A STATIC
 * default import is resolved at link time, before any code runs, so in the browser it fails outright
 * with "does not provide an export named 'default'" and takes the whole route down with it - the
 * tests never saw this because vite-node's interop hands them a `default` that the browser has not
 * got. A dynamic import has no such link-time demand: a missing `default` is simply `undefined`, and
 * `required()` below falls through to the `globalThis` the same import just populated.
 *
 * Top-level await, so the public functions stay synchronous: this module resolves its six
 * dependencies once, at import time, and everything after it is ordinary synchronous code.
 */
import type {
  AlertsCoreModule,
  CurrencyModule,
  DashboardMetricsEngine,
  DashboardMetricsGlueEngine,
  DashboardMetricsGlueModule,
  DashboardMetricsModule,
  MetricRegistryModule,
  PacingCoreModule,
} from "./vendor-types";

/** The `default` a vendor module exposes under CJS interop, and `undefined` in a browser. */
async function umdDefault<T>(load: Promise<{ default?: unknown }>): Promise<T | undefined> {
  return (await load).default as T | undefined;
}

const DashboardMetricsImport = await umdDefault<DashboardMetricsModule>(import("./vendor/dashboard-metrics.js"));
const PacingCoreImport = await umdDefault<PacingCoreModule>(import("./vendor/pacing-core.js"));
const MetricRegistryImport = await umdDefault<MetricRegistryModule>(import("./vendor/metric-registry.js"));
const CurrencyImport = await umdDefault<CurrencyModule>(import("./vendor/currency.js"));
const DashboardMetricsGlueImport = await umdDefault<DashboardMetricsGlueModule>(import("./vendor/dashboard-metrics-glue.js"));
const AlertsCoreImport = await umdDefault<AlertsCoreModule>(import("./vendor/alerts-core.js"));

function required<T>(fromGlobal: T | undefined, fromImport: T | undefined, name: string): T {
  const value = fromGlobal ?? fromImport;
  if (value === undefined) {
    throw new Error(
      `[pacing-dashboard/engine] ${name} did not load from vendor/${name}.js - failed to load or was edited (forbidden, see vendor/SOURCE.md).`
    );
  }
  return value;
}

function resolveDashboardMetrics(): DashboardMetricsModule {
  return required(globalThis.DashboardMetrics, DashboardMetricsImport as DashboardMetricsModule | undefined, "DashboardMetrics");
}
function resolvePacingCore(): PacingCoreModule {
  return required(globalThis.PacingCore, PacingCoreImport as PacingCoreModule | undefined, "PacingCore");
}
function resolveMetricRegistry(): MetricRegistryModule {
  return required(globalThis.MetricRegistry, MetricRegistryImport as MetricRegistryModule | undefined, "MetricRegistry");
}
function resolveCurrency(): CurrencyModule {
  return required(globalThis.Currency, CurrencyImport as CurrencyModule | undefined, "Currency");
}
function resolveDashboardMetricsGlue(): DashboardMetricsGlueModule {
  return required(
    globalThis.DashboardMetricsGlue,
    DashboardMetricsGlueImport as DashboardMetricsGlueModule | undefined,
    "DashboardMetricsGlue"
  );
}
function resolveAlertsCore(): AlertsCoreModule {
  return required(globalThis.AlertsCore, AlertsCoreImport as AlertsCoreModule | undefined, "AlertsCore");
}

let engine: DashboardMetricsEngine | null = null;

/** The one `DashboardMetrics.create(...)` instance this feature needs, built once and reused —
 *  matches `merge.mjs`'s `buildMetricBag`, which also creates exactly one instance per call. */
export function createPacingEngine(): DashboardMetricsEngine {
  if (engine) return engine;
  const DashboardMetrics = resolveDashboardMetrics();
  const PacingCore = resolvePacingCore();
  const MetricRegistry = resolveMetricRegistry();
  const Currency = resolveCurrency();
  engine = DashboardMetrics.create({ core: PacingCore, currency: Currency, metricRegistry: MetricRegistry });
  return engine;
}

/** `PacingCore` itself, for the breakdown-filter port (`buildDimScopeIndex`/`factOutsideSplits`)
 *  and date parsing (`_parseUTC`), neither of which is exposed through the engine instance above. */
export function getPacingCore(): PacingCoreModule {
  return resolvePacingCore();
}

/** `Currency`, for the same reason as `getPacingCore` (`isConverted`/`currencyToUsd`). Not used by
 *  the wrapper today (campaign `rate` is not on the Hub's contract yet - see build-metrics.ts) but
 *  exposed so a caller that DOES have a rate (e.g. a future widget) can convert consistently. */
export function getCurrency(): CurrencyModule {
  return resolveCurrency();
}

/** `AlertsCore`, the sixth vendored module (`vendor/alerts-core.js` - see its own docblock and
 *  `vendor/SOURCE.md`), for `build-alerts.ts`'s browser-side, filter-aware alert compute (§
 *  "Alerts should be computed here, not taken from the server", 2026-09-25 filters follow-up). */
export function getAlertsCore(): AlertsCoreModule {
  return resolveAlertsCore();
}

let metricsGlue: DashboardMetricsGlueEngine | null = null;

/**
 * `buildMetricBag`, Pacing's own server-side "dashboard response -> metrics bag" glue function
 * (`dash-gate/lib/merge.mjs`), vendored byte-identical (5th file, `vendor/dashboard-metrics-glue.js`
 * - see its own docblock and `vendor/SOURCE.md`). Not used by `build-metrics.ts` - the Hub's own
 * `buildPacingMetrics` needs to parametrize `effLIs`/`range` by the current filters, which this
 * function does not take. Its ONLY caller is `build-metrics.crown.test.ts`, which needs Pacing's
 * REAL implementation to compare against - not a second, hand-written TypeScript port of it that
 * could drift from what it's meant to verify.
 */
export function buildServerMetricBag(response: Parameters<DashboardMetricsGlueEngine["buildMetricBag"]>[0]): ReturnType<DashboardMetricsGlueEngine["buildMetricBag"]> {
  if (!metricsGlue) {
    const DashboardMetrics = resolveDashboardMetrics();
    const PacingCore = resolvePacingCore();
    const MetricRegistry = resolveMetricRegistry();
    const Currency = resolveCurrency();
    const DashboardMetricsGlue = resolveDashboardMetricsGlue();
    metricsGlue = DashboardMetricsGlue.create({
      core: PacingCore,
      currency: Currency,
      metricRegistry: MetricRegistry,
      dashboardMetrics: DashboardMetrics,
    });
  }
  return metricsGlue.buildMetricBag(response);
}
