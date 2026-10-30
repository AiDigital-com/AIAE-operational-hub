/**
 * Reads Pacing's dashboard body (`PacingDashboardWireV1`, the bytes the Hub copies through from
 * `GET /api/dashboards/:slug/data` since the 2026-10-29 pass-through) into the type every screen in
 * this feature already consumes, `PacingDashboardV1`.
 *
 * A ONE-TO-ONE PORT of the Java mapper that used to do this in the Hub
 * (`PacingDashboardContractMapper.toV1(PacingDashboardData, ownPacingUserId, unrestricted)` and its
 * helpers, deleted in the same change - DASHBOARD-DATA-PASSTHROUGH-PLAN §4/§5). Function names below
 * are the Java ones; each rule carries the line of the Java source it came from, and the output is
 * held byte-equal (after a JSON round-trip) to the Java mapper's over real bodies by
 * `wire.parity.test.ts`. Nothing here is a design decision: where the Java mapper was odd (it dropped
 * `campaign.timezone`, it renamed `id` to `slug`, it flattened some nulls and kept others), this is
 * odd the same way, on purpose - the consumers of `PacingDashboardV1` were audited against today's
 * output, not against a better one. Fixing the Java mapper's known gaps is a separate ticket (§9).
 *
 * Two layers are reproduced, because both shaped the bytes the browser saw:
 *
 * 1. JACKSON, reading the wire into Java records (`RestClient`'s default mapper): unknown keys are
 *    dropped; a scalar is coerced to the field's type (a number into a `String` field becomes
 *    `"123"`, `"1.5"` into a `Double` becomes 1.5, `"true"` into a `boolean` becomes true); a
 *    PRIMITIVE field (`boolean`, `double`, `int`) reads an absent or null value as `false`/`0`;
 *    a fraction into an `int` is truncated. The helpers `str`/`dbl`/`dblPrim`/`int32`/`int64`/
 *    `bool`/`boolPrim` are those rules. On the real wire `merge.mjs` sends typed values, so the
 *    coercions only ever fire on garbage - and on garbage Jackson would usually have failed the
 *    whole request, which is what the `throw`s below reproduce.
 * 2. THE BOOT MAPPER, writing the generated `PacingDashboardV1` back out: every field of the model
 *    is written, `null` as `null`. So wherever the Java side held null, this returns `null` - never
 *    `undefined`, never a missing key - and a list the mapper never touched is the model's own
 *    `new ArrayList<>()`, i.e. `[]`.
 *
 * The generated TypeScript type for `PacingDashboardV1` does not admit `null` for several fields
 * that arrive as `null` at runtime (it never did - the JSON the Java mapper sent carried the same
 * nulls). The object is built as `WireOutput` and asserted to `PacingDashboardV1` once, at the end,
 * which is the one place this file lies to the type checker, and it lies the way the wire always has.
 */
import type { components } from "../../shared/api/generated/schema";
import type { PacingDashboardV1 } from "./types";

export type PacingDashboardWireV1 = components["schemas"]["PacingDashboardWireV1"];
type WireCampaign = NonNullable<PacingDashboardWireV1["campaign"]>;
type WirePlan = components["schemas"]["PacingDashboardWireLineItemPlanV1"];
type WireJournalEntry = components["schemas"]["PacingDashboardWireJournalEntryV1"];
type WireNotify = NonNullable<PacingDashboardWireV1["notify"]>;
type WireAlerts = NonNullable<WireNotify["alerts"]>;
type WireDeliveryStats = NonNullable<PacingDashboardWireV1["deliveryStats"]>;

/** What the Java mapper took from the caller: `resolveOwnPacingUserId(user)` and
 *  `PacingScope.KIND_ALL.equals(entitlement.scope().kind())` (PacingDashboardController.java:111-113). Now
 *  `UserV1.pacingUserId` / `UserV1.pacingUnrestricted` from `/api/v1/auth/me`. */
export interface WireContext {
  ownPacingUserId: string | null;
  unrestricted: boolean;
}

/**
 * The context of nobody in particular: no own Pacing id, restricted scope - every journal entry reads
 * `canEdit: false`. For a caller that reads a pass-through slice of the body (`dimSources`, `data`,
 * ...) and never the journal, and has no `/auth/me` at hand - `spa/settings-api.js`'s re-read after
 * a sheet-source read is the one such caller. Never for the dashboard page itself.
 */
export const NOBODY: WireContext = Object.freeze({ ownPacingUserId: null, unrestricted: false });

/** Thrown where Jackson or the Java mapper would have failed the request (a 500 to the browser). */
export class WireError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WireError";
  }
}

/* ── Jackson's coercions ─────────────────────────────────────────────────────────────────────── */

/** A `String` field: null/absent stay null; a number or boolean is printed; an object fails. */
export function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  throw new WireError(`expected a string, got ${describe(v)}`);
}

/** A `Double` field: null/absent stay null; a numeric string is parsed; anything else fails. */
export function dbl(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "") return null;
    const n = Number(t);
    if (Number.isNaN(n)) throw new WireError(`expected a number, got "${v}"`);
    return n;
  }
  throw new WireError(`expected a number, got ${describe(v)}`);
}

/** A primitive `double` field: absent/null read as 0. */
export function dblPrim(v: unknown): number {
  return dbl(v) ?? 0;
}

/** A primitive `int` field: absent/null read as 0; a fraction is truncated (ACCEPT_FLOAT_AS_INT). */
export function int32(v: unknown): number {
  const n = dbl(v);
  return n === null ? 0 : Math.trunc(n);
}

/** A `Long` field: null/absent stay null; a fraction is truncated. */
export function int64(v: unknown): number | null {
  const n = dbl(v);
  return n === null ? null : Math.trunc(n);
}

/** A `Boolean` field: null/absent stay null; "true"/"false" and 0/1 coerce; anything else fails. */
export function bool(v: unknown): boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (v === "true") return true;
    if (v === "false") return false;
    if (v.trim() === "") return null;
    throw new WireError(`expected a boolean, got "${v}"`);
  }
  if (typeof v === "number" && Number.isInteger(v)) return v !== 0;
  throw new WireError(`expected a boolean, got ${describe(v)}`);
}

/** A primitive `boolean` field: absent/null read as false. */
export function boolPrim(v: unknown): boolean {
  return bool(v) ?? false;
}

/** A `List<String>` field: null/absent stay null; each element coerced like `str`. */
function strList(v: unknown): string[] | null {
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v)) throw new WireError(`expected a list, got ${describe(v)}`);
  return v.map((x) => {
    const s = str(x);
    if (s === null) throw new WireError("a null inside a list of strings");
    return s;
  });
}

/** A `Map<String, Object>` field: null/absent stay null; an array or scalar fails. Passed through. */
function asObject(v: unknown, field: string): Record<string, unknown> | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object" || Array.isArray(v)) throw new WireError(`${field}: expected an object, got ${describe(v)}`);
  return v as Record<string, unknown>;
}

/** A `List<Map<String, Object>>` field: null/absent stay null; a non-list, or a non-object inside, fails. */
function asObjectList(v: unknown, field: string): Record<string, unknown>[] | null {
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v)) throw new WireError(`${field}: expected a list, got ${describe(v)}`);
  for (const item of v) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new WireError(`${field}: expected objects inside the list, got ${describe(item)}`);
    }
  }
  return v as Record<string, unknown>[];
}

function describe(v: unknown): string {
  return v === null ? "null" : Array.isArray(v) ? "an array" : typeof v;
}

/* ── the mapper's own helpers ────────────────────────────────────────────────────────────────── */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `parseDate` (PacingDashboardContractMapper.java:877-886): null/blank → null; otherwise
 * `LocalDate.parse`, and a malformed value degrades to null rather than failing the response.
 * `LocalDate.parse` is ISO `uuuu-MM-dd`, strict on the calendar (`2026-02-30` fails) and on the
 * shape (`2026-3-1`, `2026-03-01T00:00` fail). The Boot mapper writes a LocalDate back as the same
 * ten characters, so a valid input is returned as is.
 */
export function parseDate(value: unknown): string | null {
  const s = str(value);
  if (s === null || s.trim() === "") return null;
  const m = ISO_DATE.exec(s);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return null;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= daysInMonth ? s : null;
}

/** `summaryProjectionOf` (246-250): `plan` is plan, anything else - including absent - is `reforecast`. */
export function summaryProjectionOf(stored: unknown): "plan" | "reforecast" {
  return str(stored) === "plan" ? "plan" : "reforecast";
}

/* ── the output, as the Java model writes it ─────────────────────────────────────────────────── */

type Json = Record<string, unknown>;

interface CampaignOutput {
  slug: string | null;
  pacingId: string | null;
  name: string | null;
  startDate: string | null;
  endDate: string | null;
  currency: string | null;
  rate: number | null;
  rateLocked: boolean | null;
  nsRate: number | null;
  netMode: boolean | null;
  periodScope: boolean | null;
  periodScopeKey: string | null;
  status: string | null;
  orderNumber: string | null;
  sourceUrl: string | null;
  links: { name: string | null; url: string | null }[];
}

interface PlanOutput {
  lineItemId: string | null;
  channel: string | null;
  dsp: string | null;
  labels: string[];
  description: string | null;
  rateType: string | null;
  clientBudget: number | null;
  plannedImpressions: number | null;
  marginTargetPct: number | null;
  ctrTargetPct: number | null;
  vcrTargetPct: number | null;
  flightStart: string | null;
  flightEnd: string | null;
  pauseIntervals: { from: string | null; to: string | null }[];
  containers: Json[];
  dimGroups: Json[];
  primaryConversions: string[] | null;
  storedPrimaryConversions: string[] | null;
  conversionData: boolean | null;
  nativeBudget: number | null;
  costCoef: boolean | null;
  netRatio: number | null;
  storedNetRatio: number | null;
  netRatioLocked: boolean;
  nsNetRatio: number | null;
  converted: boolean | null;
  currency: string | null;
}

interface JournalEntryOutput {
  id: string | null;
  ts: string | null;
  msg: string | null;
  uid: string | null;
  editedAt: string | null;
  canEdit: boolean;
}

interface RuleBase { enabled: boolean; slack: boolean }

interface AlertsOutput {
  enabled: boolean;
  bidFactAbovePlan: RuleBase & { window: number; thresholdPct: number };
  dataGap: RuleBase & { gapDays: number };
  ctrBelowTarget: RuleBase & { factor: number };
  vcrBelowTarget: RuleBase & { factor: number };
  ctrAboveTarget: RuleBase & { factor: number };
  vcrOver100: RuleBase;
  noImpressionsYet: RuleBase;
  pacingOffPace: RuleBase & { low: number; high: number };
  marginBelowTarget: RuleBase & { gapPp: number };
  spendOverspend: RuleBase & { warnPct: number; badPct: number };
  dspForecastOverspend: RuleBase;
  staleData: RuleBase & { days: number };
  rateCostAbovePlan: RuleBase & { thresholdPct: number };
}

interface NotifyOutput {
  alerts: AlertsOutput;
  metrics: { vcr: boolean };
  hidePaused: boolean;
  summaryProjection: "plan" | "reforecast";
}

interface DeliveryStatsOutput {
  rows: number | null;
  cells: number | null;
  measuredAt: string | null;
  autoOffAt: string | null;
}

/** Every field of the generated `PacingDashboardV1`, in the nullability the Boot mapper actually writes. */
export interface WireOutput {
  campaign: CampaignOutput;
  planByLineItem: Record<string, PlanOutput>;
  factsDaily: Json[];
  asOf: string | null;
  creatives: Json[] | null;
  conversions: Json[] | null;
  types: Json[] | null;
  availableSplits: Json | null;
  availableMetrics: Json | null;
  conversionTags: "own" | "dropped" | null;
  dimSources: Json | null;
  thirdParty: Json[];
  mappingsV3: Json[] | null;
  display: Json;
  aggregate: Json;
  capabilities: Json | null;
  metrics: Json | null;
  libraryEntries: Json | null;
  data: Json | null;
  deliveryStats: DeliveryStatsOutput | null;
  notify: NotifyOutput | null;
  journal: JournalEntryOutput[];
}

/* ── the port, function for function ─────────────────────────────────────────────────────────── */

/**
 * `toV1(PacingDashboardData data, String ownPacingUserId, boolean unrestrictedScope)` (113-165).
 *
 * @param raw the body as Pacing serves it
 * @param ctx the caller's own Pacing user id and whether their scope is unfiltered
 * @returns the same object the Hub used to serialise
 */
export function readDashboardWire(raw: PacingDashboardWireV1, ctx: WireContext): PacingDashboardV1 {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new WireError(`expected the dashboard body to be an object, got ${describe(raw)}`);
  }
  const r = raw as unknown as Record<string, unknown>;
  const conversionTags = str(r.conversionTags);
  // 128-130: `ConversionTagsEnum.fromValue` throws on anything outside the enum - a 500 then, an
  // error here (owner decision 2026-10-29 §14.6: softening is a separate decision).
  if (conversionTags !== null && conversionTags !== "own" && conversionTags !== "dropped") {
    throw new WireError(`conversionTags: unexpected value "${conversionTags}"`);
  }
  const out: WireOutput = {
    campaign: toCampaignV1(asObject(r.campaign, "campaign") as WireCampaign | null),
    planByLineItem: toPlanByLineItemV1(asObject(r.planByLineItem, "planByLineItem")),
    factsDaily: asObjectList(r.factsDaily, "factsDaily") ?? [], // 117
    asOf: str(r.asOf), // 118
    // 119-127: the four the moved widget renderer reads, sparse on purpose - absent stays null.
    types: asObjectList(r.types, "types"),
    availableSplits: asObject(r.availableSplits, "availableSplits"),
    availableMetrics: asObject(r.availableMetrics, "availableMetrics"),
    conversionTags,
    // 131-136: null stays null, unlike factsDaily - absent means the pacing does not collect the file.
    creatives: asObjectList(r.creatives, "creatives"),
    conversions: asObjectList(r.conversions, "conversions"),
    dimSources: asObject(r.dimSources, "dimSources"),
    // 137-140: empty, not null, when nothing is configured - a length check must always be safe.
    thirdParty: asObjectList(r.third_party, "third_party") ?? [],
    // 141-145: null stays null - it means "predates the v3 mapping model", not "nothing mapped".
    mappingsV3: asObjectList(r.mappings_v3, "mappings_v3"),
    display: asObject(r.display, "display") ?? {}, // 146
    aggregate: asObject(r.aggregate, "aggregate") ?? {}, // 147
    // 148-159: measurement and configuration namespaces ride through, null staying null.
    capabilities: asObject(r.capabilities, "capabilities"),
    metrics: asObject(r.metrics, "metrics"),
    libraryEntries: asObject(r.libraryEntries, "libraryEntries"),
    data: asObject(r.data, "data"),
    deliveryStats: toDeliveryStatsV1(asObject(r.deliveryStats, "deliveryStats") as WireDeliveryStats | null), // 162
    notify: toNotifyV1(asObject(r.notify, "notify") as WireNotify | null), // 163
    journal: toJournalV1(r.journal, ctx.ownPacingUserId, ctx.unrestricted), // 164
  };
  // `sourceFacts`, `campaign.timezone`, `planByLineItem[].bidCpm` and every other key the Java
  // records did not declare are dropped here by not being read - as Jackson dropped them.
  return out as unknown as PacingDashboardV1;
}

/** `toCampaignV1` (404-427): a null campaign is the empty model - every field null, `links` `[]`. */
export function toCampaignV1(campaign: WireCampaign | null): CampaignOutput {
  if (campaign === null) {
    return {
      slug: null, pacingId: null, name: null, startDate: null, endDate: null, currency: null, rate: null,
      rateLocked: null, nsRate: null, netMode: null, periodScope: null, periodScopeKey: null, status: null,
      orderNumber: null, sourceUrl: null, links: [],
    };
  }
  const c = campaign as Record<string, unknown>;
  return {
    // 408-411: Pacing's `id` is the dash_slug, renamed so the contract never confuses it with the id.
    slug: str(c.id),
    pacingId: str(c.pacingId),
    name: str(c.name),
    startDate: parseDate(c.startDate),
    endDate: parseDate(c.endDate),
    currency: str(c.currency),
    rate: dbl(c.rate),
    rateLocked: bool(c.rateLocked) === true, // 418: Boolean.TRUE.equals
    nsRate: dbl(c.nsRate),
    status: str(c.status),
    orderNumber: str(c.orderNumber),
    sourceUrl: str(c.sourceUrl),
    netMode: bool(c.netMode) === true, // 423
    periodScope: bool(c.periodScope) === true, // 424
    periodScopeKey: str(c.periodScopeKey),
    links: toLinksV1(c.links),
  };
}

/** `toLinksV1` (438-445): null flattens to `[]`; each link is `{name, url}` and nothing else. */
export function toLinksV1(links: unknown): { name: string | null; url: string | null }[] {
  if (links === null || links === undefined) return [];
  if (!Array.isArray(links)) throw new WireError(`campaign.links: expected a list, got ${describe(links)}`);
  return links.map((link) => {
    const l = asObject(link, "campaign.links[]");
    if (l === null) throw new WireError("campaign.links: a null link");
    return { name: str(l.name), url: str(l.url) };
  });
}

/** `toPlanByLineItemV1` (462-469): null → `{}`; keys kept, every value mapped. */
export function toPlanByLineItemV1(planByLineItem: Record<string, unknown> | null): Record<string, PlanOutput> {
  if (planByLineItem === null) return {};
  const out: Record<string, PlanOutput> = {};
  for (const [id, plan] of Object.entries(planByLineItem)) {
    const p = asObject(plan, `planByLineItem.${id}`);
    if (p === null) throw new WireError(`planByLineItem.${id}: a null plan`);
    out[id] = toLineItemPlanV1(p as WirePlan);
  }
  return out;
}

/** `toLineItemPlanV1` (471-510). */
export function toLineItemPlanV1(plan: WirePlan): PlanOutput {
  const p = plan as Record<string, unknown>;
  return {
    lineItemId: str(p.lineItemId),
    channel: str(p.channel),
    dsp: str(p.dsp),
    labels: strList(p.labels) ?? [], // 476
    description: str(p.description),
    rateType: str(p.rateType),
    clientBudget: dbl(p.clientBudget),
    plannedImpressions: dbl(p.plannedImpressions),
    marginTargetPct: dbl(p.marginTargetPct),
    ctrTargetPct: dbl(p.ctrTargetPct),
    vcrTargetPct: dbl(p.vcrTargetPct),
    flightStart: parseDate(p.flightStart), // 484
    flightEnd: parseDate(p.flightEnd), // 485
    // 502-508: the model's own empty list when absent; each interval's two ends parsed as dates.
    pauseIntervals: toPauseIntervalsV1(p.pauseIntervals),
    containers: asObjectList(p.containers, "containers") ?? [], // 486
    dimGroups: asObjectList(p.dimGroups, "dimGroups") ?? [], // 487
    // 496-500: null stays null rather than becoming an empty list - "count every action" is a
    // different statement from "count none".
    primaryConversions: strList(p.primaryConversions),
    storedPrimaryConversions: strList(p.storedPrimaryConversions),
    conversionData: bool(p.conversionData), // 501
    nativeBudget: dbl(p.native_budget), // 488 - snake on the wire
    costCoef: bool(p.cost_coef), // 489 - snake on the wire; the Boolean passes through, null included
    netRatio: dbl(p.netRatio),
    storedNetRatio: dbl(p.storedNetRatio),
    netRatioLocked: bool(p.netRatioLocked) === true, // 492: Boolean.TRUE.equals
    nsNetRatio: dbl(p.nsNetRatio),
    converted: bool(p.converted), // 494: passes through, null included
    currency: str(p.currency),
  };
}

function toPauseIntervalsV1(intervals: unknown): { from: string | null; to: string | null }[] {
  if (intervals === null || intervals === undefined) return [];
  if (!Array.isArray(intervals)) throw new WireError(`pauseIntervals: expected a list, got ${describe(intervals)}`);
  return intervals.map((interval) => {
    const i = asObject(interval, "pauseIntervals[]");
    if (i === null) throw new WireError("pauseIntervals: a null interval");
    return { from: parseDate(i.from), to: parseDate(i.to) };
  });
}

/** `toV1(PacingDeliveryStats)` (212-218), behind the caller's null check (162). */
export function toDeliveryStatsV1(stats: WireDeliveryStats | null): DeliveryStatsOutput | null {
  if (stats === null) return null;
  const s = stats as Record<string, unknown>;
  return {
    rows: int64(s.rows),
    cells: int64(s.cells),
    measuredAt: str(s.measuredAt),
    autoOffAt: str(s.autoOffAt),
  };
}

/** `toV1(PacingNotifySettings)` (227-233), behind the caller's null check (163). */
export function toNotifyV1(settings: WireNotify | null): NotifyOutput | null {
  if (settings === null) return null;
  const s = settings as Record<string, unknown>;
  const metrics = asObject(s.metrics, "notify.metrics");
  return {
    alerts: toAlertsV1(asObject(s.alerts, "notify.alerts") as WireAlerts | null),
    // 230: `settings.metrics() != null && settings.metrics().vcr()` - vcr is a primitive boolean.
    metrics: { vcr: metrics !== null && boolPrim(metrics.vcr) },
    hidePaused: boolPrim(s.hide_paused), // 231: a primitive on the record - absent reads as false
    summaryProjection: summaryProjectionOf(s.summary_projection), // 232
  };
}

/**
 * `toV1(PacingAlertsConfig)` (277-305). `alerts` null, or any of the 13 blocks missing, was an NPE
 * - a 500 - and is an error here (owner decision 2026-10-29 §14.6). Every field on these records is
 * a primitive, so an absent one reads as false / 0.
 */
export function toAlertsV1(alerts: WireAlerts | null): AlertsOutput {
  if (alerts === null) throw new WireError("notify.alerts is missing");
  const a = alerts as Record<string, unknown>;
  const block = (key: string): Record<string, unknown> => {
    const b = asObject(a[key], `notify.alerts.${key}`);
    if (b === null) throw new WireError(`notify.alerts.${key} is missing`);
    return b;
  };
  const base = (b: Record<string, unknown>): RuleBase => ({ enabled: boolPrim(b.enabled), slack: boolPrim(b.slack) });
  const factor = (b: Record<string, unknown>) => ({ ...base(b), factor: dblPrim(b.factor) });
  const bid = block("bid_fact_above_plan");
  const gap = block("data_gap");
  const band = block("pacing_off_pace");
  const margin = block("margin_below_target");
  const spend = block("spend_overspend");
  const stale = block("stale_data");
  const rateCost = block("rate_cost_above_plan");
  return {
    enabled: boolPrim(a.enabled),
    bidFactAbovePlan: { ...base(bid), window: int32(bid.window), thresholdPct: dblPrim(bid.threshold_pct) },
    dataGap: { ...base(gap), gapDays: int32(gap.gap_days) },
    ctrBelowTarget: factor(block("ctr_below_target")),
    vcrBelowTarget: factor(block("vcr_below_target")),
    ctrAboveTarget: factor(block("ctr_above_target")),
    vcrOver100: base(block("vcr_over_100")),
    noImpressionsYet: base(block("no_impressions_yet")),
    pacingOffPace: { ...base(band), low: dblPrim(band.low), high: dblPrim(band.high) },
    marginBelowTarget: { ...base(margin), gapPp: dblPrim(margin.gap_pp) },
    spendOverspend: { ...base(spend), warnPct: dblPrim(spend.warn_pct), badPct: dblPrim(spend.bad_pct) },
    dspForecastOverspend: base(block("dsp_forecast_overspend")),
    staleData: { ...base(stale), days: int32(stale.days) },
    rateCostAbovePlan: { ...base(rateCost), thresholdPct: dblPrim(rateCost.threshold_pct) },
  };
}

/** `toJournalV1` (522-530): null → `[]`; same order. */
export function toJournalV1(journal: unknown, ownPacingUserId: string | null, unrestricted: boolean): JournalEntryOutput[] {
  if (journal === null || journal === undefined) return [];
  if (!Array.isArray(journal)) throw new WireError(`journal: expected a list, got ${describe(journal)}`);
  return journal.map((entry) => {
    const e = asObject(entry, "journal[]");
    if (e === null) throw new WireError("journal: a null entry");
    return toJournalEntryV1(e as WireJournalEntry, ownPacingUserId, unrestricted);
  });
}

/**
 * `toJournalEntryV1` (540-551): `canEdit` is the caller's identity against the entry's author -
 * `unrestrictedScope || (ownPacingUserId != null && ownPacingUserId.equals(entry.userId()))` - and
 * the author id itself is not forwarded. The same two lines still run in Java for the journal
 * WRITE responses (`PacingDashboardContractMapper.toJournalEntryV1`); the parity test keeps them
 * agreeing.
 */
export function toJournalEntryV1(entry: WireJournalEntry, ownPacingUserId: string | null, unrestricted: boolean): JournalEntryOutput {
  const e = entry as Record<string, unknown>;
  const canEdit = unrestricted || (ownPacingUserId !== null && ownPacingUserId === str(e.user_id));
  return {
    id: str(e.id),
    ts: str(e.ts),
    msg: str(e.msg),
    uid: str(e.uid),
    editedAt: str(e.edited_at),
    canEdit,
  };
}
