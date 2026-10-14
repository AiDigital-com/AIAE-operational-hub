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
 * proration of delivery. The one proportion here is the reference's own budget→units fill
 * (`unitsFromBudget`), over two numbers the user typed. `imprWarning` below is the informational-only mirror of the retired SPA's own warning:
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
  /** The line item's budget in USD - the reference's `plan.budget`, i.e. the native budget at the
   *  campaign rate (`setBudgetNative` keeps it that way on every edit). */
  budgetUsd: number | null;
}

/** Generates a short, human-scannable id for a new container/date-child - never sent to Pacing as a
 *  meaningful value beyond identity (Pacing's own id shape, if any, is opaque to the Hub). */
export function genId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Builds the default container that covers a line item's entire flight - the reference's
 *  `buildDefaultContainer`. Named "Default", or "Mar 2026" when the flight sits in one month; a
 *  container added after the first is renamed "Container N" by the caller, as in the reference. */
export function buildDefaultContainer(plan: LiPlanForContainer): PacingContainer {
  let name = "Default";
  if (plan.fs && plan.fe && plan.fs.slice(0, 7) === plan.fe.slice(0, 7)) {
    const month = Number(plan.fs.slice(5, 7));
    if (month >= 1 && month <= 12) name = `${MONTHS[month - 1]} ${plan.fs.slice(0, 4)}`;
  }
  return {
    id: genId("c"),
    name,
    fs: plan.fs || "",
    fe: plan.fe || "",
    target_impressions: plan.targetImpressions ?? 0,
    native_budget: plan.nativeBudget ?? null,
    target_spend: plan.budgetUsd || 0,
    margin_percent: null,
    date_children: [],
    dim_children: [],
  };
}

/** What the units/budget helpers need to know about the owning line item. */
export interface LiBudgetBase {
  planImpr: number;
  budgetUsd: number;
}

/** `shared/units-from-budget.js`: a row's USD budget as units, in proportion to the line item's own
 *  units per USD. Null when the line item has no budget to prorate against. */
export function unitsFromBudget(budgetUsd: number, liUnits: number, liBudgetUsd: number): number | null {
  const liBud = Number(liBudgetUsd) || 0;
  if (!liBud) return null;
  return Math.round(((Number(budgetUsd) || 0) * (Number(liUnits) || 0)) / liBud);
}

/**
 * A Spend edit on a container, date split or dim split - the reference's `setSpendNative`. The
 * typed amount is the contract-currency truth (`native_budget`); `target_spend` is its USD cache at
 * the campaign rate. Blank or zero clears both. `toUsd` is `Currency.currencyToUsd`.
 */
export function spendFromRaw(
  raw: string,
  rate: number,
  toUsd: (native: number, rate: number) => number
): { native_budget: number | null; target_spend: number | null } {
  const native = parseFloat(String(raw).replace(/,/g, ""));
  if (!Number.isFinite(native) || native === 0) return { native_budget: null, target_spend: null };
  return { native_budget: native, target_spend: toUsd(native, rate) };
}

/** The reference's `withBudgetUnits`: after a Spend edit the units follow the new budget (the user
 *  can still type over them). Unchanged when the line item has no budget to prorate against. */
export function withBudgetUnits<T extends { target_impressions: number | null }>(
  base: T,
  budgetUsd: number,
  li: LiBudgetBase
): T {
  const units = unitsFromBudget(budgetUsd, li.planImpr, li.budgetUsd);
  return units == null ? base : { ...base, target_impressions: units };
}

/**
 * Switching a dim split between units and percent - the reference's `setMode`. The number is
 * converted, so 100 000 units does not silently become 100 000 %. Going to percent also drops the
 * split's budget, so no money hides behind a share.
 */
export function dimChildWithMode(
  child: PacingDimChild,
  container: Pick<PacingContainer, "target_impressions">,
  mode: PacingDimChild["target_mode"]
): PacingDimChild {
  const base = Number(container.target_impressions) || 0;
  if (mode === "percent") {
    const abs = Number(child.target_value) || 0;
    const pct = base > 0 && abs > 0 ? Math.round((abs / base) * 10000) / 100 : null;
    return { ...child, target_mode: "percent", target_value: pct, target_spend: null, native_budget: null };
  }
  const wasPercent = (child.target_mode || "absolute") === "percent";
  const pct = Number(child.target_value) || 0;
  const abs = wasPercent && base > 0 && pct > 0 ? Math.round((base * pct) / 100) : wasPercent ? null : child.target_value;
  return { ...child, target_mode: mode, target_value: abs };
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

/** One calendar month of a container's window - the reference's `genMonthlyPeriods`. */
export interface MonthPeriod {
  start: string;
  end: string;
  days: number;
  label: string;
}

/** The calendar months covering [fs, fe], the first and last clipped to the window. */
export function genMonthlyPeriods(fs: string, fe: string): MonthPeriod[] {
  const periods: MonthPeriod[] = [];
  let c = new Date(`${fs}T00:00:00Z`);
  const end = new Date(`${fe}T00:00:00Z`);
  while (c <= end) {
    const ps = c.toISOString().slice(0, 10);
    const me = new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + 1, 0));
    const pe = me < end ? me.toISOString().slice(0, 10) : fe;
    const days = Math.round((new Date(`${pe}T00:00:00Z`).getTime() - new Date(`${ps}T00:00:00Z`).getTime()) / 864e5) + 1;
    periods.push({ start: ps, end: pe, days, label: `${MONTHS[c.getUTCMonth()]} ${c.getUTCFullYear()}` });
    c = new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + 1, 1));
  }
  return periods;
}

/** Whether Distribute can run: a real window and a units target to split. */
export function canDistribute(container: Pick<PacingContainer, "fs" | "fe" | "target_impressions">): boolean {
  return !!(container.fs && container.fe && container.fs <= container.fe && (Number(container.target_impressions) || 0) > 0);
}

/**
 * Distribute by Month - the reference's `doDistribute`. Replaces the container's date splits with
 * one per calendar month: `proportional` by days in the month, `equal` the same share each. The last
 * month takes the remainder, so units and USD spend add up exactly. Each split's native budget is
 * its USD share converted back at the campaign rate (`usdToNative`), so a non-USD Spend cell is
 * filled too.
 */
export function distributeByMonth(
  container: PacingContainer,
  mode: "proportional" | "equal",
  rate: number,
  usdToNative: (usd: number, rate: number) => number
): PacingContainer {
  const { fs, fe } = container;
  if (!fs || !fe || fs > fe) return container;
  const ti = Number(container.target_impressions) || 0;
  const ts = Number(container.target_spend) || 0;
  const periods = genMonthlyPeriods(fs, fe);
  const totalDays = periods.reduce((sum, p) => sum + p.days, 0);
  const n = periods.length;
  let usedU = 0;
  let usedB = 0;
  const next: PacingDateChild[] = periods.map((pr, i) => {
    const isLast = i === n - 1;
    const dcTi = mode === "equal"
      ? (isLast ? ti - usedU : Math.round(ti / n))
      : (isLast ? ti - usedU : Math.round((ti * pr.days) / totalDays));
    const dcTs = mode === "equal"
      ? (isLast ? Math.round((ts - usedB) * 100) / 100 : Math.round((ts / n) * 100) / 100)
      : (isLast ? Math.round((ts - usedB) * 100) / 100 : Math.round(((ts * pr.days) / totalDays) * 100) / 100);
    usedU += dcTi;
    usedB += dcTs;
    const dcNb = dcTs ? Math.round(usdToNative(dcTs, rate) * 100) / 100 : null;
    return {
      id: genId("d"),
      name: pr.label,
      fs: pr.start,
      fe: pr.end,
      target_impressions: dcTi || null,
      native_budget: dcNb,
      target_spend: dcTs || null,
      margin_percent: null,
    };
  });
  return { ...container, date_children: next };
}

/** What "Fit LI to containers" would change - the reference's `fitProposal`. */
export interface FitProposal {
  sumTi: number;
  sumTs: number;
  earliestFs: string;
  latestFe: string;
  needsImpr: boolean;
  needsBudget: boolean;
  needsFs: boolean;
  needsFe: boolean;
  anyFit: boolean;
}

/**
 * Does every container fit inside its line item? A container with no USD budget of its own counts
 * its units' share of the line item's budget. `planImpr` / `budgetUsd` / `fs` / `fe` are the line
 * item's as currently typed.
 */
export function fitProposal(
  li: { planImpr: number; budgetUsd: number; fs: string; fe: string },
  containers: readonly PacingContainer[]
): FitProposal {
  const planImpr = Number(li.planImpr) || 0;
  const planBud = Number(li.budgetUsd) || 0;
  let sumTi = 0;
  let sumTs = 0;
  let earliestFs = li.fs || "";
  let latestFe = li.fe || "";
  for (const c of containers || []) {
    const cTi = Number(c.target_impressions) || 0;
    sumTi += cTi;
    if (c.target_spend != null && Number(c.target_spend) > 0) sumTs += Number(c.target_spend);
    else if (planImpr > 0 && cTi > 0) sumTs += (cTi / planImpr) * planBud;
    if (c.fs && (!earliestFs || c.fs < earliestFs)) earliestFs = c.fs;
    if (c.fe && (!latestFe || c.fe > latestFe)) latestFe = c.fe;
  }
  const needsImpr = sumTi > planImpr;
  const needsBudget = sumTs > planBud + 0.0001;
  const needsFs = !!(earliestFs && li.fs && earliestFs < li.fs);
  const needsFe = !!(latestFe && li.fe && latestFe > li.fe);
  return { sumTi, sumTs, earliestFs, latestFe, needsImpr, needsBudget, needsFs, needsFe, anyFit: needsImpr || needsBudget || needsFs || needsFe };
}

/**
 * The line item's warning dot, the reference's `liWarnings.fit`: container units over the plan, USD
 * spend over the budget, or a container outside the flight. Stricter than `fitProposal` on spend -
 * a container with no budget of its own adds nothing here, as in the reference.
 */
export function containersExceedLi(
  li: { planImpr: number; budgetUsd: number; fs: string; fe: string },
  containers: readonly PacingContainer[]
): boolean {
  const planImpr = Number(li.planImpr) || 0;
  const planBud = Number(li.budgetUsd) || 0;
  let sumTi = 0;
  let sumTs = 0;
  let outside = false;
  for (const c of containers || []) {
    sumTi += Number(c.target_impressions) || 0;
    sumTs += Number(c.target_spend) || 0;
    if ((c.fs && li.fs && c.fs < li.fs) || (c.fe && li.fe && c.fe > li.fe)) outside = true;
  }
  return (planImpr > 0 && sumTi > planImpr) || (planBud > 0 && sumTs > planBud + 0.0001) || outside;
}
