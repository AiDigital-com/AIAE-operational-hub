/**
 * Translates `RAW_PAYLOAD_COEF` (Pacing's own wire format) into what the Hub's `PacingDashboardV1`
 * actually looks like after `PacingDashboardContractMapper` reshapes it - same bridge as
 * `to-hub-shape.ts`, plus the field that bridge was written to prove: a plan's `costCoef` (and,
 * alongside it, `converted`/`currency`). See `to-hub-shape.ts`'s header for why this translation
 * exists (exercising `build-metrics.ts`'s `toEngineRaw` honestly).
 */
import { aPacingAlertsConfigV1 } from "@/test/factories";
import type { PacingDashboardV1 } from "../../types";
import { RAW_PAYLOAD_COEF } from "./raw-payload-coef";

export function toHubShapeCoef(): PacingDashboardV1 {
  const raw = RAW_PAYLOAD_COEF;
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
          costCoef: p.cost_coef,
          converted: p.converted,
          currency: p.currency ?? undefined,
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
