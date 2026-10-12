import { useMemo, useState, type ComponentType } from "react";
import type { PacingSheetDimColumn, PacingSheetDimSource } from "./types";
// What the moved editors read as "runtime": a row COUNT, an unrouted {names, rows} pair, and a status
// that merges in-flight with last-read-failed. The dashboard payload carries none of it - its `rows`
// is the row array - so the raw envelope printed "NaN rows read".
import { buildDimCounts, buildDimRuntime } from "./spa/dim-runtime.js";
// "This source covers 89% of pacing impressions" - the one line that answers "is this file actually
// about this pacing". Moved rather than re-derived: it is measured over the days each line item was
// running, and a simpler ratio would flatter a source that stops early.
import { dimSourceCoverage } from "./spa/dim-source-coverage.js";
// Three screens, all MOVED from the retired SPA rather than rewritten: connecting a sheet, showing
// what one last read, and mapping its columns are the reference's own, and a second version of them
// would be a second set of words for the same states - and a second opinion about what a mapping
// means. They are plain JS with no prop types, so they are typed at this one boundary.
import AdditionalMappingEditorJs from "./spa/AdditionalMappingEditor.jsx";
import DimSourceFlowJs, {
  DimSourceBlock as DimSourceBlockJs,
  SourceTypeFlow as SourceTypeFlowJs,
} from "./spa/DimSourceEditor.jsx";
// The third kind: a tab that BECOMES the delivery of a line item, instead of BigQuery. Moved whole,
// like the others - its tab picker, column roles and line-item routing are the reference's.
import PerformanceSourceEditorJs from "./spa/perf/index.jsx";
import "./additional-mapping.css";
import "./performance-source.css";
import "./sheet-source-panel.css";

/** A tab that replaces delivery. Typed at this one boundary, like its neighbours. */
const PerformanceSourceEditor = PerformanceSourceEditorJs as unknown as ComponentType<{
  sheet: Record<string, unknown> | null;
  onChange: (next: Record<string, unknown> | null) => void;
  slug: string;
  lineItems: ReadonlyArray<{ id: string; label: string }>;
  probe?: unknown;
  probing?: boolean;
  /** A SENTENCE, already resolved - the editor prints it as it stands. (It was typed as a function
   *  here; the reference passes `sheetProbeMessage`, a string or null.) */
  probeErrorText?: string | null;
  onRetryProbe?: (() => void) | null;
  onAddLineItem?: (() => void) | null;
  initialTab?: unknown;
}>;

/** The bound performance spreadsheet, in the same list as the other sources.
 *
 *  Its wording is the reference's, and the difference from an additional-data source is the point:
 *  there is no "re-read now" here, because these rows are not read on their own - they REPLACE
 *  BigQuery for the line items their tabs name, and that happens on the next delivery refresh. */
function PerfSourceRow({
  sheet, probe, onOpen, onRemove,
}: {
  sheet: Record<string, unknown>;
  probe: Record<string, unknown> | null;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const id = String(sheet.spreadsheet_id ?? "");
  const tabs = Array.isArray(sheet.tabs) ? sheet.tabs : [];
  const probed = Array.isArray(probe?.tabs) ? (probe?.tabs as unknown[]).length : null;
  const title = (probe?.title as string) || id;
  const counts = tabs.length === 0
    ? "No tab feeds delivery yet"
    : `${tabs.length}${probed != null ? ` of ${probed}` : ""} ${tabs.length === 1 && probed == null ? "tab" : "tabs"} mapped`;

  return (
    <div className="ss-card">
      <div className="ss-card-head">
        <span className="ss-tag">SHEET</span>
        <span className="ss-card-title">{title}</span>
        <span className="ss-card-actions">
          {id && (
            <a
              className="ss-link"
              href={`https://docs.google.com/spreadsheets/d/${id}/edit`}
              target="_blank"
              rel="noreferrer"
            >
              Open sheet
            </a>
          )}
          <button type="button" className="ss-link" onClick={onOpen}>Edit mapping</button>
          <button
            type="button"
            className="ss-link ss-link-quiet"
            onClick={() => (confirming ? onRemove() : setConfirming(true))}
          >
            {confirming ? "Remove?" : "Remove"}
          </button>
        </span>
      </div>
      <div className="ss-card-status">
        <span className={tabs.length ? "ss-ok" : "ss-warn"}>{counts}</span>
        {tabs.length > 0 && <span className="ss-muted"> · applies at the next refresh</span>}
      </div>
    </div>
  );
}

/** Binds a spreadsheet to this pacing. The per-tab mapping is a separate screen, as the reference
 *  has it: this answers "which file", and the editor behind it answers "which tabs, for whom". */
function PerfConnectForm({
  onConnect, onDone,
}: {
  onConnect?: (url: string) => Promise<{ ok: boolean; message?: string }>;
  onDone: () => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!onConnect) return;
    setBusy(true);
    setError(null);
    const r = await onConnect(url);
    setBusy(false);
    if (r?.ok) {
      // Stay here: the editor takes over the moment a spreadsheet is bound, which is the next thing
      // the person wants - naming the tab that feeds a line item.
      setUrl("");
      return;
    }
    setError(r?.message || "Could not read that spreadsheet. Try again in a moment.");
  }

  return (
    <div className="ss-wrap">
      <h3 className="ss-h">Google Sheet — replaces delivery</h3>
      <div className="ss-row">
        <input
          className="ss-input"
          value={url}
          placeholder="Paste a Google Sheets link…"
          disabled={busy}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button type="button" className="ss-btn" disabled={busy || !url.trim()} onClick={submit}>
          {busy ? "Connecting…" : "Connect"}
        </button>
      </div>
      <p className="ss-lead">
        Bind a tab to a line item and its rows replace BigQuery delivery for that line item. Other
        line items keep their BigQuery data.
      </p>
      {error && <p className="ss-error">{error}</p>}
      <button type="button" className="ss-back" onClick={onDone}>Cancel</button>
    </div>
  );
}

/** Which kind of source is being added - the reference's one question with three answers. */
const SourceTypeFlow = SourceTypeFlowJs as unknown as ComponentType<{
  sheetTaken: boolean;
  onPick: (kind: "cm360" | "sheet" | "dim-sheet") => void;
  onCancel: () => void;
}>;

/** Pasting a link and choosing the tab to read. */
const DimSourceFlow = DimSourceFlowJs as unknown as ComponentType<{
  slug: string;
  sources: PacingSheetDimSource[];
  onAdd: (next: PacingSheetDimSource) => void;
  onCancel: () => void;
}>;

/** One connected source: what it last read, and what can be done to it. */
const DimSourceBlock = DimSourceBlockJs as unknown as ComponentType<{
  source: PacingSheetDimSource;
  slug: string;
  runtime: unknown;
  coverage?: unknown;
  saved: PacingSheetDimSource | null;
  widgets?: unknown;
  onRemove: () => void;
  onGoToMapping?: () => void;
  onRead?: ((id: string, entry: unknown) => void) | null;
}>;

/** Column roles, line-item routing and value libraries - one screen, as the reference has it.
 *
 *  Everything it reads about a READ source (`rows`, `bound`, `unbound`, `profile`) is whatever the
 *  dashboard payload published for it, so those stay `unknown`: this file hands them over, it does
 *  not interpret them. */
const AdditionalMappingEditor = AdditionalMappingEditorJs as unknown as ComponentType<{
  source: PacingSheetDimSource;
  savedSource: PacingSheetDimSource | null;
  slug: string;
  lineItems: ReadonlyArray<{ id: string; label: string }>;
  rows?: unknown;
  bound?: unknown;
  unbound?: unknown;
  profile?: unknown;
  runtime: unknown;
  saved: boolean;
  widgets?: unknown;
  initialView?: string;
  onChange: (next: PacingSheetDimSource) => void;
  // (source, dim) - the editor's own order, and `dim` is the COLUMN ENTRY, not its key. Both call
  // sites inside it pass the pair that way; a `(dim, source)` signature here type-checks and then
  // hands a source object to anything reading `dim.label`.
  onOpenBreakdown?: (source: PacingSheetDimSource, dim: PacingSheetDimColumn) => void;
  onCreateWidget?: (source: PacingSheetDimSource, dim: PacingSheetDimColumn) => void;
  onRemoveWidgetsForDim?: (dimKey: string) => void;
  onRestoreWidgetsForDim?: (snapshot: unknown) => void;
  onAddLineItem?: (() => void) | null;
}>;

/** One stored source's read status, as `merge.mjs` publishes it beside the dashboard. */
export interface LoadedDimSource {
  rows?: unknown;
  file_bytes?: unknown;
  fetched_at?: unknown;
  coverage_hint?: unknown;
  status?: unknown;
  error?: unknown;
  unbound?: unknown;
  bound?: unknown;
  /** What every column of the tab HOLDS, from the read that produced these rows. The columns nobody
   *  imported have no rows of their own, so this is the only evidence the screen can show for them. */
  column_profile?: unknown;
}

export interface SheetSourcesProps {
  slug: string;
  /** The pacing's sheet-backed sources, in stored order. Catalogue entries are not passed in and are
   *  not this editor's business - the caller puts the two halves back together on save. */
  sources: PacingSheetDimSource[];
  /** The sources as they are STORED. The block greys the actions that need a read: re-reading a
   *  sheet for a mapping nobody saved yet reads it with the OLD mapping and reports success. */
  stored?: PacingSheetDimSource[];
  /** What each source last read, keyed by source id, straight off the dashboard payload. */
  loaded: Record<string, LoadedDimSource>;
  /** This pacing's line items, for binding sheet names to.
   *
   *  Empty is a real state: a pacing whose line items are not set up yet still opens this screen,
   *  and the routing step then offers nothing to route to rather than failing to render. */
  lineItems?: ReadonlyArray<{ id: string; label: string; fs?: string | null; fe?: string | null }>;
  /** This pacing's widgets, so a breakdown says what uses it before being renamed or removed. */
  widgets?: unknown;
  /** Delivery per line item per day, for the coverage line under each source. */
  liDaily?: Record<string, unknown> | null;
  /** Called after a source was re-read, so the host can refetch the figures that just changed. */
  onRead?: () => void;
  /** Opens a breakdown on the dashboard behind the drawer. */
  onOpenBreakdown?: (source: PacingSheetDimSource, dim: PacingSheetDimColumn) => void;
  /** Mints the table a high-cardinality breakdown needs - 7,616 apps is not a donut. */
  onCreateWidget?: (source: PacingSheetDimSource, dim: PacingSheetDimColumn) => void;
  /** Open straight on one source's mapping, with no list of its own.
   *
   *  That is how the Mapping tab uses this: the list there is the CARD list, and this component is
   *  only the editor behind one of them. Absent, it keeps its own list - which is what the Data tab
   *  wants, where the sources are connected. */
  openIndex?: number | null;
  /** Opens straight on one screen instead of the list. Mapping uses `"perf"`: the performance sheet
   *  has its own section there, so the list in between would be a click asking a settled question. */
  initialView?: "perf";
  /** Starts the CM360 flow, which this panel does not own - the chooser offers all three kinds
   *  together because that is the question being asked, and hands the answer back. */
  onAddCm360?: () => void;
  /** The sheet that replaces delivery, as the drawer currently has it, and what to do when it
   *  changes. Null means none is bound; the chooser's second answer opens its editor. */
  perfSheet?: Record<string, unknown> | null;
  onPerfSheetChange?: (next: Record<string, unknown> | null) => void;
  /** What the spreadsheet itself holds. Without it the editor has no tab list to offer and says the
   *  file has not been read - which is what it said here until the probe was threaded through. */
  perfProbe?: Record<string, unknown> | null;
  perfProbing?: boolean;
  perfProbeMessage?: string | null;
  onPerfConnect?: (url: string) => Promise<{ ok: boolean; message?: string }>;
  onPerfDisconnect?: () => void;
  onPerfRetryProbe?: () => void;
  /** Hands the whole sheet-source list back. Nothing here saves on its own, so a half-finished
   *  source is abandoned by closing the drawer, like any other draft. */
  onChange: (next: PacingSheetDimSource[]) => void;
}

type View =
  | { kind: "list" }
  /** The chooser: one question, three answers. */
  | { kind: "pick" }
  | { kind: "connect" }
  /** The tab-replaces-delivery editor. */
  | { kind: "perf" }
  /** The moved editor, on one source. `initial` is which of its own screens to open on - "binding"
   *  is the line-item routing, anything else its columns. */
  | { kind: "editor"; index: number; initial: "columns" | "binding" };

/**
 * Sheet sources, end to end: point at a file, say what its columns mean, say which line item each of
 * its names belongs to, and see what it last read.
 *
 * This file is the seam, not the screens. It owns which of the three is on show and hands each one
 * the draft; every rule about what a mapping may be belongs to the moved components.
 */
export function SheetSources({
  slug, sources, stored = [], loaded, lineItems = [], widgets, liDaily, openIndex = null, initialView,
  onRead, onOpenBreakdown, onCreateWidget, onAddCm360, perfSheet = null, onPerfSheetChange,
  perfProbe = null, perfProbing = false, perfProbeMessage = null,
  onPerfConnect, onPerfDisconnect, onPerfRetryProbe, onChange,
}: SheetSourcesProps) {
  const [view, setView] = useState<View>(
    initialView === "perf"
      ? { kind: "perf" }
      : openIndex === null
        ? { kind: "list" }
        : { kind: "editor", index: openIndex, initial: "columns" },
  );

  // Built here rather than per screen: both the list and the editor read it, and walking every row
  // of every source twice for one drawer is the kind of cost that shows on a 60,000-row sheet.
  const runtimeById = useMemo(() => {
    const counts = buildDimCounts(loaded, sources);
    return buildDimRuntime(loaded, sources, counts, [], {}) as Record<string, unknown>;
  }, [loaded, sources]);

  const storedById: Record<string, PacingSheetDimSource> = {};
  for (const entry of stored) {
    const id = String(entry?.id ?? "");
    if (id) storedById[id] = entry;
  }

  function replaceAt(index: number, next: PacingSheetDimSource) {
    onChange(sources.map((entry, i) => (i === index ? next : entry)));
  }

  if (view.kind === "pick") {
    return (
      <div className="ss-wrap">
        <SourceTypeFlow
          // The reference disables this choice when a spreadsheet is already bound; here it is also
          // disabled while that editor does not exist, with the same kind of sentence.
          // The reference's own rule: one spreadsheet per pacing, so the choice closes once one is
          // bound and the sentence under it says to remove that one first.
          sheetTaken={!!perfSheet}
          onPick={(kind) => {
            if (kind === "cm360") {
              setView({ kind: "list" });
              onAddCm360?.();
              return;
            }
            if (kind === "sheet") {
              setView({ kind: "perf" });
              return;
            }
            setView({ kind: "connect" });
          }}
          onCancel={() => setView({ kind: "list" })}
        />
      </div>
    );
  }

  if (view.kind === "perf") {
    return (
      <div className="ss-wrap">
        {/* Mapping opens straight on this screen and carries its own way back, so a second one here
            would be two "back"s stacked, going to two different places. */}
        {!initialView && (
          <button type="button" className="ss-back" onClick={() => setView({ kind: "list" })}>
            ← All sources
          </button>
        )}
        {perfSheet?.spreadsheet_id ? (
          <PerformanceSourceEditor
            sheet={perfSheet}
            slug={slug}
            lineItems={lineItems}
            probe={perfProbe}
            probing={perfProbing}
            probeErrorText={perfProbeMessage}
            onRetryProbe={onPerfRetryProbe}
            onChange={(next) => onPerfSheetChange?.(next)}
          />
        ) : (
          // Nothing bound yet: the editor works against a spreadsheet, so the file comes first.
          <PerfConnectForm onConnect={onPerfConnect} onDone={() => setView({ kind: "list" })} />
        )}
      </div>
    );
  }

  if (view.kind === "connect") {
    return (
      <div className="ss-wrap">
        <DimSourceFlow
          slug={slug}
          sources={sources}
          onAdd={(next) => {
            onChange([...sources, next]);
            // Straight into the mapping: a source with no column roles reads nothing, and the
            // reference takes you there rather than leaving a connected-but-blind entry on a list.
            setView({ kind: "editor", index: sources.length, initial: "columns" });
          }}
          onCancel={() => setView({ kind: "list" })}
        />
      </div>
    );
  }

  if (view.kind === "editor") {
    const source = sources[view.index];
    if (!source) return null;
    const status = loaded[String(source.id ?? "")] ?? {};
    const savedSource = storedById[String(source.id ?? "")] ?? null;
    return (
      <div className="ss-wrap">
        {openIndex === null && (
          <button type="button" className="ss-back" onClick={() => setView({ kind: "list" })}>
            ← All sources
          </button>
        )}
        <AdditionalMappingEditor
          source={source}
          savedSource={savedSource}
          slug={slug}
          lineItems={lineItems}
          rows={status.rows}
          bound={status.bound}
          unbound={status.unbound}
          profile={status.column_profile}
          runtime={runtimeById[String(source.id ?? "")] ?? null}
          saved={!!savedSource}
          widgets={widgets}
          initialView={view.initial}
          onChange={(next) => replaceAt(view.index, next)}
          onOpenBreakdown={onOpenBreakdown}
          onCreateWidget={onCreateWidget}
        />
      </div>
    );
  }

  return (
    <div className="ss-wrap">
      {sources.length === 0 && !perfSheet?.spreadsheet_id ? (
        <p className="ss-empty">
          No sheet connected yet. A sheet adds a breakdown the delivery tables do not carry — apps,
          publishers, placements — attributed to this pacing&apos;s line items.
        </p>
      ) : null}

      {perfSheet?.spreadsheet_id ? (
        <PerfSourceRow
          sheet={perfSheet}
          probe={perfProbe}
          onOpen={() => setView({ kind: "perf" })}
          onRemove={() => onPerfDisconnect?.()}
        />
      ) : null}

      {sources.map((source, index) => (
        <DimSourceBlock
          key={String(source.id ?? index)}
          source={source}
          slug={slug}
          runtime={runtimeById[String(source.id ?? "")] ?? null}
          coverage={dimSourceCoverage(
            source, loaded[String(source.id ?? "")] ?? null, liDaily ?? null, lineItems,
          )}
          saved={storedById[String(source.id ?? "")] ?? null}
          widgets={widgets}
          onRemove={() => onChange(sources.filter((_, i) => i !== index))}
          onGoToMapping={() => setView({ kind: "editor", index, initial: "columns" })}
          onRead={() => onRead?.()}
        />
      ))}

      <button type="button" className="ss-add" onClick={() => setView({ kind: "pick" })}>
        + Add source
      </button>
    </div>
  );
}
