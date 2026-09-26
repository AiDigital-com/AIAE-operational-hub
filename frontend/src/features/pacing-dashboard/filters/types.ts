/**
 * The dashboard filter set, verbatim from the retired SPA's `workspace/src/hooks/useUrlFilters.js`
 * (Operational Hub migration, bringing filters back to the browser). Seven filters:
 *
 *   - `range` + `customRange` — the window: `'all'`, an `Nd` quick range (`'7d'`, `'30d'`, …), or
 *     `'custom'` (reads `customRange`).
 *   - `channels`, `labels`, `selection` — line-item-level: narrow which line items are `effLIs`.
 *   - `platforms`, `brk`/`brkf` — fact-row-level: narrow which delivery rows count, not which line
 *     items do. `brk` is the active breakdown dimension a UI picker shows; `brkf` is the list of
 *     active `dim:value` cuts (a dimension can appear with no `brk` selected, e.g. from a journal tag).
 *   - `cols` — visible Daily Performance table columns. Display-only: never read by the metrics
 *     wrapper, only by the table component.
 */
export interface CustomRange {
  from: string;
  to: string;
}

export interface DashboardFilters {
  range: string;
  customRange: CustomRange;
  channels: string[];
  labels: string[];
  platforms: string[];
  selection: string[];
  brk: string;
  brkf: string[];
  /** `null` means "not set in the URL, fall back to the display config's own column choice" -
   *  distinct from `[]`, which is a real "show no extra columns". */
  cols: string[] | null;
}

export const DEFAULT_FILTERS: DashboardFilters = {
  range: "all",
  customRange: { from: "", to: "" },
  channels: [],
  labels: [],
  platforms: [],
  selection: [],
  brk: "",
  brkf: [],
  cols: null,
};
