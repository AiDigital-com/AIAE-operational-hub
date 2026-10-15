import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatError } from "../../shared/format/error";
import { cn } from "../../shared/style/cn";
import { ChevronLeftIcon, MoveIcon, RefreshIcon, SettingsIcon } from "../../shared/ui/icons/icons";
import { LoadingBlock } from "../../shared/ui/loading-spinner/loading-spinner";
// Date helper shared with the Overview/Pacing tab so the same figures read identically.
import { fmtDate } from "../pacing/mock/format";
import { AlertsBlock } from "../pacing-overview/alerts-block";
import type { PacingRowV1 } from "../pacing-overview/types";
import {
  getPacingThirdPartyData,
  getPacingThirdPartyStatus,
  savePacingDisplay,
  savePacingPeriodScope,
  triggerPacingRefresh,
} from "./api";
import { StatusControl } from "../pacing-plan/status-control";
import { PacingSettingsDrawer } from "./pacing-settings-drawer";
import { DocumentsChips } from "./documents/documents-chips";
import type { SettingsTabId } from "./settings-section";
import { fmtInt } from "./format";
import { isAdminUser, useCurrentUser } from "../rbac/hooks";
import { usePacingDashboard, useRefreshStatus } from "./hooks";
import { computeHasVideo } from "./alerts-panel";
import { JournalPanel } from "./journal/journal-panel";
import type { PacingDashboardV1, PacingDataShape, PacingDisplayShape, PacingWidgetInstance } from "./types";
import { pacingLibraryApi, referenceError, referenceMe } from "./spa-library-api";
import { SpaToastBridge } from "./spa-toast-bridge";
// Moved JS from Pacing's SPA - Layout mode (see spa/SOURCE.md).
import LayoutModeUntyped from "./spa/layout/LayoutMode.jsx";
import { SectionBoundary as SectionBoundaryUntyped } from "./spa/lineitems/LineItemsTile.jsx";

/** Re-typed at the boundary: `allowJs` infers each prop from its default. */
const LayoutMode = LayoutModeUntyped as unknown as React.ComponentType<{
  onExit: () => void;
  onDirtyChange: (dirty: boolean) => void;
  editable: boolean;
  onOpenLibrary: () => void;
  onOpenSettings: (() => void) | null;
}>;
const SectionBoundary = SectionBoundaryUntyped as unknown as React.ComponentType<{
  name: string;
  children: React.ReactNode;
}>;

/** Pacing's own rule: Layout mode is offered from 900 px up (grid editing on a phone is a
 *  non-goal); a saved layout still renders responsively everywhere. */
const LAYOUT_MIN_WIDTH = "(min-width: 900px)";
const layoutWidthQuery = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(LAYOUT_MIN_WIDTH)
    : null;
import { ReportBoard } from "./widgets/report-board";
import { planAutoAdd } from "./widgets/auto-add";
// Moved JS from Pacing's SPA - the refusal wording every switch shares.
import { saveErrorDetailText } from "./spa/save-error.js";
// Moved JS from Pacing's SPA - typed by inference under `allowJs` (see spa/SOURCE.md).
import {
  PacingStateProvider,
  bindDimensionHandoff,
  setDimensionHandoff,
  periodsOf,
  setPacingApi,
  usePacingState,
} from "./spa/store.js";
import { resolvePeriodKey } from "./spa/periods.js";
import { PeriodScopeBanner, type ScopePeriod } from "./filters/period-scope";
import { SEED_ID_BY_KEY } from "./spa/std-catalog.js";
import { WIDGET_CAP, copyWidget, enabledPatch, resolveWidget, setTileEnabled, tileEnabled, tileTitle, withWidgetRemoved } from "./widgets/widget-tiles";
import { createPacingEngine } from "./engine/engine-loader";
import { toEngineRaw } from "./engine/build-metrics";
import { buildPacingMetrics } from "./engine/build-metrics";
import { buildPacingAlerts } from "./engine/build-alerts";
import { FilterBar } from "./filters/filter-bar";
import { useUrlFilters } from "./filters/use-url-filters";
import type { PacingLineItemPlanV1 } from "../pacing-plan/types";
import "./pacing-dashboard.css";

/** THE Breakdown tile's fixed id - the first addressee of «See in Breakdown». */
const BREAKDOWN_TILE_ID: string = SEED_ID_BY_KEY["std:v2:breakdown"];

/** Does a widget carry a dimension switch - one that could take a handed-over axis? */
function hasDimensionSwitch(widget: PacingWidgetInstance): boolean {
  const spec = widget.spec as { controls?: unknown } | undefined;
  return Array.isArray(spec?.controls)
    && spec.controls.some((c) => Boolean(c) && (c as { type?: unknown }).type === "dimension");
}

interface PacingDashboardProps {
  row: PacingRowV1;
  /**
   * Renders the "Back to pacings" link. Omitted where there is nothing to go back to: the campaign
   * Pacing tab keeps its list on screen above this dashboard, so a back link there would offer to
   * return to a list the user is already looking at.
   */
  onBack?: () => void;
  /**
   * Set only for a pacing the user has just created. Creating a pacing starts its first refresh
   * fire-and-forget, so this view can open before any data exists; with this set, it waits for that
   * first build and fills itself in (parity with the retired SPA's first-data watch). Deliberately not
   * inferred from "no data yet": an older pacing may never build (e.g. an incomplete plan), and must
   * not claim a refresh is running when none is.
   */
  watchFirstData?: boolean;
}

/**
 * The full pacing detail view (§6 of the migration plan, US-114 through US-119): health, financial
 * figures, plan-vs-actual charts, the widget library, and on-demand refresh. Reached from the campaign
 * Pacing tab (§5) by opening a row - see `pacing-tab.tsx`.
 *
 * Health/margin/alert figures come straight from `row` (the same `PacingRowV1` already shown on the
 * Overview/Pacing-tab row, computed server-side by Pacing's `computeHealthBatch`) rather than being
 * recomputed here, so US-114's "figures match the existing tool" holds trivially - it is the exact
 * same server figure the user already saw.
 *
 * Breakdown and Daily Performance (§7) are ordinary Standard widgets on the board, as Targets and
 * Delivery vs CM360 are (the reference's sections cutover, 2026-09-07) - not sections of this page.
 */
export function PacingDashboard({ row, onBack, watchFirstData = false }: PacingDashboardProps) {
  const slug = row.dashSlug ?? undefined;
  const dashboardQuery = usePacingDashboard(slug);
  const refreshStatus = useRefreshStatus(slug);
  const queryClient = useQueryClient();
  // Reuses the same ["auth", "me"] cache app-shell.tsx already populated - never a second fetch.
  const currentUser = useCurrentUser(true);
  const isAdmin = isAdminUser(currentUser.data);

  const [settingsOpen, setSettingsOpen] = useState(false);
  // Which tab the NEXT drawer open should land on: null means "wherever the user left off" (the
  // gear's behaviour), "documents" is the header chips' promise. Consumed by the drawer on open.
  const [settingsTab, setSettingsTab] = useState<SettingsTabId | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  // The journal's highlighted-entry date (§15 follow-up): clicking a journal row sets this, and any
  // chart view whose own spec carries `journal: true` draws a vertical marker at it. Page-level state,
  // not a store - there is only ever one pacing dashboard mounted at a time.
  const [journalHighlight, setJournalHighlight] = useState<string | null>(null);
  /** Which widget the drawer should open its editor on, set by a tile's "Edit…". Cleared by the
   *  drawer once consumed, so a later open lands on the list rather than on the last edited tile. */
  const [editWidgetId, setEditWidgetId] = useState<string | null>(null);
  /** The Line Items tile's ⋯ → Customize…: a new number per request, cleared by the drawer once it
   *  has opened that block's settings card. */
  const [customizeLineItems, setCustomizeLineItems] = useState<number | null>(null);
  /** Layout mode's "+ Add": open the drawer on Display's Library. A new number per request. */
  const [openLibraryRequest, setOpenLibraryRequest] = useState<number | null>(null);

  // Layout mode (Pacing's DashboardView): the board swapped for its editor. Offered from 900 px up;
  // crossing below that closes only a CLEAN session - an in-progress rearrangement survives the
  // resize, and the hint bar's Save/Cancel stays usable at any width.
  const [layoutMode, setLayoutMode] = useState(false);
  const layoutDirtyRef = useRef(false);
  const [canEditLayout, setCanEditLayout] = useState(() => layoutWidthQuery()?.matches ?? false);
  useEffect(() => {
    const mq = layoutWidthQuery();
    if (!mq) return undefined;
    const onChange = () => {
      setCanEditLayout(mq.matches);
      if (!mq.matches && !layoutDirtyRef.current) setLayoutMode(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  // A pacing switched away from mid-session leaves nothing behind for the next one.
  useEffect(() => {
    setLayoutMode(false);
    layoutDirtyRef.current = false;
  }, [slug]);

  // At most once per mount: a first build that times out falls back to the normal "no data" state
  // rather than re-arming itself on the next status fetch.
  const firstDataWatchStarted = useRef(false);
  useEffect(() => {
    if (!watchFirstData || firstDataWatchStarted.current) return;
    if (!refreshStatus.data || refreshStatus.data.exists) return;
    firstDataWatchStarted.current = true;
    refreshStatus.startWatching();
    // startWatching is re-created every render; the status data is what this reacts to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchFirstData, refreshStatus.data]);

  useEffect(() => {
    if (cooldownUntil == null) return;
    const tick = () => setCooldownSeconds(Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [cooldownUntil]);

  const data = dashboardQuery.data;
  // Kept whole, not destructured-and-rebuilt: the object goes to `usePacingState` below as a memo
  // dependency, and a fresh `{ filters, setFilters }` literal there defeated that memo on every
  // render. `useUrlFilters` now returns a stable object for exactly this reason.
  const urlFilters = useUrlFilters();
  const { filters, setFilters } = urlFilters;


  // Computed HERE now, not read off `data.metrics` (Operational Hub migration, filters): Pacing's
  // engine (shared/dashboard-metrics.js) moved into the browser byte-identical
  // (./engine/vendor/), so a filter change can recompute these figures instantly instead of
  // needing a server round trip that had no filters to answer to begin with. `buildPacingMetrics`
  // is the same four-piece computation `dash-gate/lib/merge.mjs`'s `buildMetricBag` runs
  // server-side, parametrized by `effLIs`/`range` derived from `filters` - see its own docblock,
  // including the crown-test guarantee that with every filter at default this equals
  // `data.metrics` byte-for-byte. `data.metrics` itself is still sent and still unused here on
  // purpose (§ "leave buildMetricBag in the Pacing service alone" - removing it is a later, separate
  // step the owner deliberately sequenced after this one).
  const metrics = useMemo(() => buildPacingMetrics(data, filters), [data, filters]);

  // Delivery per line item per day, for the settings drawer's coverage line ("this source covers
  // 89% of pacing impressions"). Built HERE because this is where the whole payload is, and with the
  // engine the rest of the page uses - a figure derived some other way would be a second opinion
  // about how much this pacing delivered.
  const sheetCoverageLiDaily = useMemo(() => {
    if (!data?.campaign || !data?.planByLineItem) return null;
    try {
      const { LD } = createPacingEngine().normalize(toEngineRaw(data)) as {
        LD: Record<string, unknown>;
      };
      return LD ?? null;
    } catch {
      // A payload the engine cannot normalise is one the dashboard could not draw either; the
      // coverage line simply does not appear.
      return null;
    }
  }, [data]);

  const display = useMemo(() => (data?.display ?? {}) as PacingDisplayShape, [data]);
  // Settings → Display's unsaved draft, previewed on the board behind the open drawer (Pacing's
  // drawer pushes it into the store the same way). Only while the drawer is open: a closed drawer
  // has discarded or saved it, and the board must show what is stored.
  const [displayPreview, setDisplayPreview] = useState<PacingDisplayShape | null>(null);

  // The «See in Breakdown» axis (spa/store.js `setDimensionHandoff`), mirrored here only so the
  // tiles re-render when it changes. A pacing switched away from leaves nothing behind for the next.
  const [dimensionHandoff, setDimensionHandoffState] = useState<string | null>(null);
  useEffect(() => bindDimensionHandoff(setDimensionHandoffState), []);
  useEffect(() => () => setDimensionHandoff(null), [slug]);

  // "Open the Breakdown", from a sheet column's mapping screen - the reference's own handoff
  // (SettingsDrawer.jsx openBreakdownFromMapping). The axis goes into the URL filters, clearing the
  // dashboard's own cuts, because a line-item or channel filter left over from before can hide the
  // very column the person just picked. The Breakdown WIDGET reads no URL - its cut is the tile's
  // own - so the axis is also handed to the first tile on the board that could take it: THE
  // Breakdown tile, else any tile with a dimension switch, else a library-linked copy (it carries
  // no inline spec to ask). With no such tile nothing is handed over and nothing waits for one.
  const openBreakdownFromMapping = useCallback(
    (source: { id?: unknown }, dim: { key?: unknown }) => {
      if (!source?.id || !dim?.key) return;
      const axis = `ds:${String(source.id)}:${String(dim.key)}`;
      setFilters({
        brk: axis,
        brkf: [],
        selection: [], channels: [], labels: [], platforms: [],
      });
      const shown = (display.widgets ?? []).filter((w) => tileEnabled(display, w.id));
      const target = shown.find((w) => w.id === BREAKDOWN_TILE_ID)
        ?? shown.find((w) => hasDimensionSwitch(w))
        ?? shown.find((w) => Boolean((w as { lib?: unknown }).lib) && !(w as { spec?: unknown }).spec);
      if (target) setDimensionHandoff(axis);
      setSettingsOpen(false);
      if (!target) return;
      // After the drawer's own close, so the tile is on screen to scroll to.
      window.setTimeout(() => {
        document.querySelector(`[data-tile-id="${target.id}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 200);
    },
    [setFilters, display],
  );

  /**
   * What Pacing's own renderer reads its figures from (`spa/store.js`). Assembled here because this
   * is where the payload and the URL filters already are; `usePacingState` does the shaping the SPA
   * store used to do on load — `normalize()` into the terse plan, and the per-line-item per-day
   * aggregate `useWidgetData` refuses to work without.
   */
  const widgetActions = useMemo(
    () => ({
      /**
       * The reference store's `saveSettings(slug, config)`, for every display write the moved code
       * makes: a tile's saved period and a Projection control's mode, an on/off switch, the Library's
       * block Add and layout Apply, the Groups section, and Layout mode's Save.
       *
       * `config.display_rev` goes out exactly as the caller sent it, as the reference store sends
       * it: present on a save built from a snapshot (Layout mode, the Library, the board's
       * Duplicate/Delete), absent on a per-entry preference patch, which dash-gate merges against the
       * stored row and checks no revision for. The answer is adopted into the cached payload as the
       * reference store adopts it (`adoptDisplayAnswer`): display and revision, unless an answer
       * already adopted is newer - two quick switch saves can come back out of order. A refusal is
       * thrown the way the reference's apiFetch throws it (`err.message` = the code).
       *
       * The slug the moved code passes is IGNORED: it reads it from `useParams()`, which answers
       * nothing under this app's `/campaigns/:campaignId/pacing` route.
       */
      saveSettings: async (
        _slug: string,
        config: { display?: Record<string, unknown>; display_rev?: number; display_writer?: Record<string, unknown> }
      ) => {
        if (!slug || !config?.display) return { ok: true };
        const key = ["pacing", "dashboard", slug];
        const live = queryClient.getQueryData<PacingDashboardV1>(key);
        const outcome = await savePacingDisplay(
          slug,
          config.display,
          config.display_rev != null ? Number(config.display_rev) : undefined,
          (config.display_writer ?? live?.capabilities) as Record<string, unknown> | undefined
        );
        if (outcome.status === "conflict") throw referenceError(outcome.conflict.reason, 409);
        const gotRev = Number((outcome.display as PacingDisplayShape).rev ?? NaN);
        queryClient.setQueryData<PacingDashboardV1>(key, (old) => {
          if (!old) return old;
          const knownRev = Number((old.display as PacingDisplayShape | undefined)?.rev ?? 0);
          if (Number.isFinite(gotRev) && gotRev < knownRev) return old;
          return { ...old, display: outcome.display as PacingDashboardV1["display"] };
        });
        return { ok: true, display: outcome.display, capabilities: live?.capabilities };
      },
      /**
       * The reference store's `mergeLibraryEntries`: a tile just linked from the Library, or an entry
       * just shared, resolves at once instead of drawing "entry unavailable" until the next load.
       * Merged, never replaced - replacing would drop another linked tile's definition.
       */
      mergeLibraryEntries: (entries: Record<string, unknown> | null | undefined) => {
        if (!slug || !entries) return;
        const userEntries = Object.fromEntries(
          Object.entries(entries).filter(([id]) => !id.startsWith("std:"))
        );
        if (!Object.keys(userEntries).length) return;
        queryClient.setQueryData<PacingDashboardV1>(["pacing", "dashboard", slug], (old) =>
          old
            ? { ...old, libraryEntries: { ...((old.libraryEntries ?? {}) as Record<string, unknown>), ...userEntries } }
            : old
        );
      },
    }),
    [slug, queryClient]
  );
  /**
   * The two calls a CM360 widget makes. Both were stubbed to `null` until 2026-10-09, while the
   * lane still ran through an n8n that was not deployed; it runs inside Pacing now and the Hub
   * carries the two endpoints, so they are wired to the real thing.
   *
   * `thirdPartyData` answers null for a pacing with nothing published (a 404 from Pacing, which is
   * the ordinary "no fetch has run yet" and not a failure) - the renderer already draws its own
   * "no third-party data" state for that, which is why it is not an error path.
   */
  // The mapping editor needs both sides it is asked to bridge. It builds the delivery side itself,
  // through the comparison engine's own row builders, so what it wants here is the raw payload
  // rather than anything pre-chewed - see mapping-panel.tsx for why a derived list was wrong.

  const thirdPartyQuery = useQuery({
    // Only once the drawer is open: the file runs to tens of megabytes and nothing on the dashboard
    // itself reads it - the compare widget fetches its own copy through the SPA's cache.
    queryKey: ["pacing", "third-party", slug],
    queryFn: () => (slug ? getPacingThirdPartyData(slug) : Promise.resolve(null)),
    enabled: !!slug && settingsOpen,
    retry: false,
    staleTime: 30_000,
  });
  const thirdPartyFile = thirdPartyQuery.data ?? null;

  useEffect(() => {
    setPacingApi({
      // The slug the moved SPA passes is IGNORED, exactly as saveSettings above ignores its
      // own: that code reads it from `useParams()`, which answered under the retired SPA's
      // `/:slug` route and answers nothing under the Hub's `/campaigns/:campaignId/pacing`.
      // Trusting it put the literal string `{slug}` in the URL - a 500 on every call.
      // No slug yet means the row has not resolved - answering null is what the renderer already
      // draws for a pacing with nothing to show, so it needs no state of its own. Once there IS a
      // slug these pass failures through: the widget treats an error and no rows the same way.
      thirdPartyData: () => (slug ? getPacingThirdPartyData(slug) : Promise.resolve(null)),
      thirdPartyStatus: () => (slug ? getPacingThirdPartyStatus(slug) : Promise.resolve(null)),
      library: pacingLibraryApi,
      me: async () => referenceMe(isAdmin),
    });
  }, [slug, isAdmin]);

  /**
   * What a tile's ⋯ menu does. These SAVE AT ONCE, under the payload's own `displayRev`: the board
   * holds no draft, so there is nothing to fold an edit into and nothing a Cancel could abandon. A
   * concurrent editor therefore earns a 409 here rather than losing their work, which is the whole
   * point of sending the revision.
   *
   * Edit is the exception and opens the drawer: editing a widget IS a draft, and the drawer is where
   * this app keeps drafts.
   */
  const [boardSaving, setBoardSaving] = useState(false);
  // A tile's Turn off - a widget's or a page section's - is the switch's own write, alone, through
  // the same queued saver the Settings switches use (Pacing's DashGrid `turnOff` goes through
  // `useEnabledSwitch` the same way), not `commit` below.
  const [switchSaving, setSwitchSaving] = useState(false);
  const turnOff = useCallback(
    async (tileId: string) => {
      setSwitchSaving(true);
      try {
        await widgetActions.saveSettings(slug ?? "", { display: { enabled: enabledPatch(tileId, false) } });
      } catch (error) {
        setRefreshError(saveErrorDetailText(error, "Could not turn it off"));
      } finally {
        setSwitchSaving(false);
      }
    },
    [slug, widgetActions]
  );
  const boardActions = useMemo(() => {
    const widgetsOf = () => (display.widgets ?? []);
    const commit = async (patch: Record<string, unknown>) => {
      if (!slug) return;
      setBoardSaving(true);
      try {
        // Through the shared saver's queue, under the revision this board drew - a concurrent editor
        // still earns a 409 rather than losing their work.
        await widgetActions.saveSettings(slug, {
          display: { ...display, ...patch },
          display_rev: Number(display.rev ?? 0),
        });
        queryClient.invalidateQueries({ queryKey: ["pacing", "dashboard", slug] });
      } catch (error) {
        const code = (error as { message?: string })?.message;
        setRefreshError(
          code === "stale_settings"
            ? "This pacing's layout changed elsewhere. Reload before changing it again."
            : saveErrorDetailText(error, formatError(error))
        );
      } finally {
        setBoardSaving(false);
      }
    };
    return {
      saving: boardSaving || switchSaving,
      onEdit: (widgetId: string) => {
        setSettingsTab("widgets");
        setSettingsOpen(true);
        setEditWidgetId(widgetId);
      },
      onCustomizeLineItems: () => {
        setSettingsTab("widgets");
        setSettingsOpen(true);
        setCustomizeLineItems((n) => (n ?? 0) + 1);
      },
      onDuplicate: (widgetId: string) => {
        const list = widgetsOf();
        const widget = list.find((w) => w.id === widgetId);
        if (!widget || list.length >= WIDGET_CAP) return;
        const drawn = resolveWidget(widget, data?.libraryEntries as Record<string, unknown> | undefined);
        if (!drawn) return;
        const copy = copyWidget({ ...drawn, title: tileTitle(widget, drawn) }, list.map((w) => w.id));
        const next = [...list];
        next.splice(list.findIndex((w) => w.id === widgetId) + 1, 0, copy);
        void commit({ widgets: next });
      },
      onTurnOff: (tileId: string) => void turnOff(tileId),
      onRemove: (widgetId: string) =>
        void commit(withWidgetRemoved(widgetsOf(), display.groups ?? [], display.enabled, widgetId)),
    };
  }, [slug, display, data, queryClient, boardSaving, switchSaving, turnOff, widgetActions]);

  // Period scope (the reference's `toggleScopeMode` / `selectPeriod`). The saved setting comes with
  // the payload; this is the optimistic copy while a change is being saved, so the switch answers at
  // once. Dropped whenever a payload arrives - the refetch after the save carries the saved value.
  const [periodScopeOverride, setPeriodScopeOverride] =
    useState<{ periodScope: boolean; periodScopeKey: string | null } | null>(null);
  useEffect(() => setPeriodScopeOverride(null), [data]);

  const shownDisplay = settingsOpen && displayPreview ? displayPreview : display;
  const pacingState = usePacingState({
    displayOverride: settingsOpen ? displayPreview : null,
    data,
    urlFilters,
    actions: widgetActions,
    journalHighlight,
    dimensionHandoff,
    periodScopeOverride,
  });

  const scopePeriods = periodsOf(pacingState.liPlan) as ScopePeriod[];
  const scoped = !!pacingState.splitScopedMode;
  const selectedPeriodKey: string | null = pacingState.selectedPeriodKey ?? null;

  // Computed HERE now, not read off `row.alerts` (owner ask, 2026-09-25, filters follow-up item 3):
  // `row.alerts` is `dash-gate/lib/health.mjs`'s server-computed alert list for the WHOLE pacing -
  // no URL filter ever reaches it, so it used to sit still while every other figure on the page
  // moved under a filter. `buildPacingAlerts` (`./engine/build-alerts.ts`) is the browser port of
  // the retired SPA's own `computeDashboardAlerts`, sharing `buildPacingMetrics`'s engine and its
  // `effLIs` Scope split - a Scope filter changes the alert set, a Lens filter does not, same as the
  // KPI strip below. Under period scope they judge the selected period, as the reference does. They
  // draw as a tile of the board, which appears with the payload, so there is nothing to show before it.
  const alerts = useMemo(
    () => (data ? buildPacingAlerts(data, filters, undefined, { scoped, periodKey: selectedPeriodKey }) : []),
    [data, filters, scoped, selectedPeriodKey]
  );

  /** Saves a period-scope change and shows it at once; a failed save puts the stored state back. */
  const savePeriodScope = useCallback(
    (periodScope: boolean, periodScopeKey: string | null) => {
      if (!slug) return;
      setPeriodScopeOverride({ periodScope, periodScopeKey });
      savePacingPeriodScope(slug, periodScope, periodScopeKey)
        .then(() => queryClient.invalidateQueries({ queryKey: ["pacing", "dashboard", slug] }))
        .catch((error) => {
          setPeriodScopeOverride(null);
          setRefreshError(formatError(error));
        });
    },
    [slug, queryClient]
  );

  // A custom range likely names days outside the new period, so turning scope on or picking another
  // period drops it, as the reference does.
  const dropCustomRange = useCallback(() => {
    if (filters.range === "custom") setFilters({ range: "all", customRange: { from: "", to: "" } });
  }, [filters.range, setFilters]);

  const handleScopeToggle = useCallback(
    (mode: "full" | "period") => {
      const wantScoped = mode === "period";
      if (wantScoped === scoped) return;
      if (!wantScoped) {
        savePeriodScope(false, null);
        return;
      }
      dropCustomRange();
      // Turning it on lands on the CURRENT period (no saved key), which is then saved as the
      // pacing's period, so the Overview row and the Slack summary follow it.
      const current = resolvePeriodKey(pacingState.liPlan, pacingState.facts?.asOf || null, null);
      savePeriodScope(true, current.key ?? null);
    },
    [scoped, savePeriodScope, dropCustomRange, pacingState.liPlan, pacingState.facts]
  );

  const handlePeriodSelect = useCallback(
    (key: string) => {
      if (!scoped || !key) return;
      dropCustomRange();
      savePeriodScope(true, key);
    },
    [scoped, savePeriodScope, dropCustomRange]
  );

  // The Custom calendar's bounds follow the period while scoped - its start, and its end capped at
  // the data edge (`FilterBar.jsx`'s effMinDate / effMaxDate).
  const asOfDay: string | undefined = metrics?.asOf ?? undefined;
  const [periodFs, periodFe] = scoped && selectedPeriodKey ? selectedPeriodKey.split("|") : [undefined, undefined];
  const calendarMin = periodFs || data?.campaign?.startDate;
  const calendarMax = periodFe
    ? (asOfDay && asOfDay < periodFe ? asOfDay : periodFe)
    : (asOfDay ?? data?.campaign?.endDate);

  // The one-shot auto-add (widgets/auto-add.ts), after every load of the payload - the reference
  // runs it once per fetch, and the drawer's save of a CM360 source refetches, which is how the
  // comparison widget appears on this open rather than the next. A no-op in silence whenever the
  // receipts already cover what the rules want, which is every load but the first after a change.
  //
  // ONE save carries both halves - the new instances and the receipts - as a patch the server merges
  // under the payload's revision. A 409 is not an error: another tab did it first, and the next load
  // sees their result. Nothing else is shown either - nobody clicked anything - but the console says
  // what happened, so a dashboard that quietly never grew its chart can be explained.
  const autoAddRan = useRef<unknown>(null);
  useEffect(() => {
    if (!slug || !data || !pacingState.campaign || autoAddRan.current === data) return;
    autoAddRan.current = data;
    const plan = planAutoAdd(display, pacingState.liPlan, pacingState.facts, pacingState.thirdParty);
    if (!plan) return;
    const capabilities = data.capabilities as Record<string, unknown> | undefined;
    const storedReceipts = (display as { autoAdded?: unknown }).autoAdded;
    void (async () => {
      try {
        const outcome = await savePacingDisplay(
          slug,
          {
            widgets: [...(display.widgets ?? []), ...plan.added],
            autoAdded: [...(Array.isArray(storedReceipts) ? storedReceipts : []), ...plan.fresh],
          },
          Number(display.rev ?? 0),
          capabilities
        );
        if (outcome.status === "conflict") return;
        // A stale off-switch on a fixed id, cleared only after the tile is stored. `enabled` is
        // sent WHOLE: beside a revision this is a full display write, which replaces the map.
        const saved = outcome.display as PacingDisplayShape;
        if (plan.staleOff.length && saved.rev !== undefined) {
          let enabled = saved.enabled ?? {};
          for (const id of plan.staleOff) enabled = setTileEnabled(enabled, id, true);
          try {
            await savePacingDisplay(slug, { enabled }, Number(saved.rev), capabilities);
          } catch (error) {
            console.warn("[autoAdd] switch", formatError(error));
          }
        }
        queryClient.invalidateQueries({ queryKey: ["pacing", "dashboard", slug] });
      } catch (error) {
        console.warn("[autoAdd]", formatError(error));
      }
    })();
  }, [slug, data, display, pacingState, queryClient]);

  // The page's two sections that are this app's own components, built here where their inputs are:
  // the board draws them as tiles, and Layout mode's registry (`spa/tile-registry.jsx`) reads them
  // off the state seam as `sections`, because Pacing's registry components take no props.
  const sections = useMemo(
    () => (data
      ? {
          // Was: every alert's full sentence, joined with " · ", one line per severity. On a
          // 180-line-item pacing that is a hundred and thirty sentences in a single unbroken
          // paragraph. AlertsBlock lays them out the way the retired SPA did — numbers first, cards
          // for what is critical, the tail collapsed. Nothing to say, no tile.
          alerts: alerts.length ? <AlertsBlock alerts={alerts} /> : null,
          journal: (
            <JournalPanel
              slug={slug ?? ""}
              journal={data.journal}
              flightStart={row.flightStart}
              flightEnd={row.flightEnd}
              planByLineItem={(data.planByLineItem ?? {}) as Record<string, PacingLineItemPlanV1>}
              factsDaily={data.factsDaily}
              onHighlightDate={setJournalHighlight}
              setFilters={setFilters}
            />
          ),
        }
      : undefined),
    [data, alerts, slug, row.flightStart, row.flightEnd, setFilters]
  );
  const providedState = useMemo(() => ({ ...pacingState, sections: sections ?? null }), [pacingState, sections]);

  async function handleRefresh() {
    setRefreshError(null);
    try {
      const outcome = await triggerPacingRefresh(row.id);
      if (outcome.status === "cooldown") {
        setCooldownUntil(Date.now() + outcome.retryAfterSeconds * 1000);
        return;
      }
      setCooldownUntil(null);
      refreshStatus.startWatching();
    } catch (error) {
      setRefreshError(formatError(error));
    }
  }

  useEffect(() => {
    if (!refreshStatus.watching && refreshStatus.data) {
      refreshStatus.invalidateDashboard();
    }
    // Only fire when watching just turned off, not on every refetch - invalidateDashboard is stable
    // enough for this effect's purpose (re-pulling the dashboard once a refresh has actually landed).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshStatus.watching]);

  const isRefreshing = refreshStatus.watching;
  const inCooldown = cooldownUntil != null && cooldownSeconds > 0;

  return (
    <section className="pdash">
      <SpaToastBridge />
      {onBack && (
        <button type="button" className="pdash__back" onClick={onBack}>
          <ChevronLeftIcon /> Back to pacings
        </button>
      )}

      <header className="pdash__header">
        <div>
          <h1 className="pdash__title">{row.name}</h1>
          <div className="pdash__subtitle">
            {(row.campaigns ?? [])[0]?.name ?? "No campaign linked"}
            {row.flightStart && row.flightEnd && (
              <>
                {" · "}
                {fmtDate(row.flightStart)} – {fmtDate(row.flightEnd)}
              </>
            )}
          </div>
        </div>
        <div className="pdash__header-actions">
          <StatusControl pacingId={row.id} status={row.status} />
          <button
            type="button"
            className="button button--ghost button--sm pdash__refresh"
            onClick={handleRefresh}
            disabled={isRefreshing || inCooldown}
          >
            <RefreshIcon className={cn(isRefreshing && "pdash__refresh-icon--spin")} />
            {inCooldown ? `Refresh (${cooldownSeconds}s)` : isRefreshing ? "Refreshing…" : "Refresh data"}
          </button>
        </div>

        {/* §16: the campaign's reference links, on their own line under the title (full flex
            basis, so appearing chips never push the Settings/Refresh buttons around) and above
            the refresh-meta line below the header. Rendered only once the dashboard payload is
            in - the same gate the FilterBar uses - so the row cannot flash "+ Add documents" at
            a pacing whose links simply have not loaded yet. */}
        {dashboardQuery.isSuccess && data && (
          <DocumentsChips
            links={data.campaign?.links}
            orderNumber={data.campaign?.orderNumber}
            sourceUrl={data.campaign?.sourceUrl}
            onOpenDocuments={() => {
              setSettingsTab("documents");
              setSettingsOpen(true);
            }}
          />
        )}
      </header>

      <div className="pdash__refresh-meta">
        {refreshStatus.data?.exists ? (
          <span>
            Last refresh: {refreshStatus.data.latestDate ? fmtDate(refreshStatus.data.latestDate) : "—"} ·{" "}
            {fmtInt(refreshStatus.data.rowCount)} rows
          </span>
        ) : isRefreshing ? (
          <span>Pulling delivery data — the page will fill in automatically.</span>
        ) : (
          <span>No data has been built for this pacing yet.</span>
        )}
        {refreshError && <span className="pdash__refresh-error">{refreshError}</span>}
      </div>

      {/* §6/filters: the seven-filter bar (range, channels, labels, platforms, selection,
          brk/brkf) ported from the retired SPA's FilterBar.jsx. Sits directly under the pacing
          header, above the KPI strip and the alert rows (owner ask, 2026-09-25) - everything from
          here down, including the KPI strip's Pace/Margin, reads `metrics`, which already reflects
          the current `filters` above. */}
      {/* While Layout mode is open the bar stays on screen but inert, and carries neither action: the
          Layout button is the mode we are already in, and the Settings gear lives on Layout mode's
          own hint bar for the session (Pacing's DashboardView). */}
      {dashboardQuery.isSuccess && data && (
        <div className={layoutMode ? "pdash__fb-inert" : undefined} {...(layoutMode ? { inert: "" } : {})}>
        <FilterBar
          filters={filters}
          setFilters={setFilters}
          liPlan={(data.planByLineItem ?? {}) as Record<string, PacingLineItemPlanV1>}
          factsDaily={data.factsDaily}
          // The display the board draws (the drawer's preview included), so a name typed in Settings
          // is searchable before it is saved, as it is in the reference's store-fed spotlight.
          liNames={(shownDisplay?.liNames as Record<string, string> | undefined) ?? null}
          minDate={calendarMin}
          maxDate={calendarMax}
          periodScope={{
            visible: scopePeriods.length > 0 || scoped,
            scoped,
            periods: scopePeriods,
            selectedKey: selectedPeriodKey,
            onToggle: handleScopeToggle,
            onSelect: handlePeriodSelect,
          }}
          actions={
            layoutMode ? null : (
              <>
                {/* Layout mode, beside the gear as in the reference. */}
                {canEditLayout && (
                  <button
                    type="button"
                    className="fb-icon-btn"
                    onClick={() => setLayoutMode(true)}
                    aria-label="Layout mode"
                    title="Layout — rearrange dashboard sections and tiles"
                  >
                    <MoveIcon />
                  </button>
                )}
                {/* The dashboard's settings, at the right end of the filter row as in the
                    reference (it used to sit in the header beside Refresh data). */}
                <button
                  type="button"
                  className="fb-icon-btn"
                  onClick={() => {
                    setSettingsTab(null);
                    setSettingsOpen(true);
                  }}
                  aria-haspopup="dialog"
                  aria-expanded={settingsOpen}
                  aria-label="Settings"
                  title="Pacing settings"
                >
                  <SettingsIcon />
                </button>
              </>
            )
          }
        />
        </div>
      )}

      {dashboardQuery.isSuccess && data && !layoutMode && (
        <PeriodScopeBanner
          scoped={scoped}
          state={pacingState.periodScopeState ?? null}
          periods={scopePeriods}
          selectedKey={selectedPeriodKey}
        />
      )}

      {/* The Pace / Margin / Budget / Spend strip that used to sit here is GONE (owner decision,
          2026-10-01). It had no counterpart in Pacing itself - that page's header carries the
          campaign name and its badges, and the headline figures live in the "Delivery, Pacing &
          Margin" widget. Here the two disagreed in public: on a Complete pacing the strip is
          `inactive` and printed "No data" and a dash, while the widget right below it computed
          92.90% margin and "Ahead of pace" from the same facts; and its CPM was the cost-side one
          while Finance beside it showed the client-side CPM, neither labelled as either. One set of
          figures, computed one way. */}


      {dashboardQuery.isPending && <LoadingBlock label="Loading dashboard" />}
      {dashboardQuery.isError && <p className="form-error">{formatError(dashboardQuery.error)}</p>}

      {dashboardQuery.isSuccess && data && (
        /* Everything that draws a widget sits under this: the board, and the settings drawer, whose
           library cards render the SAME renderer at thumbnail size. One provider, so a card and the
           tile it stands for read the same figures by construction. */
        <PacingStateProvider value={providedState}>
          {/* Display-driven (§6 fix, US-114/115): walks `display.widgets[]` -> each widget's own
              spec.views - never a fixed, hardcoded set of charts. Adding/removing a widget in the
              library panel below changes exactly what renders here. */}
          {/* Pacing's own renderer on Pacing's own grid, fed by the seam above. The board takes the
              whole `display` rather than a filtered widget list: the switched-off drop happens AFTER
              placement inside it, so a hidden tile's neighbours do not slide into its cell and
              refuse to slide back when it is switched on again. */}
          {/* The page's four sections are tiles of this board, as in Pacing: Launch Plan, Alerts, Line
              Items and the journal, each on its own slot and each with its switch. Alerts and the
              journal are built here, where their inputs are, and handed in. */}
          {layoutMode ? (
            <SectionBoundary name="LayoutMode">
              <LayoutMode
                onExit={() => {
                  layoutDirtyRef.current = false;
                  setLayoutMode(false);
                }}
                onDirtyChange={(dirty) => {
                  layoutDirtyRef.current = dirty;
                }}
                editable={canEditLayout}
                onOpenLibrary={() => {
                  setSettingsTab("widgets");
                  setSettingsOpen(true);
                  setOpenLibraryRequest((n) => (n ?? 0) + 1);
                }}
                onOpenSettings={() => {
                  setSettingsTab(null);
                  setSettingsOpen(true);
                }}
              />
            </SectionBoundary>
          ) : (
            <ReportBoard display={shownDisplay} actions={boardActions} blocks={sections} />
          )}

          {/* §6's Line Items block is NOT here any more (2026-10-05): it is a tile of the board
              above, placed on Pacing's own slot scale between the summary widgets and the charts
              (`widgets/report-board.tsx`, LINE_ITEMS_ID). It used to be a fixed section below the
              whole grid, which put a line item's own figures under the charts that roll up from
              them. */}

          {/* Every per-pacing setting behind one gear, as the retired SPA had it: a right-hand
              drawer with a row of tabs and ONE Save over all of them. Three buttons opening three
              panels with three Save buttons was three places to learn and three chances to leave
              an edit behind. */}
          <PacingSettingsDrawer
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            onOpenBreakdown={openBreakdownFromMapping}
            slug={slug ?? ""}
            currency={data.campaign?.currency ?? "USD"}
            rate={data.campaign?.rate ?? 1}
            rateLocked={data.campaign?.rateLocked ?? false}
            nsRate={data.campaign?.nsRate ?? null}
            availableSplits={data.availableSplits as Record<string, Record<string, string[]>> | null | undefined}
            splitFacts={pacingState.facts}
            planByLineItem={(data.planByLineItem ?? {}) as Record<string, PacingLineItemPlanV1>}
            conversions={data.conversions as Array<Record<string, unknown>> | undefined}
            data={data.data as PacingDataShape | undefined}
            deliveryStats={data.deliveryStats}
            dimSourcesLoaded={data.dimSources as Record<string, Record<string, unknown>> | undefined}
            liDaily={sheetCoverageLiDaily}
            display={display}
            capabilities={(data.capabilities ?? undefined) as Record<string, unknown> | undefined}
            isAdmin={isAdmin}
            libraryEntries={data.libraryEntries as Record<string, unknown> | undefined}
            thirdParty={data.thirdParty as Record<string, unknown>[] | undefined}
            mappingsV3={data.mappingsV3 as Record<string, unknown>[] | null | undefined}
            thirdPartyFile={thirdPartyFile}
            factsDaily={data.factsDaily}
            types={data.types}
            liPlan={data.planByLineItem}
            creatives={data.creatives}
            notify={data.notify}
            hasVideo={computeHasVideo((data.planByLineItem ?? {}) as Record<string, PacingLineItemPlanV1>)}
            links={data.campaign?.links}
            orderNumber={data.campaign?.orderNumber}
            initialTab={settingsTab}
            initialWidgetId={editWidgetId}
            onWidgetEditorOpened={() => setEditWidgetId(null)}
            customizeLineItemsRequest={customizeLineItems}
            onCustomizeLineItemsOpened={() => setCustomizeLineItems(null)}
            onPreviewChange={setDisplayPreview}
            layoutSessionOpen={layoutMode}
            openLibraryRequest={openLibraryRequest}
            onLibraryOpened={() => setOpenLibraryRequest(null)}
            onSaved={() => queryClient.invalidateQueries({ queryKey: ["pacing", "dashboard", slug] })}
          />

        </PacingStateProvider>
      )}
    </section>
  );
}

