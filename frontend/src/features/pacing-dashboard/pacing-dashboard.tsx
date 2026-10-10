import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatError } from "../../shared/format/error";
import { cn } from "../../shared/style/cn";
import { ChevronLeftIcon, RefreshIcon, SettingsIcon } from "../../shared/ui/icons/icons";
import { LoadingBlock } from "../../shared/ui/loading-spinner/loading-spinner";
// Date helper shared with the Overview/Pacing tab so the same figures read identically.
import { fmtDate } from "../pacing/mock/format";
import { AlertsBlock } from "../pacing-overview/alerts-block";
import type { PacingRowV1 } from "../pacing-overview/types";
import {
  getPacingThirdPartyData,
  getPacingThirdPartyStatus,
  savePacingDisplay,
  triggerPacingRefresh,
} from "./api";
import { StatusControl } from "../pacing-plan/status-control";
import { DailyTable } from "./daily-table";
import { PacingSettingsDrawer } from "./pacing-settings-drawer";
import { DocumentsChips } from "./documents/documents-chips";
import type { SettingsTabId } from "./settings-section";
import { fmtInt } from "./format";
import { isAdminUser, useCurrentUser } from "../rbac/hooks";
import { usePacingDashboard, useRefreshStatus } from "./hooks";
import { computeHasVideo } from "./alerts-panel";
import { JournalPanel } from "./journal/journal-panel";
import type { PacingDataShape, PacingDisplayShape } from "./types";
import { ReportBoard } from "./widgets/report-board";
// Moved JS from Pacing's SPA - typed by inference under `allowJs` (see spa/SOURCE.md).
import { PacingStateProvider, setPacingApi, usePacingState } from "./spa/store.js";
import { WIDGET_CAP, copyWidget, setTileEnabled, tileTitle, withWidgetRemoved } from "./widgets/widget-tiles";
import { resolveWidget } from "./pacing-dashboard-library";
import { buildPacingMetrics } from "./engine/build-metrics";
import { buildPacingAlerts } from "./engine/build-alerts";
import { BreakdownPanel } from "./breakdown/breakdown-panel";
import { FilterBar } from "./filters/filter-bar";
import { useUrlFilters } from "./filters/use-url-filters";
import type { PacingLineItemPlanV1 } from "../pacing-plan/types";
import "./pacing-dashboard.css";


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
 * The Daily Performance table below the charts is §7, in daily-table.tsx.
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

  // Computed HERE now, not read off `row.alerts` (owner ask, 2026-09-25, filters follow-up item 3):
  // `row.alerts` is `dash-gate/lib/health.mjs`'s server-computed alert list for the WHOLE pacing -
  // no URL filter ever reaches it, so it used to sit still while every other figure on the page
  // moved under a filter. `buildPacingAlerts` (`./engine/build-alerts.ts`) is the browser port of
  // the retired SPA's own `computeDashboardAlerts`, sharing `buildPacingMetrics`'s engine and its
  // `effLIs` Scope split - a Scope filter changes the alert set, a Lens filter does not, same as the
  // KPI strip below. Falls back to `row.alerts` while the dashboard query has not resolved yet (no
  // engine input to compute from), so the block does not flash empty then fill in on every open.
  const alerts = useMemo(
    () => (data ? buildPacingAlerts(data, filters) : (row.alerts ?? [])),
    [data, filters, row.alerts]
  );

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


  const display = useMemo(() => (data?.display ?? {}) as PacingDisplayShape, [data]);

  /**
   * What Pacing's own renderer reads its figures from (`spa/store.js`). Assembled here because this
   * is where the payload and the URL filters already are; `usePacingState` does the shaping the SPA
   * store used to do on load — `normalize()` into the terse plan, and the per-line-item per-day
   * aggregate `useWidgetData` refuses to work without.
   */
  const widgetActions = useMemo(
    () => ({
      /**
       * The renderer's only write: a tile's saved period and a Projection control's mode. Both are
       * per-viewer preference maps, which dash-gate merges per entry rather than replacing - so this
       * sends the patch alone and carries no `displayRev`, exactly as the per-entry lane expects. A
       * failure is reported, never swallowed: the control would otherwise spring back with no reason
       * given.
       */
      saveSettings: async (_slug: string, patch: { display?: Record<string, unknown> }) => {
        if (!slug || !patch?.display) return;
        const outcome = await savePacingDisplay(
          slug,
          patch.display,
          Number((data?.display as PacingDisplayShape | undefined)?.rev ?? 0),
          data?.capabilities as Record<string, unknown> | undefined
        );
        if (outcome.status === "conflict") {
          throw new Error("This pacing's layout changed elsewhere. Reload before changing it again.");
        }
        queryClient.invalidateQueries({ queryKey: ["pacing", "dashboard", slug] });
      },
    }),
    [slug, data, queryClient]
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
    });
  }, [slug]);

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
  const boardActions = useMemo(() => {
    const widgetsOf = () => (display.widgets ?? []);
    const commit = async (patch: Record<string, unknown>) => {
      if (!slug) return;
      setBoardSaving(true);
      try {
        const outcome = await savePacingDisplay(
          slug,
          { ...display, ...patch },
          Number(display.rev ?? 0),
          data?.capabilities as Record<string, unknown> | undefined
        );
        if (outcome.status === "conflict") {
          setRefreshError("This pacing's layout changed elsewhere. Reload before changing it again.");
          return;
        }
        queryClient.invalidateQueries({ queryKey: ["pacing", "dashboard", slug] });
      } catch (error) {
        setRefreshError(formatError(error));
      } finally {
        setBoardSaving(false);
      }
    };
    return {
      saving: boardSaving,
      onEdit: (widgetId: string) => {
        setSettingsTab("widgets");
        setSettingsOpen(true);
        setEditWidgetId(widgetId);
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
      onTurnOff: (widgetId: string) =>
        void commit({ enabled: setTileEnabled(display.enabled, widgetId, false) }),
      onRemove: (widgetId: string) =>
        void commit(withWidgetRemoved(widgetsOf(), display.groups ?? [], display.enabled, widgetId)),
    };
  }, [slug, display, data, queryClient, boardSaving]);

  const pacingState = usePacingState({
    data,
    urlFilters,
    actions: widgetActions,
    journalHighlight,
  });

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
            className="button button--ghost button--sm"
            onClick={() => {
              setSettingsTab(null);
              setSettingsOpen(true);
            }}
            aria-haspopup="dialog"
            aria-expanded={settingsOpen}
            title="Pacing settings"
          >
            <SettingsIcon />
            Settings
          </button>
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
      {dashboardQuery.isSuccess && data && (
        <FilterBar
          filters={filters}
          setFilters={setFilters}
          liPlan={(data.planByLineItem ?? {}) as Record<string, PacingLineItemPlanV1>}
          factsDaily={data.factsDaily}
          minDate={data.campaign?.startDate}
          maxDate={metrics?.asOf ?? data.campaign?.endDate}
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

      {/* Was: every alert's full sentence, joined with " · ", one line per severity.
          On a 180-line-item pacing that is a hundred and thirty sentences in a
          single unbroken paragraph. AlertsBlock lays them out the way the retired
          SPA did — numbers first, cards for what is critical, the tail collapsed. */}
      <AlertsBlock alerts={alerts} />

      {dashboardQuery.isPending && <LoadingBlock label="Loading dashboard" />}
      {dashboardQuery.isError && <p className="form-error">{formatError(dashboardQuery.error)}</p>}

      {dashboardQuery.isSuccess && data && (
        /* Everything that draws a widget sits under this: the board, and the settings drawer, whose
           library cards render the SAME renderer at thumbnail size. One provider, so a card and the
           tile it stands for read the same figures by construction. */
        <PacingStateProvider value={pacingState}>
          {/* Display-driven (§6 fix, US-114/115): walks `display.widgets[]` -> each widget's own
              spec.views - never a fixed, hardcoded set of charts. Adding/removing a widget in the
              library panel below changes exactly what renders here. */}
          {/* Pacing's own renderer on Pacing's own grid, fed by the seam above. The board takes the
              whole `display` rather than a filtered widget list: the switched-off drop happens AFTER
              placement inside it, so a hidden tile's neighbours do not slide into its cell and
              refuse to slide back when it is switched on again. */}
          <ReportBoard display={display} actions={boardActions} />

          {/* Where the delivery above actually went, one tab per dimension this pacing carries.
              Sits with the charts rather than down by the tables because it answers the same kind
              of question they do — and because a click in it filters every one of them. */}
          <BreakdownPanel data={data} filters={filters} setFilters={setFilters} />

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
            slug={slug ?? ""}
            currency={data.campaign?.currency ?? "USD"}
            planByLineItem={(data.planByLineItem ?? {}) as Record<string, PacingLineItemPlanV1>}
            conversions={data.conversions as Array<Record<string, unknown>> | undefined}
            data={data.data as PacingDataShape | undefined}
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
            onSaved={() => queryClient.invalidateQueries({ queryKey: ["pacing", "dashboard", slug] })}
          />

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

          <DailyTable metrics={metrics} />
        </PacingStateProvider>
      )}
    </section>
  );
}

