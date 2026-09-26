/**
 * THE ACCEPTANCE TEST for bringing dashboard filters back into the browser (Operational Hub
 * migration §6/filters): with every filter at its default, the locally computed metrics bag must
 * equal what Pacing sends on `data.metrics` today, byte-for-byte - with ONE deliberate, named
 * exception. `campaign` is published RANGED here (owner decision, 2026-09-25/26; see the comment at
 * `build-metrics.ts`'s `const campaign = cm`), where the server publishes the full-flight `flCM`;
 * so this test pins `campaign` to its own stated rule - the engine's `campM` over the default
 * window `{from: startDate, to: asOf}`, computed independently below (`rangedCampaign`) - and every
 * OTHER field to the server function byte-for-byte, via `{...expected, campaign: <the ranged
 * expectation>}` so the whole-bag key comparison still holds and any other drift still fails loudly.
 * If this test fails, the wrapper is wrong - the fix is in `build-metrics.ts`, never in this test's
 * expectations.
 *
 * "What Pacing sends" is computed by calling Pacing's REAL `buildMetricBag` - vendored
 * byte-identical from `AIAE-paicing/shared/dashboard-metrics-glue.js` into `./vendor/
 * dashboard-metrics-glue.js` (see that directory's `SOURCE.md`), reached through
 * `engine-loader.ts`'s `buildServerMetricBag`. This used to be a second, hand-written TypeScript
 * port of `buildMetricBag` (`__fixtures__/server-reference.ts`, now deleted) - written by the same
 * agent as the code under test, so a shared misreading of `merge.mjs` could pass both sides. It
 * DID catch one real bug once (the Hub reshapes `notify` to camelCase; the first draft of
 * `build-metrics.ts` read Pacing's raw snake_case path, which would have silently defaulted a
 * container's margin-warn band) - but the fix for "a hand port can drift from the function it
 * exists to verify" is to stop hand-porting it, not to hand-port it more carefully. The vendored
 * function IS `merge.mjs`'s own `buildMetricBag` (merge.mjs now calls the very same
 * `shared/dashboard-metrics-glue.js` this file is a byte-identical copy of), so this comparison is
 * against the real thing, not a second implementation of it.
 *
 * `RAW_PAYLOAD` (`__fixtures__/raw-payload.ts`) is Pacing's own wire format - what `buildMetricBag`
 * actually takes; `__fixtures__/to-hub-shape.ts` reshapes the SAME data into what the Hub's
 * `PacingDashboardV1` contract carries - so this test exercises the real field-name bridge
 * (`build-metrics.ts`'s `toEngineRaw`), not a shortcut around it.
 */
import { describe, expect, it } from "vitest";
import { buildPacingMetrics } from "./build-metrics";
import { buildServerMetricBag, createPacingEngine } from "./engine-loader";
import type { EngineRawPayload } from "./vendor-types";
import { RAW_PAYLOAD } from "./__fixtures__/raw-payload";
import { toHubShape } from "./__fixtures__/to-hub-shape";
import { RAW_PAYLOAD_CURRENCY } from "./__fixtures__/raw-payload-currency";
import { toHubShapeCurrency } from "./__fixtures__/to-hub-shape-currency";
import { RAW_PAYLOAD_COEF } from "./__fixtures__/raw-payload-coef";
import { toHubShapeCoef } from "./__fixtures__/to-hub-shape-coef";
import { DEFAULT_FILTERS } from "../filters/types";

/**
 * The independent expectation for the ONE field this wrapper deliberately publishes differently
 * from the server (see this file's docblock): `campaign` is the engine's `campM` over the default
 * no-filter window `{from: startDate, to: asOf}` ("so far", the retired SPA's own headline window)
 * - NOT `buildPacingMetrics`'s own output, so the pin can't be satisfied by a shared bug.
 */
function rangedCampaign(raw: EngineRawPayload): Record<string, unknown> {
  const engine = createPacingEngine();
  const { LP, LD, asOf } = engine.normalize(raw);
  const range = { from: raw.campaign.startDate, to: asOf ?? raw.campaign.endDate };
  return engine.campM(LD, LP, asOf, Object.keys(LP), range);
}

describe("buildPacingMetrics - crown test (no filters == server's data.metrics)", () => {
  it("matches the server-computed bag byte-for-byte with every filter at default (campaign: ranged)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const expected = buildServerMetricBag(RAW_PAYLOAD as any);
    const actual = buildPacingMetrics(toHubShape(), DEFAULT_FILTERS);
    const campaign = rangedCampaign(RAW_PAYLOAD as unknown as EngineRawPayload);

    expect(actual).not.toBeNull();
    // The one deliberate divergence, pinned to its own rule (independent compute, above).
    expect(actual?.campaign).toEqual(campaign);
    // The pin is real, not vacuous: the fixture's asOf ("2026-08-05") precedes its endDate, so the
    // ranged window and the whole flight genuinely disagree. If this ever fails, the fixture no
    // longer distinguishes ranged from full-flight and the assertion above proves nothing.
    expect(actual?.campaign).not.toEqual(expected.campaign);
    // Every OTHER field: the server bag byte-for-byte, same keys, nothing else may drift.
    expect(actual).toEqual({ ...expected, campaign });
  });

  it("computes a non-trivial bag (the fixture actually exercises real delivery/plan math)", () => {
    const actual = buildPacingMetrics(toHubShape(), DEFAULT_FILTERS);
    expect(actual?.asOf).toBe("2026-08-05");
    expect(actual?.daily.length).toBeGreaterThan(0);
    expect(actual?.series.length).toBeGreaterThan(0);
    expect(actual?.containers?.["200"]?.[0]?.name).toBe("Week 1");
    // margin_below_target.gap_pp: 4 (raw) round-tripped through marginBelowTarget.gapPp (Hub shape)
    // and back out through the container's margin warn band - proof the camelCase bridge in
    // build-metrics.ts's buildContainerReadings reads the field it's actually given.
    expect(actual?.containers?.["200"]?.[0]?.margin).toEqual(expect.anything());
  });

  it("returns null, not a throw, for a malformed payload (matches merge.mjs's own fallback)", () => {
    // normalize() asserts campaign.startDate/endDate and throws "Bad data: dates" when either is
    // missing - buildPacingMetrics must swallow that the same way merge.mjs's own try/catch does
    // ("failure is NOT fatal... a null bag means 'no figures'").
    const broken = { ...toHubShape(), campaign: { ...toHubShape().campaign, startDate: undefined } };
    expect(buildPacingMetrics(broken, DEFAULT_FILTERS)).toBeNull();
  });

  it("returns an empty-but-valid bag for a payload with an empty plan (no throw either way)", () => {
    const empty = { ...toHubShape(), planByLineItem: {} };
    const actual = buildPacingMetrics(empty, DEFAULT_FILTERS);
    expect(actual).not.toBeNull();
    expect(actual?.daily).toEqual([]);
  });

  it("returns null for a null/undefined payload", () => {
    expect(buildPacingMetrics(null, DEFAULT_FILTERS)).toBeNull();
    expect(buildPacingMetrics(undefined, DEFAULT_FILTERS)).toBeNull();
  });
});

describe("buildPacingMetrics - crown test, non-USD campaign (PacingDashboardCampaignV1.rate)", () => {
  it("matches the server-computed bag byte-for-byte for a EUR campaign with a real rate (campaign: ranged)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const expected = buildServerMetricBag(RAW_PAYLOAD_CURRENCY as any);
    const actual = buildPacingMetrics(toHubShapeCurrency(), DEFAULT_FILTERS);
    const campaign = rangedCampaign(RAW_PAYLOAD_CURRENCY as unknown as EngineRawPayload);

    expect(actual).not.toBeNull();
    expect(actual?.campaign).toEqual(campaign);
    expect(actual).toEqual({ ...expected, campaign });
  });

  it("rate is not a no-op: a bridge that drops it would diverge from this fixture's bag", () => {
    // Proves the fixture actually exercises Currency.currencyToUsd, without guessing at the bag's
    // internal shape: replay buildPacingMetrics on the SAME payload minus `rate` (i.e. the old,
    // pre-fix toEngineRaw's hardcoded `rate: undefined`) and assert it produces a DIFFERENT bag.
    // If this assertion failed, the equality test above would be proving nothing about `rate`.
    const withoutRate = { ...toHubShapeCurrency(), campaign: { ...toHubShapeCurrency().campaign, rate: undefined } };
    const broken = buildPacingMetrics(withoutRate, DEFAULT_FILTERS);
    const correct = buildPacingMetrics(toHubShapeCurrency(), DEFAULT_FILTERS);
    expect(broken).not.toEqual(correct);
  });
});

describe("buildPacingMetrics - crown test, coefficient-cost line item (PacingLineItemPlanV1.costCoef)", () => {
  it("matches the server-computed bag byte-for-byte with a cost_coef line item (campaign: ranged)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const expected = buildServerMetricBag(RAW_PAYLOAD_COEF as any);
    const actual = buildPacingMetrics(toHubShapeCoef(), DEFAULT_FILTERS);
    const campaign = rangedCampaign(RAW_PAYLOAD_COEF as unknown as EngineRawPayload);

    expect(actual).not.toBeNull();
    expect(actual?.campaign).toEqual(campaign);
    expect(actual).toEqual({ ...expected, campaign });
  });

  it("costCoef is not a no-op: a bridge that drops it would diverge from this fixture's bag", () => {
    // Same proof as the currency fixture's rate check above, aimed at costCoef instead: replay on
    // the SAME payload minus LI 200's costCoef (the old, pre-fix toEngineRaw never set cost_coef at
    // all, so it always normalized to `coef: false`) and assert a different bag comes out. LI 200's
    // dynamic_cost is garbage (999/day) precisely so this divergence is real, not a rounding blip.
    const withoutCoef = toHubShapeCoef();
    withoutCoef.planByLineItem = {
      ...withoutCoef.planByLineItem,
      "200": { ...withoutCoef.planByLineItem["200"], costCoef: undefined },
    };
    const broken = buildPacingMetrics(withoutCoef, DEFAULT_FILTERS);
    const correct = buildPacingMetrics(toHubShapeCoef(), DEFAULT_FILTERS);
    expect(broken).not.toEqual(correct);
  });
});
