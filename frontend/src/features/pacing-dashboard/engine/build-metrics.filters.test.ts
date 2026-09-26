/**
 * FIX 1 regression test: a `platforms`/`brkf` (fact-row-level) filter must NOT change the
 * campaign-level readings, and MUST change the delivery-row-level ones.
 *
 * Verified against the retired SPA (the named reference for this split - see `build-metrics.ts`'s
 * comment at the top of `buildPacingMetrics`, citing `workspace/src/lib/dashboard/selectors.js`'s
 * `makeCampMetricsSelector` and `workspace/.../useWidgetData.js`'s "Plan evaluation uses Scope
 * facts. Analytical readings apply the entire Lens, including platform, on the original rows"):
 *
 *   - `campaign`, `scalars`, `sources`, `readings`, `bound`, `containers` - computed from
 *     UNFILTERED delivery (LD0). A platform/brkf filter must leave these byte-identical.
 *   - `series`, `daily` - computed from the platform/brkf-FILTERED delivery. A filter that drops
 *     an entire line item's rows must change these.
 *
 * The fixture (`__fixtures__/raw-payload.ts`) has line item 100 on platform `dv_360_dlv` and line
 * item 200 on platform `TTD`, so filtering to one platform removes the other line item's delivery
 * entirely from the filtered facts - a clean, unambiguous signal.
 */
import { describe, expect, it } from "vitest";
import { buildPacingMetrics } from "./build-metrics";
import { toHubShape } from "./__fixtures__/to-hub-shape";
import { DEFAULT_FILTERS } from "../filters/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

describe("buildPacingMetrics - platform/breakdown filter scoping (FIX 1)", () => {
  const baseline = buildPacingMetrics(toHubShape(), DEFAULT_FILTERS);
  const filtered = buildPacingMetrics(toHubShape(), { ...DEFAULT_FILTERS, platforms: ["dv_360_dlv"] });

  it("computes both bags", () => {
    expect(baseline).not.toBeNull();
    expect(filtered).not.toBeNull();
  });

  it("leaves campaign-level readings unchanged by a platform filter", () => {
    expect(filtered!.asOf).toEqual(baseline!.asOf);
    expect(filtered!.campaign).toEqual(baseline!.campaign);
    expect(filtered!.scalars).toEqual(baseline!.scalars);
    expect(filtered!.sources).toEqual(baseline!.sources);
    expect(filtered!.readings).toEqual(baseline!.readings);
    expect(filtered!.bound).toEqual(baseline!.bound);
    expect(filtered!.containers).toEqual(baseline!.containers);
  });

  it("changes the delivery-row-level readings (series/daily) when the platform filter drops a line item's rows", () => {
    expect(filtered!.series).not.toEqual(baseline!.series);
    expect(filtered!.daily).not.toEqual(baseline!.daily);

    // Line item 200 (TTD) is filtered out entirely - its rows must not contribute impressions to
    // the filtered daily table, while the unfiltered baseline still carries them.
    const dailyImpr = (bag: NonNullable<typeof baseline>) =>
      (bag.daily as Any[]).reduce((sum, row: Any) => sum + (row.liId === "200" ? row.im || 0 : 0), 0);
    expect(dailyImpr(filtered!)).toBe(0);
    expect(dailyImpr(baseline!)).toBeGreaterThan(0);
  });

  it("also holds for a brkf (breakdown) filter - unaffected campaign readings, changed series/daily", () => {
    const brkfFiltered = buildPacingMetrics(toHubShape(), {
      ...DEFAULT_FILTERS,
      brkf: ["tactic:prospecting"],
    });
    expect(brkfFiltered).not.toBeNull();
    expect(brkfFiltered!.campaign).toEqual(baseline!.campaign);
    expect(brkfFiltered!.scalars).toEqual(baseline!.scalars);
    expect(brkfFiltered!.sources).toEqual(baseline!.sources);
    expect(brkfFiltered!.readings).toEqual(baseline!.readings);
    expect(brkfFiltered!.bound).toEqual(baseline!.bound);
    expect(brkfFiltered!.series).not.toEqual(baseline!.series);
    expect(brkfFiltered!.daily).not.toEqual(baseline!.daily);
  });

  // Companion to the platform/brkf (Lens) cases above: a channel filter is Scope
  // (`filters/eff-lis.ts:computeEffLIs`) - it narrows `effLIs`, which `campM` is parametrized by,
  // so it MUST move `campaign` - the KPI strip's Pace/Margin (`pacing-dashboard-health.ts`) reads
  // exactly this field, and must move with it.
  it("a channel filter (Scope) DOES change campaign-level readings, unlike a platform/brkf filter (Lens)", () => {
    const channelFiltered = buildPacingMetrics(toHubShape(), { ...DEFAULT_FILTERS, channels: ["Display"] });
    expect(channelFiltered).not.toBeNull();
    expect(channelFiltered!.campaign).not.toEqual(baseline!.campaign);
    // campM's pac/mA/mT (see pacing-dashboard-health.ts) - LI 100 (Display) only, so this is no
    // longer the two-line-item blend the unfiltered baseline is.
    expect((channelFiltered!.campaign as Any).pac).not.toEqual((baseline!.campaign as Any).pac);
  });
});
