/**
 * What a brick shows — looked up, never computed.
 *
 * This file used to hold a TypeScript reimplementation of the Pacing SPA's
 * value resolution: campaign metrics, a formula evaluator, the margin and pace
 * word bands, the detail-card sources. It was a reasonable-faith port and it
 * was still wrong to have, for the reason metric-registry.js states plainly —
 * a second copy of a metric drifts from the first, and the failure mode is a
 * confident number rather than an error. It reported a campaign's delivery
 * larger than Pacing did, because it summed fact rows the canonical code
 * excludes as falling outside a line item's flight.
 *
 * That engine now lives in Pacing (shared/dashboard-metrics.js) and arrives
 * resolved, on `PacingDashboardV1.metrics`. Everything below is a lookup into
 * that payload. The only arithmetic left is `deltaOf`, which subtracts a target
 * from a value.
 *
 * If a figure is missing or wrong, the fix belongs in Pacing. Adding the
 * calculation here would recreate exactly what was removed.
 */
import type { PacingMetricsBag, DetailSource, RateRow } from "../types-metrics";
import type { BindSpec, Brick, StatRowCell } from "./widget-types";
import type { Tone } from "./widget-status";

export interface BrickCtx {
  /** Everything Pacing computed for this pacing. Null before it loads, and on a
   *  pacing Pacing could not derive figures for. */
  metrics: PacingMetricsBag | null;
  /** The column's own status, when this brick sits inside a `frame: 'card'` column
   *  that carries a badge. A framed card's bricks colour themselves by the SAME
   *  reading its badge already made, so a card's badge and its headline number can
   *  never disagree. */
  status?: Tone;
  compact?: boolean;
  /** The campaign's currency code, for the money bricks. A property of the pacing
   *  rather than of any figure, so it rides here instead of in the metric bag. */
  currency?: string | null;
}

export interface BrickValue {
  value: number | null;
  target: number | null;
  /** Lower is better — an overspending CPM reads badly, a high VCR reads well. */
  invert?: boolean;
  sub?: string | null;
  format?: string;
}

const EMPTY: BrickValue = { value: null, target: null };

/**
 * A binding resolves through the key Pacing filed it under: the binding's own
 * JSON. Keying by text rather than by position means the same binding in two
 * widgets resolves to one entry, and reordering a layout changes nothing.
 *
 * JSON.stringify agrees with the server's key because both walk the same object
 * from the same payload — the server serialized the binding it read out of
 * `display`, and this reads the binding out of the same `display`. Property
 * order is preserved through JSON, so the two strings match.
 */
function lookup(bind: BindSpec | undefined, ctx: BrickCtx): BrickValue {
  if (!bind || !ctx.metrics) return EMPTY;
  const resolved = ctx.metrics.bound[JSON.stringify(bind)];
  // Explicitly-null means Pacing could not resolve it — an unknown metric, a
  // malformed expression. Undefined means it never saw this binding at all,
  // which happens while a just-added widget's save is still in flight. Both
  // render as "no figure"; neither is zero.
  if (!resolved) return EMPTY;
  return {
    value: resolved.value,
    target: resolved.target ?? null,
    invert: resolved.invert,
    sub: resolved.sub ?? null,
  };
}

/**
 * A brick's figure and what it is measured against.
 *
 * An explicit `target` binding wins over the metric's canonical one, and when it is itself
 * a metric what is taken is that metric's VALUE - "margin against pacing" means the pacing
 * number.
 *
 * ONE exception, and the standard hero depends on it: a target naming the SAME metric as
 * the value ("margin against margin") is the metric measured against ITS OWN target,
 * because a number compared with itself is a delta of zero and means nothing. The hero's
 * margin gauge, its badge and the Margin card's meter are all written that way - read
 * literally they sit at "On target" forever, on every campaign, which is exactly what this
 * screen did until the rule came back.
 */
export function brickValue(brick: Brick, ctx: BrickCtx): BrickValue {
  const base = lookup(brick.bind, ctx);
  const selfTarget =
    brick.target?.metric != null && brick.bind?.metric != null && brick.target.metric === brick.bind.metric;
  const target = brick.target && !selfTarget ? lookup(brick.target, ctx).value : base.target;
  return { ...base, target, format: brick.format };
}

export function resolveBindValue(bind: BindSpec | undefined, ctx: BrickCtx): number | null {
  return lookup(bind, ctx).value;
}

export function cellValue(cell: StatRowCell, ctx: BrickCtx): BrickValue & { absent: boolean } {
  const resolved = brickValue(cell as Brick, ctx);
  return { ...resolved, absent: resolved.value == null };
}

/** The one calculation left in this file. */
export function deltaOf(v: { value: number | null; target: number | null }): number | null {
  if (v.value == null || v.target == null) return null;
  return v.value - v.target;
}

export function detailSource(source: string, ctx: BrickCtx): DetailSource | null {
  if (!ctx.metrics) return null;
  return ctx.metrics.sources[source] ?? null;
}

export interface FlightProgress {
  day: number;
  total: number;
  daysLeft: number;
  daysLeftText: string;
}

export function flightProgress(ctx: BrickCtx): FlightProgress | null {
  return (ctx.metrics?.readings.flightProgress as FlightProgress | null) ?? null;
}

export interface Verdict {
  word: string;
  status: Tone;
  reason: string | null;
}

export function verdictOf(ctx: BrickCtx): Verdict | null {
  return (ctx.metrics?.readings.verdict as Verdict | null) ?? null;
}

export function marginTone(ctx: BrickCtx): Tone | undefined {
  return (ctx.metrics?.readings.marginTone as Tone | null) ?? undefined;
}

/** One row of the delivery bars, exactly as brick-data.js builds it: the unit's
 *  plan, what was delivered, what was expected by now, and the pace judgement.
 *  `hasPlan` is false when the unit has no target at all — the reason such a row
 *  reads "plan not set" instead of "0.0% behind". */
export interface DeliveryUnit {
  unit: string;
  plan: number;
  actual: number;
  expected: number;
  hasPlan: boolean;
  paceDelta: number;
  plannedPct: number;
  actualPct: number;
  status: Tone;
  opText: string;
}

export function deliveryUnits(ctx: BrickCtx): DeliveryUnit[] {
  const units = ctx.metrics?.readings.deliveryUnits;
  return Array.isArray(units) ? (units as DeliveryUnit[]) : [];
}

/**
 * The per-rate-type rows a Finance card repeats over, for the series the brick names.
 *
 * Computed by Pacing (`rateTypeRows`) on the same two bags every other figure here uses. This
 * side carried a stub claiming the numbers needed a DSP model nobody had ported - they did not;
 * nothing was calling the function.
 */
export function rateRows(series: string | undefined, ctx: BrickCtx): RateRow[] {
  if (!series) return [];
  const all = ctx.metrics?.readings.rateRows as Record<string, RateRow[]> | undefined;
  const rows = all?.[series];
  return Array.isArray(rows) ? rows : [];
}

/**
 * The word band for a `words` brick — "Above target", "Behind", "On pace".
 *
 * The bands themselves are Pacing's (widget-status.js): which delta earns which
 * word, and whether that word reads as good or bad. What arrives here is the
 * already-judged reading, so this only picks the caption out of it.
 */
export function badgeWords(words: string, ctx: BrickCtx): { text: string; status: Tone } | null {
  const verdict = verdictOf(ctx);
  if (!verdict) return null;
  return { text: words === "verdict" ? verdict.word : words, status: verdict.status };
}

/** The explanatory line under a detail card, when Pacing supplied one. */
export function canonicalNote(source: string, ctx: BrickCtx): string | null {
  return detailSource(source, ctx)?.sub ?? null;
}
