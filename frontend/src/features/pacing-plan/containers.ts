/**
 * Container helpers for the Pacing Settings plan editor (§9 of the migration plan, US-125) - a
 * TypeScript port of the retired SPA's container-building logic
 * (workspace/src/pages/Dashboard/components/Settings/PacingTab.jsx: buildDefaultContainer,
 * duplicateContainer, nextMonthPeriod) and its warning helper (container-warnings.js: imprWarning).
 *
 * A container is opaque wire data (`PacingLineItemPlanUpdateV1.containers` is
 * `Record<string, unknown>[]`) - Pacing is the only party that parses or validates its shape (the
 * container-existence rule, the target-impressions bound against the line item's own plan). What
 * lives here is string/number bookkeeping to build the JSON object the user asked for (a new
 * container, a duplicate scaled by a factor they typed) - never a delivery figure, an actual, or a
 * proration. `imprWarning` below is the informational-only mirror of the retired SPA's own warning:
 * Pacing owns the real "container total exceeds the line item's plan" rejection (or, today, does not
 * yet enforce it at save time at all - see the migration notes); this never blocks a save.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface PacingDateChild {
  id: string;
  name?: string | null;
  fs: string | null;
  fe: string | null;
  target_impressions: number | null;
  native_budget?: number | null;
  target_spend: number | null;
  margin_percent?: number | null;
}

/**
 * A sub-breakdown (§10, US-129/130): a slice of a container along ONE dimension.
 *
 * Date children say WHEN a container's units land; dim children say WHAT they are.
 * `target_value` is read through `pacing-core.js:resolveDimAbs`, which is why
 * `target_mode` matters: `absolute` is a unit count, `percent` is a share OF the
 * parent container's `target_impressions`. Anything that scales a container must
 * scale an absolute target and leave a percent one alone - see `duplicateContainer`.
 *
 * `dim_value` is free text on purpose (US-130): the manager plans against what the
 * client asked for, which need not exist in NetSuite.
 */
export interface PacingDimChild {
  id: string;
  dim_key: string;
  dim_value: string;
  target_mode: "absolute" | "percent";
  target_value: number | null;
  native_budget?: number | null;
  target_spend: number | null;
  margin_percent?: number | null;
  notify_in_summary?: boolean;
}

export interface PacingContainer {
  id: string;
  name: string;
  fs: string;
  fe: string;
  target_impressions: number | null;
  native_budget?: number | null;
  target_spend: number | null;
  margin_percent?: number | null;
  date_children: PacingDateChild[];
  dim_children: PacingDimChild[];
  // Transport-only (§9): a client-built duplicate carries these three so dash-gate's existing
  // duplicate mechanism can record the operation; it strips them once persisted (never stored).
  __action?: string;
  __source_id?: string;
  __scale?: number;
}

/** The subset of a line item's plan a container needs to seed sensible defaults from. */
export interface LiPlanForContainer {
  fs: string;
  fe: string;
  targetImpressions: number | null;
  nativeBudget: number | null;
}

/** Generates a short, human-scannable id for a new container/date-child - never sent to Pacing as a
 *  meaningful value beyond identity (Pacing's own id shape, if any, is opaque to the Hub). */
export function genId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Builds the default container that covers a line item's entire flight - offered when the manager
 *  adds the first container to a line item that has none yet. Copies the LI's own targets 1:1 so the
 *  new container starts as "the whole flight, once", the natural starting point before splitting it. */
export function buildDefaultContainer(plan: LiPlanForContainer, name = "Container"): PacingContainer {
  let label = name;
  if (plan.fs && plan.fe && plan.fs.slice(0, 7) === plan.fe.slice(0, 7)) {
    const month = Number(plan.fs.slice(5, 7));
    if (month >= 1 && month <= 12) label = `${MONTHS[month - 1]} ${plan.fs.slice(0, 4)}`;
  }
  return {
    id: genId("c"),
    name: label,
    fs: plan.fs || "",
    fe: plan.fe || "",
    target_impressions: plan.targetImpressions ?? 0,
    native_budget: plan.nativeBudget ?? null,
    target_spend: null,
    margin_percent: null,
    date_children: [],
    dim_children: [],
  };
}

/** Calendar-month shift: the default {fs, fe, name} the Duplicate dialog seeds for "next period". */
export function nextMonthPeriod(srcFs: string, srcFe: string): { fs: string; fe: string; name: string | null } {
  const fs = new Date(`${srcFs}T00:00:00Z`);
  const fe = new Date(`${srcFe}T00:00:00Z`);
  const sameCalendarMonth =
    fs.getUTCFullYear() === fe.getUTCFullYear() &&
    fs.getUTCMonth() === fe.getUTCMonth() &&
    fs.getUTCDate() === 1 &&
    fe.getUTCDate() === new Date(Date.UTC(fe.getUTCFullYear(), fe.getUTCMonth() + 1, 0)).getUTCDate();
  if (sameCalendarMonth) {
    const month = fs.getUTCMonth() + 1;
    const nextMonth = month === 12 ? 0 : month;
    const nextYear = month === 12 ? fs.getUTCFullYear() + 1 : fs.getUTCFullYear();
    const newFs = new Date(Date.UTC(nextYear, nextMonth, 1));
    const newFe = new Date(Date.UTC(nextYear, nextMonth + 1, 0));
    return {
      fs: newFs.toISOString().slice(0, 10),
      fe: newFe.toISOString().slice(0, 10),
      name: `${MONTHS[nextMonth]} ${nextYear}`,
    };
  }
  const spanDays = Math.round((fe.getTime() - fs.getTime()) / 864e5);
  const newFs = new Date(fe.getTime() + 864e5);
  const newFe = new Date(newFs.getTime() + spanDays * 864e5);
  return { fs: newFs.toISOString().slice(0, 10), fe: newFe.toISOString().slice(0, 10), name: null };
}

/**
 * Builds a duplicate of `src`, scaled by `scale` (the monthly-renewal button, §9's whole point per
 * the container spec: "duplicate January into February at scale 1.1"). Multiplying a user-typed
 * target by a user-typed factor is the same class of string/number bookkeeping the Create Pacing
 * bulk-edit already does (bulk.ts's `coerceValue`) - not pacing arithmetic, and not a substitute for
 * Pacing's own validation of the result. The three `__action`/`__source_id`/`__scale` fields are
 * dash-gate's own existing duplicate-transport marker (db.mjs strips them once persisted) - set here,
 * never invented server-side.
 */
export function duplicateContainer(
  src: PacingContainer,
  opts: { name: string | null; fs: string; fe: string; scale: number }
): PacingContainer {
  const scale = Number.isFinite(opts.scale) && opts.scale > 0 ? opts.scale : 1;
  const dateChildren = (src.date_children || []).map((dc) => ({
    ...dc,
    id: genId("d"),
    target_impressions: dc.target_impressions ? Math.round(dc.target_impressions * scale) : null,
    native_budget: dc.native_budget ? Math.round(dc.native_budget * scale * 100) / 100 : null,
    target_spend: dc.target_spend ? Math.round(dc.target_spend * scale * 100) / 100 : null,
  }));
  // Dim children clone exactly as the retired SPA cloned them (PacingTab.jsx:150-162): a fresh id so
  // the copy never shares a key with its source, and every ABSOLUTE figure scaled. A percent-mode
  // `target_value` is deliberately left alone - pacing-core's resolveDimAbs reads it as a share OF
  // `container.target_impressions`, which this duplicate already scaled, so scaling it here too would
  // apply the factor twice (§10 gave these an editor; before that the only way to own one was to have
  // authored it in the old UI, and a duplicate still had to carry it intact).
  const dimChildren: PacingDimChild[] = (src.dim_children || []).map((dx) => ({
    ...dx,
    id: genId("x"),
    target_value: dx.target_mode === "percent"
      ? dx.target_value
      : (dx.target_value ? Math.round(dx.target_value * scale) : null),
    native_budget: dx.native_budget ? Math.round(dx.native_budget * scale * 100) / 100 : null,
    target_spend: dx.target_spend ? Math.round(dx.target_spend * scale * 100) / 100 : null,
  }));
  return {
    id: genId("c"),
    name: opts.name || `${src.name || "Container"} (copy)`,
    fs: opts.fs,
    fe: opts.fe,
    target_impressions: src.target_impressions ? Math.round(src.target_impressions * scale) : null,
    native_budget: src.native_budget ? Math.round(src.native_budget * scale * 100) / 100 : null,
    target_spend: src.target_spend ? Math.round(src.target_spend * scale * 100) / 100 : null,
    margin_percent: src.margin_percent ?? null,
    date_children: dateChildren,
    dim_children: dimChildren,
    __action: "duplicate",
    __source_id: src.id,
    __scale: scale,
  };
}

/**
 * Dimension keys a sub-breakdown may use (§10). Eleven, per the migration plan.
 *
 * Wider than the retired SPA's own list (`PacingTab.jsx:31` has eight) because that
 * one enumerated only NAMEBUILDER dimensions. `tactic`, `platform` and `channel` are
 * line-item properties rather than namebuilder positions, and Pacing's own validator
 * (`dash-gate/lib/widgets-validate.mjs`'s DIM_KEYS) has accepted all eleven since
 * 2026-08-11 - `channel`'s comment there records what the narrower list cost: an axis
 * that could be picked and drawn but never saved.
 *
 * Nothing on the Pacing side validates a CONTAINER's dim_key on save (only widget
 * axes are checked), so this list is the only guard. Widening it here widens what
 * gets stored, with no server-side net.
 */
export const DIM_KEYS = [
  "audience", "tactic", "platform", "comment", "geo", "creative",
  "message", "keyword", "flight", "language", "channel",
] as const;

export const DIM_LABELS: Record<string, string> = {
  audience: "Audience", tactic: "Tactic", platform: "Platform", comment: "Comment",
  geo: "Geo", creative: "Creative", message: "Message", keyword: "Keyword",
  flight: "Flight", language: "Language", channel: "Channel",
};

/** "Audience: Sports fans" - the retired SPA's `dimChildLabel`, same shape. */
export function dimChildLabel(child: Pick<PacingDimChild, "dim_key" | "dim_value">): string {
  const label = DIM_LABELS[child.dim_key] || child.dim_key;
  return `${label}: ${child.dim_value}`;
}

/** A new sub-breakdown on `dim_key`/`dim_value`, targets left for the manager to fill.
 *  Mirrors the retired SPA's `addDimChild` (PacingTab.jsx:894) field for field. */
export function buildDimChild(dimKey: string, dimValue: string): PacingDimChild {
  return {
    id: genId("x"),
    dim_key: dimKey,
    dim_value: dimValue,
    target_mode: "absolute",
    target_value: null,
    native_budget: null,
    target_spend: null,
    margin_percent: null,
    notify_in_summary: false,
  };
}

/**
 * One sub-breakdown's target in absolute units - the Hub-side mirror of
 * `pacing-core.js:resolveDimAbs` (line 290), which is the canonical reader.
 *
 * A percent target is a share of the PARENT's `target_impressions`. That is the whole
 * reason `target_mode` exists, and the reason a duplicate must not scale it twice.
 */
export function resolveDimAbs(
  child: Pick<PacingDimChild, "target_mode" | "target_value">,
  container: Pick<PacingContainer, "target_impressions">,
): number {
  const v = Number(child.target_value) || 0;
  if (child.target_mode === "percent") return ((Number(container.target_impressions) || 0) * v) / 100;
  return v;
}

/**
 * Which dimension KEYS have over-allocated this container, if any.
 *
 * Summed PER KEY and never across keys. Audience and Geo cut the same units along
 * independent axes, so their targets are not additive - the retired SPA fixed exactly
 * this bug (`PacingTab.jsx:950`, "Summing them fired a false 'exceeds container
 * target' on any container carrying two different dimensions"), and `dim-scope.js`'s
 * single-dim rule says the same. Add them up and every container carrying two
 * dimensions warns for nothing.
 *
 * Informational only, like every other container warning here: Pacing does not
 * enforce it on save.
 */
export function dimKeysOverTarget(container: PacingContainer): string[] {
  const target = Number(container.target_impressions) || 0;
  if (target <= 0) return [];
  const sums = new Map<string, number>();
  for (const child of container.dim_children || []) {
    sums.set(child.dim_key, (sums.get(child.dim_key) || 0) + resolveDimAbs(child, container));
  }
  return [...sums.entries()].filter(([, sum]) => roundedGreaterThan(sum, target)).map(([key]) => key);
}

/** A new, empty date split inside `container` - fs/fe default to the container's own window. */
export function buildDateChild(container: Pick<PacingContainer, "fs" | "fe">): PacingDateChild {
  return {
    id: genId("d"),
    name: null,
    fs: container.fs || null,
    fe: container.fe || null,
    target_impressions: null,
    native_budget: null,
    target_spend: null,
    margin_percent: null,
  };
}

/** Rounded-compare guard against summed-float drift, ported from the retired SPA's
 *  container-warnings.js `cmp`/`imprWarning` - integer units, so multiplier 1 is enough. */
function roundedGreaterThan(a: number, b: number): boolean {
  return Math.round(a) > Math.round(b);
}

/**
 * Sum of every container's `target_impressions` for one line item - the LEFT side of §9's container
 * rule ("sum of container target_impressions must not exceed the line item's own plan"). Pure
 * addition of numbers the user already typed into the form, not a delivery figure.
 */
export function containerImprSum(containers: PacingContainer[]): number {
  return containers.reduce((sum, c) => sum + (Number(c.target_impressions) || 0), 0);
}

/**
 * Whether the containers' combined target exceeds the line item's own plan - an INFORMATIONAL hint
 * only (mirrors the retired SPA's own non-blocking warning banner). Pacing is the party that owns
 * this rule; it is not pre-rejected or clamped here, only surfaced as a heads-up before the caller
 * saves and finds out from Pacing's own response.
 */
export function containerSumExceedsPlan(planTargetImpressions: number | null, containers: PacingContainer[]): boolean {
  const plan = Number(planTargetImpressions) || 0;
  if (plan <= 0) return false;
  return roundedGreaterThan(containerImprSum(containers), plan);
}

/** A pacing is single-currency; a candidate line item is addable only if its currency matches the
 *  pacing's own. Null/empty normalizes to USD (the operational base) - ported verbatim from the
 *  retired SPA's add-li-map.js `currencyMatches`. A plain string-equality check, not a computed
 *  figure - and, per the migration notes, the only place this comparison is made at all today
 *  (Pacing's settings-save endpoint does not itself reject a currency mismatch), so this is the real
 *  gate here, not a convenience layered on top of one. */
export function currencyMatches(candidateCurrency: string | null | undefined, pacingCurrency: string | null | undefined): boolean {
  const normalize = (c: string | null | undefined) => (c || "USD").toUpperCase();
  return normalize(candidateCurrency) === normalize(pacingCurrency);
}
