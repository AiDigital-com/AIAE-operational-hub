/**
 * The shape of `PacingDashboardV1.metrics` — what Pacing computed for this pacing.
 *
 * Every figure a widget shows is in here, already worked out. Nothing in this
 * feature recomputes any of it, and that is deliberate rather than lazy: the
 * arithmetic behind these numbers is one engine, in Pacing
 * (shared/dashboard-metrics.js), and margin in particular is applied there and
 * nowhere else — applying it a second time on this side inflates money, which
 * the migration plan calls out by name. A front end that derives its own
 * version of a figure is a front end that will eventually disagree with the
 * service about how much a campaign earned.
 *
 * So these types describe a payload to read, not a model to compute with. The
 * fields are loose on purpose: the widget grammar belongs to Pacing's own
 * engine, and pinning every key here would mean editing this file every time a
 * widget template gains one.
 */

/** A resolved binding: what `{ metric: "margin" }` or `{ expr: "sp / im" }` came to. */
export interface BoundValue {
  value: number | null;
  /** What the figure is measured against, when the metric has a target at all. */
  target?: number | null;
  /** True when lower is better — an overspending CPM is bad news, a high VCR is good. */
  invert?: boolean;
  /** The caption Pacing pairs with this reading, e.g. "vs target". */
  sub?: string | null;
}

/** One line of a detail card: a formatted figure, its unit, and an optional note. */
export interface DetailLine {
  value: string;
  unit: string | null;
  note: string | null;
  /** Set when the line is an explanation rather than a figure ("Clicks plan not set"). */
  muted?: boolean;
}

/** What a detailCard's `source` resolved to. */
export interface DetailSource {
  lines: DetailLine[];
  sub: string | null;
  /** Set on the sources that carry a judgement of their own, e.g. "opRead". */
  status?: "g" | "w" | "b";
}

/** One calendar day of the window. Carries the flow fields, the expected curve and
 *  the rates — a chart picks the field its series names. */
export interface SeriesRow {
  date: string;
  [field: string]: string | number | null | undefined;
}

/** One day of one line item, as Pacing's buildRows emits it. */
export interface DailyMetricRow {
  date: string;
  liId: string;
  /** The line item id as a label, e.g. "LI 599904". */
  rawId: string;
  channel: string;
  /** False for a line item with no completion goal — a banner has no completion
   *  rate, and showing 0% would read as one that is failing. */
  vcrEligible: boolean;
  im: number;
  cl: number;
  co: number;
  sp: number;
  dc: number;
  ctr: number;
  vcr: number;
  cpm: number;
}

export interface PacingMetricsBag {
  /** The latest date carrying facts; null on a pacing with no delivery. */
  asOf: string | null;
  /** ~90 campaign-level figures (campM): delivery, spend, margin, pace, the
   *  impressions/clicks/views splits, the rate-type bid tables. */
  campaign: Record<string, unknown>;
  /** The flat scope a widget's `expr` binding was evaluated against. Present so a
   *  reader can see what a figure was built from — not for recomputing it. */
  scalars: Record<string, number>;
  /** One row per day of the window. */
  series: SeriesRow[];
  /** One row per day per line item, for the Daily Performance table (§7). Folded
   *  from the dimension splits and clipped to each line item's own flight, so these
   *  rows add up to `campaign` rather than to a larger figure. */
  daily: DailyMetricRow[];
  /** Detail-card sources, keyed by the `source` string a brick names. */
  sources: Record<string, DetailSource | null>;
  /** The composite readings: how far into the flight we are, the one-word verdict
   *  and why, margin's tone, and the per-unit delivery bars. Each is a judgement
   *  Pacing made, kept out of this side so two screens cannot word one delta two
   *  ways. Shapes are `unknown` here and narrowed at the single point that reads
   *  each — the payload's grammar is Pacing's, not this feature's. */
  readings: Record<string, unknown>;
  /** Resolved bindings, keyed by the binding's own JSON. Null when the binding
   *  could not be resolved — an unknown metric or a malformed expression — which
   *  must render as "misconfigured", never as zero. */
  bound: Record<string, BoundValue | null>;
  /** Per-line-item container readings (§10's display half). Absent, or an empty
   *  object, on a pacing whose line items carry no containers. */
  containers?: Record<string, ContainerReading[]>;
}

/** How far a container or one of its children is through its own target. */
export interface SplitProgress {
  /** Units still to deliver against this target; 0 once it is met. */
  remaining: number;
  /** Days left in this window, counting today as already elapsed. */
  daysLeft: number;
  /** What the remaining days would each have to deliver. */
  neededPerDay: number;
  state: "not_started" | "active" | "ended";
}

/** A split's realized margin against the target it inherits (child → container → plan). */
export interface SplitMargin {
  /** The target this split is measured against, after inheritance. */
  effM: number;
  /** Realized margin, or null when nothing has delivered yet — which is NOT 0%. */
  marginActual: number | null;
  hasMargin: boolean;
  /** Pacing's own verdict: `g` good, `w` watch, `b` bad. Null without delivery. */
  status: "g" | "w" | "b" | null;
}

/** One child of a container: a date split (WHEN its units land) or a sub-breakdown
 *  (WHAT they are). Both carry their own target, pace and margin. */
export interface ContainerChildReading {
  id: string | null;
  kind: "date" | "dim";
  /** "Audience: Sports fans" for a sub-breakdown; a date split's own name, or null. */
  label: string | null;
  dimKey: string | null;
  dimValue: string | null;
  fs: string | null;
  fe: string | null;
  /** Already resolved: a percent-mode sub-breakdown is a share of its parent's
   *  units, and Pacing resolved that before sending. Never re-derive it here. */
  target: number;
  actual: number;
  spend: number;
  clientCost: number;
  progress: SplitProgress;
  margin: SplitMargin;
}

export interface ContainerReading {
  id: string | null;
  name: string | null;
  fs: string | null;
  fe: string | null;
  target: number;
  actual: number;
  spend: number;
  clientCost: number;
  progress: SplitProgress;
  margin: SplitMargin;
  dateChildren: ContainerChildReading[];
  dimChildren: ContainerChildReading[];
}
