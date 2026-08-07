import type { MockStatus, PaceState } from "./constants";

/**
 * Adapter output — the shape the mock generators expect, decoupled from the real API DTO. Built from a
 * real campaign via `toPacingCampaign`; `id` is always the real campaign's own id (as a string), so
 * every generator seeded from it is stable per real campaign.
 */
export interface MockCam {
  id: string;
  name: string;
  status: MockStatus;
  start: string;
  end: string;
  budget: number;
  channels: string[];
}

export interface LineItem {
  id: string;
  name: string;
  channel: string;
  /** The real NetSuite rate type (e.g. "CPM", "Flat") - absent (undefined) for a manually-added line
   * item, which has no rate type of its own. */
  rateType?: string;
  start: string;
  end: string;
  budget: number;
  /** The mock's own status vocabulary for a manually-added line item, or a real NetSuite order status
   * string (inherited from its parent order - see InsertionOrder) for a real one. */
  status: MockStatus | string;
  manual: boolean;
}

export interface InsertionOrder {
  id: string;
  name: string;
  channel: string;
  /** Extra media tactics beyond `channel` (IO rollup from NetSuite). Omitted/0 when single or mock. */
  channelMore?: number;
  /** The names of those extra tactics, for a hover tooltip on the "+N" tag. */
  channelExtra?: string[];
  start: string;
  end: string;
  budget: number;
  /** The mock's own status vocabulary for a manually-added order, or the real NetSuite order status
   * string for a real one - see `orderStatusBadge`/`resolveStatusStyle` for the real-string mapping. */
  status: MockStatus | string;
  lis: LineItem[];
  open: boolean;
  manual: boolean;
}

export interface SetupModel {
  ios: InsertionOrder[];
}

export interface DimDef {
  id: string;
  label: string;
  /** Optional explanation shown under the label in the dimension picker, like `MetricDef`'s. Used by
   * the constructed-name levels, whose meaning depends on the row's platform. */
  description?: string;
}

export interface MetricDef {
  id: string;
  label: string;
  /**
   * How the column rolls up over several rows. `WTD` is a rate re-derived from its summed components
   * (total cost over total impressions), never the mean of the rows' own rates - see METRIC_DEFS.
   */
  agg: "SUM" | "AVG" | "WTD";
  description: string;
}


/**
 * Manual IO/LI additions kept in `useCampaignSetup`'s adjustments store (US-012/013) — merged over the
 * base NetSuite-shaped `SetupModel` on read, never mutating it. Setup only supports additions (no field
 * edits yet), so unlike `Adjustments<Row>` there is no `adj` override map: `addedLIs` appends into an
 * existing IO by id, `addedIOs` are whole new IOs (each carrying its own manual LIs, if any).
 */
export interface SetupAdjustments {
  addedIOs: InsertionOrder[];
  addedLIs: Record<string, LineItem[]>;
}

/** Per-campaign pacing overlay, seeded by the real campaign id (`campPacing`). */
export interface Pacing {
  status: MockStatus;
  budget: number;
  marginA: number;
  marginT: number;
  pp: number;
  pace: "on" | "over" | "under";
  li: number;
  /** Formatted like the mockup, e.g. "22d". */
  days: string;
  flight: string;
}

export interface PdInput {
  start: string;
  end: string;
  budget: number;
  pp: number;
  marginA: number | null;
  marginT: number;
}

/** Derived Pacing-tab KPI grid + financial numbers (`pdCompute`). */
export interface PdMetrics {
  flightDays: number;
  dayN: number;
  daysLeftN: number;
  planUnits: number;
  planRate: number;
  planPct: number;
  actualPct: number;
  actualByDay: number;
  expectedByDay: number;
  aboveExpected: number;
  neededTotal: number;
  neededPerDay: number;
  dailyTarget: number;
  actualToday: number;
  aboveDaily: number;
  daySpend: number;
  asOf: string;
  marginDiff: number | null;
}

/**
 * One row of the Overview's campaign table. `status` is the REAL campaign's own status string (not the
 * mock's narrowed `MockStatus`), since only pacing is mocked — the entity data itself is real.
 */
export interface OwnerCampaign {
  id: string;
  name: string;
  agency: string;
  client: string;
  status: string;
  budget: number;
  li: number;
  marginA: number | null;
  marginT: number;
  pp: number | null;
  pace: PaceState;
  flight: string;
  days: string;
}

export interface OverviewSummary {
  campaigns: number;
  lineItems: number;
  budget: number;
}

export interface Overview {
  campaigns: OwnerCampaign[];
  summary: OverviewSummary;
}

/**
 * Adjustments overlay (see 01-MIGRATION-PLAN.md §0b, 02-MOCK-PACING-SPEC.md §5b): every user-added or
 * user-edited row is an adjustment over an otherwise read-only base source. `adj` overrides an existing
 * base row's fields by key; `added` rows have no base match. Wired up by Setup (W3) and Reporting (W4);
 * defined here now so the seam is ready from day one.
 */
export interface Adjustments<Row> {
  adj: Record<string, Partial<Row>>;
  added: Row[];
}

/**
 * Read = base ⊕ adjustments overlay (mirrors the mockup's `displayRows()` exactly). `pass` lets a
 * caller apply the same filter (e.g. a search term) to both the overridden base rows and the added
 * rows in one pass.
 */
export function mergeAdjustments<Row extends { key: string }>(
  base: Row[],
  adjustments: Adjustments<Row>,
  pass: (row: Row) => boolean = () => true
): Row[] {
  const overridden = base.map((row) =>
    adjustments.adj[row.key] ? { ...row, ...adjustments.adj[row.key] } : row
  );
  return overridden.filter(pass).concat(adjustments.added.filter(pass));
}
