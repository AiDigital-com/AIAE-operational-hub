/**
 * The Delivery card reads the unit the pacing is BOUGHT on.
 *
 * Pacing's rate types each name their own delivered unit — CPM impressions, CPC clicks, CPV
 * completed views — and `campM` publishes three parallel families accordingly, each counting
 * ONLY the lines paced on it. The Standard Delivery card used to bind the impressions family
 * outright, so on a CPC or CPV pacing it drew blanks: that family is 0 there by design, and
 * the figures were sitting under `clicks*` / `views*`. (Reported on a live CPC campaign,
 * 2026-10-05.)
 *
 * The fix is upstream, in `AIAE-paicing` — new `unit*` canonical metrics that resolve through
 * `primaryUnit` at render — and arrives here through three copies: `engine/vendor/
 * dashboard-metrics.js`, `vendor/std-entries.js`, `vendor/widget-metrics.js`, plus the moved
 * `brick-data.js` beside this file. Nothing compares those copies to their originals, so this
 * suite checks the behaviour on THIS side rather than trusting that they were re-copied.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - moved JS from Pacing's SPA, deliberately untyped (see SOURCE.md)
import { brickValue } from "./brick-data.js";
// @ts-expect-error - moved JS
import { normalize } from "./normalize.js";
// @ts-expect-error - moved JS
import { campM } from "./metrics.js";
// @ts-expect-error - moved JS
import { stdEntry } from "./std-catalog.js";
import WidgetMetrics from "@shared/widget-metrics";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const DAYS = ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"];
// Ten-day flight read on day five, so every expected-to-date figure is exactly half its plan.
const FLIGHT = { start: "2026-08-01", end: "2026-08-10" };

/** One line item delivering the same facts whatever it is paced on, so a family reading zero
 *  is a GATE and never missing delivery. */
function context(rateType: string, planned: number) {
  const factsDaily = DAYS.map((date) => ({
    line_item_id: "L1", date, impressions: 100_000, clicks: 400,
    spend: 200, completes: 30_000, conversions: 50, dynamic_cost: 250,
  }));
  const raw = {
    campaign: { startDate: FLIGHT.start, endDate: FLIGHT.end, rate: 1 },
    factsDaily,
    planByLineItem: {
      L1: {
        lineItemId: "L1", channel: "Test", rateType, clientBudget: 5000,
        plannedImpressions: planned, marginTargetPct: 20, ctrTargetPct: null, vcrTargetPct: null,
        flightStart: FLIGHT.start, flightEnd: FLIGHT.end, containers: [],
      },
    },
    types: [],
  };
  const { LP, LD, asOf } = normalize(raw) as Any;
  const cm = campM(LD, LP, asOf, Object.keys(LP), null);
  // These cases never narrow the window, so the window's metrics ARE the flight's.
  return { cm, flCM: cm, facts: { asOf } };
}

const read = (metric: string, ctx: unknown) =>
  (brickValue({ type: "bigStat", bind: { metric } }, ctx) as Any).value;

const SLOTS: ReadonlyArray<readonly [string, string]> = [
  ["unitToDatePct", "imprToDatePct"],
  ["unitActual", "imprActual"],
  ["unitExpected", "imprExpected"],
  ["unitDeviation", "imprDeviation"],
  ["neededPerDayUnit", "neededPerDayImpr"],
  ["paceDeltaUnit", "paceDeltaImpr"],
];

describe("the Delivery card's unit follows the rate type", () => {
  it("is unchanged on a CPM pacing", () => {
    // The safety half: the pacing everyone already looks at must not move by one figure.
    const ctx = context("CPM", 2_000_000);
    for (const [unitKey, imprKey] of SLOTS) expect(read(unitKey, ctx)).toBe(read(imprKey, ctx));
    expect(read("unitActual", ctx)).toBe(500_000);
  });

  it("reads clicks on a CPC pacing, where the impressions family draws nothing", () => {
    const ctx = context("CPC", 8000);
    for (const [, imprKey] of SLOTS) expect(read(imprKey, ctx)).toBeNull();
    expect(read("unitActual", ctx)).toBe(2000);        // 400 clicks x 5 days
    expect(read("unitExpected", ctx)).toBe(4000);      // half of 8000 planned
    expect(read("unitPlan", ctx)).toBe(8000);
    expect(read("unitDeviation", ctx)).toBe(-2000);
    expect(read("unitToDatePct", ctx)).toBe(50);
    expect(read("neededPerDayUnit", ctx)).toBe(1200);  // 6000 left over five days
    expect(read("paceDeltaUnit", ctx)).toBe(-25);
  });

  it("reads completed views on a CPV pacing", () => {
    const ctx = context("CPV", 600_000);
    for (const [, imprKey] of SLOTS) expect(read(imprKey, ctx)).toBeNull();
    expect(read("unitActual", ctx)).toBe(150_000);     // 30 000 views x 5 days
    expect(read("unitExpected", ctx)).toBe(300_000);
    expect(read("unitPlan", ctx)).toBe(600_000);
  });

  it("reads installs on a CPI pacing, over the conversions column", () => {
    // CPI (app-install buying) is the fourth unit and is NOT in the reference at all — a CPI
    // line falls into the `else` there and is read as an impressions line. The delivery mart
    // carries no installs of its own, so it reads conversions: the same population `dynCpa`
    // divides spend by. 50 a day for five of ten days against a plan of 500.
    const ctx = context("CPI", 500);
    for (const [, imprKey] of SLOTS) expect(read(imprKey, ctx)).toBeNull();
    expect(read("unitActual", ctx)).toBe(250);
    expect(read("unitExpected", ctx)).toBe(250);
    expect(read("unitPlan", ctx)).toBe(500);
    expect(read("unitToDatePct", ctx)).toBe(100);
    expect(read("neededPerDayUnit", ctx)).toBe(50);
  });
});

describe("the vendored copies carry the change", () => {
  it("the Standard hero binds the unit metrics", () => {
    const bound = new Set<string>();
    const walk = (node: Any): void => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (!node || typeof node !== "object") return;
      for (const slot of ["bind", "target", "tick"]) {
        if (node[slot] && typeof node[slot].metric === "string") bound.add(node[slot].metric);
      }
      Object.values(node).forEach(walk);
    };
    walk(stdEntry("std:v2:hero-verdict").definition.spec.views);
    for (const key of ["unitToDatePct", "unitActual", "unitExpected", "unitPlan",
      "unitDeviation", "neededPerDayUnit", "paceDeltaUnit", "neededPerDayInstalls"]) {
      expect(bound.has(key), `hero binds ${key}`).toBe(true);
      // A bound canonical metric missing from the vocabulary is refused by report-v2 as
      // "unknown canonical metric" — which fails the whole settings save, from every screen.
      expect(WidgetMetrics.WIDGET_METRICS, key).toContain(key);
    }
  });

  it("the Standard Daily table's Clicks target is expected-to-date, not the whole plan", () => {
    const table = stdEntry("std:v2:daily").definition.spec.views
      .find((view: Any) => view.kind === "table");
    expect(table.columns.find((c: Any) => c.id === "cl").target.value.metric).toBe("clExpected");
    // Its impressions neighbour is the twin it has to agree with.
    expect(table.columns.find((c: Any) => c.id === "im").target.value.metric).toBe("imprExpected");
  });
});
