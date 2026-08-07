import type { ReportRowV1 } from "../../campaigns/types";
import type { DimDef, MetricDef, MockCam } from "./types";

/**
 * Dimension/metric catalogs the Reporting tab's pickers list — a 1:1 mirror of the real
 * `platform_mart_adjustments_view_op_hub` columns (`ReportRowV1`), NOT the mockup's fabricated
 * `DIM_DEFS`/`METRIC_DEFS`: report data itself is real (see `useReportRows`), only pacing stays mocked.
 */
// What each constructed-name level denotes per platform, from the source system's own naming-levels
// table. Shown as the level dimensions' descriptions, since no single label is right for every row.
const LEVEL_1_HINT =
  "Varies by platform: line item (DV360, Xandr, Yahoo, Beeswax), ad set (TTD, Meta, TikTok, LinkedIn), " +
  "campaign (Google Ads, Spotify, Microsoft, Vistar, Viant) or insertion order (Amazon, ADT).";
const LEVEL_2_HINT =
  "Varies by platform: insertion order (DV360, Xandr, Vistar, Viant), campaign (TTD, Meta, TikTok, " +
  "LinkedIn, Yahoo, Beeswax), ad set (Google Ads, Spotify, Microsoft) or line item (Amazon, ADT).";
const LEVEL_3_HINT = "The creative on most platforms; the ad on Google Ads, Spotify, Meta, TikTok and Microsoft.";

/** What the three constructed levels denote on one platform. */
export interface LevelTerms {
  l1: string;
  l2: string;
  l3: string;
}

const LINE_ITEM_FIRST: LevelTerms = { l1: "Line item", l2: "Insertion order", l3: "Creative" };
const CAMPAIGN_FIRST_IO: LevelTerms = { l1: "Campaign", l2: "Insertion order", l3: "Creative" };
const CAMPAIGN_FIRST_AD: LevelTerms = { l1: "Campaign", l2: "Ad set", l3: "Ad" };
const AD_SET_FIRST_AD: LevelTerms = { l1: "Ad set", l2: "Campaign", l3: "Ad" };
const IO_FIRST: LevelTerms = { l1: "Insertion order", l2: "Line item", l3: "Creative" };

/** One row of the source system's naming-levels table: a platform, and what its three levels denote. */
export interface PlatformLevels {
  /** The platform as the naming-levels table names it - a display name, not the mart's code. */
  platform: string;
  /** The `platform` values the mart actually stores for it; usually one, occasionally an alias pair. */
  codes: string[];
  terms: LevelTerms;
}

/**
 * The source system's "Constructed Naming Levels Hint" table, verbatim and in its own order - shown to
 * the user behind the Reporting tab's level help, and the lookup behind {@link resolveLevelTerms}.
 *
 * Platforms absent here (Snapchat, Reddit, Apple Ads, Criteo, Publica and anything new) are
 * deliberately missing rather than guessed: their columns keep the neutral level labels.
 */
export const PLATFORM_LEVELS: PlatformLevels[] = [
  // Two DV360 instances share one hierarchy.
  { platform: "DV360", codes: ["dv_360_dlv", "dv_360_jellyfish"], terms: LINE_ITEM_FIRST },
  { platform: "TTD", codes: ["TTD"], terms: { l1: "Ad set", l2: "Campaign", l3: "Creative" } },
  { platform: "Spotify", codes: ["Spotify"], terms: CAMPAIGN_FIRST_AD },
  { platform: "Google Ads", codes: ["Google Ads"], terms: CAMPAIGN_FIRST_AD },
  { platform: "Vistar", codes: ["Vistar"], terms: CAMPAIGN_FIRST_IO },
  { platform: "Viant", codes: ["Viant"], terms: CAMPAIGN_FIRST_IO },
  // "Facebook" is the live Meta code in the mart; the bare "Meta" code is legacy but still present.
  { platform: "Meta", codes: ["Facebook", "Meta"], terms: AD_SET_FIRST_AD },
  // "Adtelligent" is the mart's code for the platform the naming-levels table calls ADT.
  { platform: "ADT", codes: ["Adtelligent"], terms: IO_FIRST },
  { platform: "Amazon", codes: ["Amazon"], terms: IO_FIRST },
  { platform: "TikTok", codes: ["TikTok"], terms: AD_SET_FIRST_AD },
  { platform: "Xandr", codes: ["Xandr"], terms: LINE_ITEM_FIRST },
  // Yahoo and Beeswax call level 2 the campaign, but it lands in the mart as the insertion order.
  { platform: "Yahoo", codes: ["Yahoo"], terms: LINE_ITEM_FIRST },
  { platform: "Beeswax", codes: ["Beeswax"], terms: LINE_ITEM_FIRST },
  { platform: "Microsoft", codes: ["Microsoft"], terms: CAMPAIGN_FIRST_AD },
  { platform: "LinkedIn", codes: ["LinkedIn"], terms: { l1: "Ad set", l2: "Campaign", l3: "Creative" } },
];

/**
 * Mart `platform` value to what its constructed levels mean - {@link PLATFORM_LEVELS} indexed by the
 * codes the data actually carries, so the table above stays the one place a platform is described.
 */
export const PLATFORM_LEVEL_TERMS: Record<string, LevelTerms> = Object.fromEntries(
  PLATFORM_LEVELS.flatMap((row) => row.codes.map((code) => [code, row.terms]))
);

/**
 * The column header for a dimension: the platform's own word for that level once the rows in view
 * agree on one platform ("Line item id"), otherwise the neutral level label ("Constructed id L1").
 *
 * @param dimId    the dimension id
 * @param fallback the dimension's neutral label
 * @param terms    the resolved level terms, or `null` when the rows span platforms that disagree
 * @return the label to render in the column header
 */
export function levelDimLabel(dimId: string, fallback: string, terms: LevelTerms | null): string {
  const level = dimLevel(dimId);
  if (level == null || terms == null) return fallback;
  return `${terms[level]} ${dimId.endsWith("_id") ? "id" : "name"}`;
}

/**
 * The columns `platform_mart_adjustments_view_op_hub` matches an adjustment row back to its base row
 * by - `date, platform, account, account_id` plus all six constructed name/id columns - and therefore
 * the dimensions a report must be showing before its rows can be edited at all. A grouped read only
 * selects the dimensions it groups by and leaves the rest null, so an adjustment built from a grouped
 * row would carry a null in the join key and land nowhere.
 *
 * The three `constructed_name*` columns are in the key even though the view stopped joining on them
 * for delivery dates from 2026-03-03 onward: they still join older rows, and a manually added row's
 * whole CNB_* breakdown is `SPLIT(constructed_name, '_')` - the name is the only thing carrying it.
 */
export const ADJUSTMENT_KEY_DIM_IDS = [
  "date",
  "platform",
  "account",
  "account_id",
  "line_item_name",
  "line_item_id",
  "insertion_order_name",
  "insertion_order_id",
  "campaign_constructed_name",
  "campaign_constructed_id",
] as const satisfies ReadonlyArray<keyof ReportRowV1>;

/**
 * Every non-metric field an adjustment write carries - the key above plus the CNB_* breakdown.
 *
 * The CNB_* half is written but never read back: the view's `unified_adjustments` CTE does not select
 * those columns at all, taking them from `platform_mart` for a matched row and from
 * `SPLIT(constructed_name, '_')` for an added one. They are still sent so the write table stays a
 * faithful record of what the user saw, and because leaving a stored column silently unset is worse
 * than writing it; nothing downstream depends on them.
 *
 * Deliberately excludes `client`/`campaign_name` (campaign identity, stamped server-side from the
 * resolved campaign), the read-only display columns (`rate_type`, `line_item_description`,
 * `adjusted_metrics`) and the audit stamps - none of them are part of what an adjustment writes.
 */
export const ADJUSTMENT_WRITE_DIM_IDS = [
  ...ADJUSTMENT_KEY_DIM_IDS,
  "agency_id",
  "industry_code",
  "channel",
  "tactic",
  "buying_model",
  "audience",
  "unique_line_item_id",
  "other",
  "geo",
  "creative_tag",
  "message",
  "keyword_group",
  "flight_identifier",
  "language",
] as const satisfies ReadonlyArray<keyof ReportRowV1>;

/**
 * The sixteen underscore-separated segments of a level-1 constructed name, in the order the view
 * splits them out - `SPLIT(constructed_name, '_')[SAFE_OFFSET(0..15)]`.
 *
 * This is the naming convention itself: a constructed name *is* these fields joined by `_`, which is
 * why the view can reconstruct a manually added row's whole CNB_* breakdown from the name alone.
 */
export const CONSTRUCTED_NAME_PART_IDS = [
  "agency_id",
  "client",
  "industry_code",
  "campaign_name",
  "channel",
  "tactic",
  "buying_model",
  "audience",
  "unique_line_item_id",
  "other",
  "geo",
  "creative_tag",
  "message",
  "keyword_group",
  "flight_identifier",
  "language",
] as const satisfies ReadonlyArray<keyof ReportRowV1>;

/**
 * Splits a constructed name into the CNB_* fields the view will derive from it, so a manually added
 * row shows the same breakdown once saved that it shows while being typed.
 *
 * Deliberately mirrors `SAFE_OFFSET`: a name with fewer than sixteen segments leaves the rest blank
 * rather than failing, and a name with more silently drops the extras - exactly what BigQuery does.
 *
 * @param constructedName the level-1 constructed name, or `undefined` on a blank new row
 * @return each CNB_* field's value, keyed by dimension id
 */
export function constructedNameParts(constructedName: string | undefined): Record<string, string> {
  const segments = (constructedName ?? "").split("_");
  return Object.fromEntries(CONSTRUCTED_NAME_PART_IDS.map((id, index) => [id, segments[index] ?? ""]));
}

/**
 * The leading segments of a constructed name that a new line in this campaign already knows - agency,
 * client, industry code and campaign name - joined and left open for the user to continue typing.
 *
 * Stops at the first segment the campaign's rows do not agree on, since a name is positional: guessing
 * one segment wrong would shift nothing, but skipping one would shift every segment after it.
 *
 * @param rows the report rows currently loaded
 * @return the prefix to seed a new line's constructed name with, `""` when nothing is agreed
 */
export function inheritedNamePrefix(rows: ReportRowV1[]): string {
  const inherited = inheritedDimValues(rows);
  const prefix: string[] = [];
  for (const id of CONSTRUCTED_NAME_PART_IDS) {
    const value = inherited[id];
    if (value == null) break;
    prefix.push(value);
  }
  return prefix.length === 0 ? "" : `${prefix.join("_")}_`;
}

/**
 * Dimensions that describe the agency/client a report belongs to rather than one delivery row, so a
 * manually added line must inherit them from the campaign's existing rows instead of asking the user
 * to retype them. `account`/`account_id` are the DSP account, which differs per platform, so they are
 * only inherited when the rows in view actually agree (see `inheritedDimValues`).
 */
export const INHERITED_DIM_IDS = [
  "account",
  "account_id",
  "agency_id",
  "client",
  "industry_code",
  "campaign_name",
] as const;

/**
 * The agency/client-scoped values a new line should inherit: for each {@link INHERITED_DIM_IDS} field,
 * the single value every row shares, omitting any field the rows disagree on (or leave blank) so a new
 * line is never locked to an arbitrary one of several values.
 *
 * @param rows the report rows currently loaded
 * @return the values to pre-fill, keyed by dimension id
 */
export function inheritedDimValues(rows: ReportRowV1[]): Partial<Record<string, string>> {
  const inherited: Record<string, string> = {};
  for (const id of INHERITED_DIM_IDS) {
    const values = new Set<string>();
    for (const row of rows) {
      const value = row[id as keyof ReportRowV1];
      if (value != null && String(value) !== "") values.add(String(value));
      if (values.size > 1) break;
    }
    if (values.size === 1) inherited[id] = [...values][0];
  }
  return inherited;
}

/** Which constructed level a dimension reads, or `null` for every other dimension. */
export function dimLevel(dimId: string): keyof LevelTerms | null {
  if (dimId === "line_item_name" || dimId === "line_item_id") return "l1";
  if (dimId === "insertion_order_name" || dimId === "insertion_order_id") return "l2";
  if (dimId === "campaign_constructed_name" || dimId === "campaign_constructed_id") return "l3";
  return null;
}

/**
 * Resolves what the constructed levels mean for a set of rows, or `null` when they cannot mean one
 * thing. Resolves whenever every platform present agrees - so DV360's two instances, or a mix of
 * Vistar and Viant, still resolve - and gives up as soon as one platform is unmapped or disagrees.
 *
 * @param platforms the distinct `platform` values in view
 * @return the shared level terms, or `null` when ambiguous
 */
export function resolveLevelTerms(platforms: string[]): LevelTerms | null {
  if (platforms.length === 0) return null;
  let resolved: LevelTerms | null = null;
  for (const platform of platforms) {
    const terms = PLATFORM_LEVEL_TERMS[platform];
    if (!terms) return null;
    if (resolved && (resolved.l1 !== terms.l1 || resolved.l2 !== terms.l2 || resolved.l3 !== terms.l3)) {
      return null;
    }
    resolved = terms;
  }
  return resolved;
}

export const DIM_DEFS: DimDef[] = [
  { id: "date", label: "Date" },
  { id: "platform", label: "Platform" },
  { id: "account", label: "Account" },
  { id: "account_id", label: "Account id" },
  // The three constructed-name levels have NO fixed meaning: what each level denotes depends on the
  // row's own `platform`, per the source system's own naming-levels table. On DV360 the levels are
  // line item / insertion order / creative, but on Google Ads they are campaign / ad set / ad, and on
  // Amazon insertion order / line item / creative. So these are labeled by level and the per-platform
  // reading is left to the description; naming any one platform's hierarchy here would be wrong for
  // every other platform. (The ids still say "line_item"/"insertion_order"/"campaign_constructed"
  // from that earlier assumption - renaming them would break saved report views, which persist these
  // ids, and the bulk-adjustment template, which parses them back from its own headers.)
  { id: "line_item_name", label: "Constructed name L1", description: LEVEL_1_HINT },
  { id: "line_item_id", label: "Constructed id L1", description: LEVEL_1_HINT },
  { id: "insertion_order_name", label: "Constructed name L2", description: LEVEL_2_HINT },
  { id: "insertion_order_id", label: "Constructed id L2", description: LEVEL_2_HINT },
  { id: "campaign_constructed_name", label: "Constructed name L3", description: LEVEL_3_HINT },
  { id: "campaign_constructed_id", label: "Constructed id L3", description: LEVEL_3_HINT },
  { id: "agency_id", label: "Agency id" },
  { id: "client", label: "Client" },
  { id: "industry_code", label: "Industry code" },
  { id: "campaign_name", label: "Campaign" },
  { id: "channel", label: "Channel" },
  { id: "tactic", label: "Tactic" },
  { id: "buying_model", label: "Buying model" },
  { id: "audience", label: "Audience" },
  { id: "unique_line_item_id", label: "Unique line item id" },
  { id: "other", label: "Other" },
  { id: "geo", label: "Geo" },
  { id: "creative_tag", label: "Creative tag" },
  { id: "message", label: "Message" },
  { id: "keyword_group", label: "Keyword group" },
  { id: "flight_identifier", label: "Flight identifier" },
  { id: "language", label: "Language" },
  { id: "adjusted_metrics", label: "Adjusted metrics" },
  { id: "rate_type", label: "Rate type" },
  { id: "line_item_description", label: "Description" },
  { id: "created_at", label: "Created at" },
  { id: "created_by", label: "Created by" },
  { id: "last_modified_at", label: "Last modified at" },
  { id: "last_modified_by", label: "Last modified by" },
];

export const METRIC_DEFS: MetricDef[] = [
  { id: "impressions", label: "Impressions", agg: "SUM", description: "Total ad impressions delivered." },
  { id: "clicks", label: "Clicks", agg: "SUM", description: "Total clicks recorded on the ad." },
  {
    id: "spend",
    label: "Client Cost",
    agg: "SUM",
    description: "Client billable cost from the rate card; not the DSP media cost.",
  },
  { id: "starts", label: "Starts", agg: "SUM", description: "Total video/creative plays started." },
  { id: "first_quartiles", label: "First quartiles", agg: "SUM", description: "Plays that reached the first quartile." },
  { id: "midpoints", label: "Midpoints", agg: "SUM", description: "Plays that reached the midpoint." },
  { id: "third_quartiles", label: "Third quartiles", agg: "SUM", description: "Plays that reached the third quartile." },
  { id: "completes", label: "Completions", agg: "SUM", description: "Plays that reached full completion." },
  { id: "conversions", label: "Conversions", agg: "SUM", description: "Total tracked conversions." },
  {
    id: "post_click_conversions",
    label: "Post-click conversions",
    agg: "SUM",
    description: "Conversions attributed after a click.",
  },
  {
    id: "post_view_conversions",
    label: "Post-view conversions",
    agg: "SUM",
    description: "Conversions attributed after a view, without a click.",
  },
  { id: "dynamic_cost", label: "Dynamic cost", agg: "SUM", description: "Cost billed at the dynamic (variable) rate." },
  { id: "link_clicks", label: "Link clicks", agg: "SUM", description: "Clicks that led to an outbound link." },
  // The five ratios below are WTD, not AVG, and the distinction is the whole reason the badge exists.
  // Over several rows they are re-derived from summed components - total cost over total impressions -
  // never averaged across the rows' own ratios. Averaging them would let a line that served a hundred
  // impressions weigh as much as one that served ten million, and it is not a rounding difference: six
  // rows whose weighted CPM is $1.45 average out to $1.638. Labelling that "AVG" invited exactly the
  // wrong reproduction in Excel.
  {
    id: "cpm",
    label: "Client CPM",
    agg: "WTD",
    description:
      "Client billable cost per 1,000 impressions; not the DSP CPM. Weighted: total client cost / total impressions * 1000.",
  },
  { id: "cpc", label: "CPC", agg: "WTD", description: "Cost per click. Weighted: total spend / total clicks." },
  {
    id: "cpv",
    label: "CPV",
    agg: "WTD",
    // Starts, not completes: the same denominator the source view's own CPV rate uses.
    description: "Cost per view - a view is a start. Weighted: total spend / total starts.",
  },
  {
    id: "ivt",
    label: "IVT",
    agg: "SUM",
    description:
      "Modelled invalid impressions at a ~5% benchmark - not measured. Blank on channels that publish " +
      "their own figure (Meta, TikTok, search) or have no click to reason from (CTV, DOOH, Live Sports).",
  },
  {
    id: "avcr",
    label: "AVCR",
    agg: "WTD",
    description: "Video completion rate. Weighted: total completions / total impressions.",
  },
  {
    id: "ctr",
    label: "CTR",
    agg: "WTD",
    description: "Click-through rate. Weighted: total clicks / total impressions.",
  },
  {
    id: "dynamic_rate",
    label: "Dynamic rate",
    agg: "WTD",
    description: "The variable rate applied to dynamic cost. Weighted: total dynamic cost / total billable units.",
  },
  {
    id: "avg_dynamic_rate_by_date_tactic",
    label: "Avg dynamic rate (by date/tactic)",
    agg: "AVG",
    description: "Dynamic rate averaged per date and tactic.",
  },
];

/**
 * A new report opens at the raw grain - the view's own adjustment key, nothing more - so it shows one
 * row per source row and "Edit data" is available straight away. Anything narrower would open
 * pre-aggregated (the dimensions are the grouping key) and refuse edits until the user widened it back.
 */
export const DEFAULT_DIMS = [...ADJUSTMENT_KEY_DIM_IDS];
export const DEFAULT_METRICS = ["impressions", "clicks", "spend", "cpm", "avcr", "ctr"];

const MONEY = new Set(["spend", "dynamic_cost", "dynamic_rate", "avg_dynamic_rate_by_date_tactic", "cpm", "cpc", "cpv"]);
const PERCENT = new Set(["avcr", "ctr"]);
const DECIMAL = new Set(["conversions", "post_click_conversions", "post_view_conversions", "ivt"]);

/**
 * One row's metric, formatted for the table - "—" where the row has no such metric.
 *
 * <p>Every value, ratios included, is read off the row the server sent. The ratios used to be derived
 * here from spend and impressions, which was a second definition of CPM in a second language, and it
 * disagreed with the first: the real ones are built on `dynamic_cost` with Added Value free, and each is
 * gated to the channels it means anything on. Reproducing that here would mean copying the tool's
 * channel lists into TypeScript and keeping them in step forever.
 *
 * <p>A `null` ratio is not a zero. A line that spent money on a search channel has no CPM at all, and a
 * line that got no clicks has no CPC - both read "—", the same as the blank cell in the export.
 *
 * @param row the row to read
 * @param id the metric id
 * @returns the formatted cell text
 */
export function rowMetricCell(row: ReportRowV1, id: string): string {
  const value = row[id as keyof ReportRowV1];
  return value == null ? "—" : fmtMetric(id, Number(value));
}

export function fmtMetric(id: string, value: number): string {
  if (MONEY.has(id)) return "$" + value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (PERCENT.has(id)) return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%";
  if (DECIMAL.has(id)) return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return Math.round(value).toLocaleString("en-US");
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/** The BQ table a dashboard data source (W5) would read from, ported verbatim from the mockup. */
export function bqName(cam: MockCam, reportType: string): string {
  return `silken-quasar-376417.gs_templates.${slug(cam.name)}_report_${reportType}`;
}
