import type { PaceState } from "./constants";
import { clamp, daysBetween, daysLeft, fmtMD, labelDay, parseMoney, todayISO } from "./format";
import { makeRng, seedFromId } from "./rng";
import { buildSetup } from "./setup";
import type { MockCam, Pacing, PdInput, PdMetrics } from "./types";

/**
 * Classifies a pacing deviation for display: `nodata` when there is no budget or no pacing figure to
 * compare, `over`/`under` past a ±2pp band, `on` otherwise.
 */
export function paceOf(c: { budget: number; pp: number | null }): PaceState {
  return c.budget === 0 || c.pp == null ? "nodata" : c.pp > 2 ? "over" : c.pp < -2 ? "under" : "on";
}

/**
 * Generates the per-campaign pacing overlay (margin, pacing deviation, per-line-item pacing), seeded by
 * the campaign's own id so the same campaign always shows the same numbers everywhere it appears
 * (Overview, Campaigns table, Pacing tab — see 02-MOCK-PACING-SPEC.md, "In-sync requirement"). Ported
 * verbatim from the mockup's `campPacing`.
 *
 * @param cam the adapted campaign (see `toPacingCampaign`)
 * @return the campaign's pacing overlay, including per-line-item pacing
 */
export function campPacing(cam: MockCam): Pacing {
  const rnd = makeRng(seedFromId(cam.id));
  const lis = buildSetup(cam).ios.flatMap((io) => io.lis);
  const t = [90, 70, 65][Math.floor(rnd() * 3)];
  const done = cam.status === "archived" || cam.status === "complete";
  const pr = rnd();
  const pace: Pacing["pace"] = done ? "on" : pr < 0.5 ? "on" : pr < 0.78 ? "over" : "under";
  const pp = pace === "on" ? rnd() * 4 - 2 : pace === "over" ? 2 + rnd() * 9 : -(2 + rnd() * 9);
  const flight = `${fmtMD(cam.start)}–${fmtMD(cam.end)}`;

  return {
    status: cam.status,
    budget: parseMoney(cam.budget),
    marginA: clamp(t + (rnd() * 14 - 5), 45, 99),
    marginT: t,
    pp,
    pace,
    li: lis.length,
    days: daysLeft(cam.end),
    flight,
  };
}

/**
 * Derives the Pacing tab's KPI grid + financial numbers from a pacing record and its flight dates. Pure
 * (no PRNG) — driven by budget/pp/dates, so only `asOf`/`dayN`/`daysLeftN` move with the real clock;
 * the seeded stats from `campPacing` stay fixed. Ported verbatim from the mockup's `pdCompute`.
 *
 * @param pd the pacing input (flight dates, budget, pacing deviation, margin)
 * @return the derived KPI-grid metrics
 */
export function pdCompute(pd: PdInput): PdMetrics {
  const flightDays = Math.max(1, daysBetween(pd.start, pd.end) + 1);
  let dayN = daysBetween(pd.start, todayISO()) + 1;
  dayN = Math.max(1, Math.min(flightDays, dayN));
  const daysLeftN = Math.max(0, flightDays - dayN);
  const planUnits = Math.max(50, Math.round(pd.budget * 0.167));
  const planRate = planUnits / flightDays;
  const planPct = (dayN / flightDays) * 100;
  const actualPct = Math.max(0, planPct + pd.pp);
  const actualByDay = Math.round((planUnits * actualPct) / 100);
  const expectedByDay = Math.round((planUnits * planPct) / 100);
  const neededTotal = planUnits - actualByDay;
  const neededPerDay = Math.round(neededTotal / Math.max(1, daysLeftN));
  const dailyTarget = Math.max(1, Math.round(planRate));
  const actualToday = Math.max(0, Math.round(actualByDay / dayN));

  return {
    flightDays,
    dayN,
    daysLeftN,
    planUnits,
    planRate,
    planPct,
    actualPct,
    actualByDay,
    expectedByDay,
    aboveExpected: actualByDay - expectedByDay,
    neededTotal,
    neededPerDay,
    dailyTarget,
    actualToday,
    aboveDaily: actualToday - dailyTarget,
    daySpend: pd.budget / flightDays,
    asOf: labelDay(pd.start, dayN),
    marginDiff: pd.marginA == null ? null : pd.marginA - pd.marginT,
  };
}
