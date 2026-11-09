/**
 * A pacing's alert thresholds have to survive the seam into the moved renderer.
 *
 * The moved components read them the way Pacing stores them - `alerts.spend_overspend.bad_pct`,
 * `alerts.pacing_off_pace.low`, `alerts.ctr_below_target.factor` - and the Hub's contract hands
 * them over camelCase. A missed key does not throw: every reader has a built-in default, so the
 * card simply painted against 90/100 whatever the pacing said. Found on Andy's Summer + North
 * Carolina (2026-11-09): "Critical > 105%", two line items at 100.4% of prorated cost budget,
 * amber in Pacing and red in the Hub.
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { aPacingAlertsConfigV1, aPacingNotifySettingsV1 } from "@/test/factories";
// @ts-expect-error - moved JS from Pacing's SPA, deliberately untyped (see SOURCE.md)
import { usePacingState } from "./store.js";
// @ts-expect-error - moved JS from Pacing's SPA, deliberately untyped (see SOURCE.md)
import { spendStatusCls } from "./line-item-columns.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

function stateOf(data: unknown) {
  const { result } = renderHook(() =>
    (usePacingState as Any)({ data, urlFilters: { filters: {}, setFilters: () => {} }, actions: {}, journalHighlight: null })
  );
  return result.current as Any;
}

const payload = () => ({
  campaign: { startDate: "2026-04-27", endDate: "2026-08-31", rate: 1 },
  planByLineItem: {},
  factsDaily: [],
  notify: aPacingNotifySettingsV1({
    alerts: aPacingAlertsConfigV1({
      spendOverspend: { enabled: true, slack: true, warnPct: 90, badPct: 105 },
      pacingOffPace: { enabled: true, slack: true, low: -12, high: 8 },
      ctrBelowTarget: { enabled: true, slack: true, factor: 0.6 },
    }),
  }),
});

describe("alert thresholds reach the moved renderer", () => {
  it("hands the moved components the thresholds in Pacing's own keys", () => {
    // When:
    const alerts = stateOf(payload()).notify.alerts;

    // Then:
    expect(alerts.spend_overspend).toMatchObject({ warn_pct: 90, bad_pct: 105 });
    expect(alerts.pacing_off_pace).toMatchObject({ low: -12, high: 8 });
    expect(alerts.ctr_below_target).toMatchObject({ factor: 0.6 });
  });

  it("paints a spend just past 100% amber when the pacing's critical line is 105%, as Pacing does", () => {
    // Given: the card's own threshold read, from what the store hands it.
    const a = stateOf(payload()).notify.alerts;
    const thresholds = { spendWarn: a.spend_overspend.warn_pct, spendBad: a.spend_overspend.bad_pct };

    // Then: $4,545.60 of $4,527.43 prorated - 100.4%.
    expect(spendStatusCls(4545.6, 4527.43, thresholds)).toContain("--status-amber");
    expect(spendStatusCls(4800, 4527.43, thresholds)).toContain("--status-red");
  });

  it("hands over no thresholds when the pacing has none, leaving the readers on their defaults", () => {
    expect(stateOf({ ...payload(), notify: null }).notify).toBeNull();
  });
});
