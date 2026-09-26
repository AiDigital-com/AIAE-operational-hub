/**
 * Translates `RAW_PAYLOAD` (Pacing's own wire format) into what the Hub's `PacingDashboardV1`
 * actually looks like after `PacingDashboardContractMapper` reshapes it - camelCase everywhere,
 * `campaign.id` -> `slug`, `margin_below_target.gap_pp` -> `marginBelowTarget.gapPp`, no `types`
 * array. This is the reverse of `build-metrics.ts`'s `toEngineRaw` bridge, and exists so the crown
 * test exercises that bridge honestly: a bug in the field-name translation (like the
 * `margin_below_target` vs `marginBelowTarget` one this wrapper was written to avoid) shows up as
 * a real mismatch instead of being fixed on both sides of the test.
 */
import { aPacingAlertsConfigV1 } from "@/test/factories";
import type { PacingDashboardV1 } from "../../types";
import { RAW_PAYLOAD } from "./raw-payload";

export function toHubShape(): PacingDashboardV1 {
  const raw = RAW_PAYLOAD;
  return {
    campaign: {
      slug: raw.campaign.id,
      pacingId: raw.campaign.pacingId,
      name: raw.campaign.name,
      startDate: raw.campaign.startDate,
      endDate: raw.campaign.endDate,
      currency: raw.campaign.currency,
      status: raw.campaign.status,
      orderNumber: raw.campaign.orderNumber,
    },
    planByLineItem: Object.fromEntries(
      Object.entries(raw.planByLineItem).map(([id, p]) => [
        id,
        {
          lineItemId: p.lineItemId,
          channel: p.channel,
          dsp: p.dsp,
          rateType: p.rateType,
          clientBudget: p.clientBudget,
          plannedImpressions: p.plannedImpressions,
          marginTargetPct: p.marginTargetPct,
          ctrTargetPct: p.ctrTargetPct ?? undefined,
          vcrTargetPct: p.vcrTargetPct ?? undefined,
          flightStart: p.flightStart,
          flightEnd: p.flightEnd,
          pauseIntervals: p.pauseIntervals,
          containers: p.containers,
          labels: p.labels,
          description: p.description ?? undefined,
          nativeBudget: p.native_budget ?? undefined,
        },
      ])
    ),
    factsDaily: raw.factsDaily as unknown as Record<string, unknown>[],
    asOf: undefined,
    display: raw.display,
    aggregate: raw.aggregate,
    notify: {
      alerts: aPacingAlertsConfigV1({
        marginBelowTarget: { enabled: true, slack: true, gapPp: raw.notify.alerts.margin_below_target.gap_pp },
      }),
      metrics: { vcr: false },
      hidePaused: false,
      summaryProjection: "reforecast",
    },
    journal: [],
  };
}
