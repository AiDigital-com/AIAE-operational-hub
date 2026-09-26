import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatError } from "../../shared/format/error";
import { cn } from "../../shared/style/cn";
import { ChevronLeftIcon, RefreshIcon, SettingsIcon } from "../../shared/ui/icons/icons";
import { LoadingBlock } from "../../shared/ui/loading-spinner/loading-spinner";
import { MarginCell } from "../../shared/ui/margin-cell/margin-cell";
// Money/date helpers shared with the Overview/Pacing tab so the same figures read identically.
import { fmtBudget, fmtDate } from "../pacing/mock/format";
import { PACE_STATUS_COLOR, PACE_STATUS_LABEL } from "../pacing-overview/format";
import { AlertsBlock } from "../pacing-overview/alerts-block";
import type { PacingRowV1 } from "../pacing-overview/types";
import { triggerPacingRefresh } from "./api";
import { StatusControl } from "../pacing-plan/status-control";
import { ContainersTable } from "./containers-table";
import { DailyTable } from "./daily-table";
import { PacingSettingsDrawer } from "./pacing-settings-drawer";
import { fmtInt, fmtMoney, fmtMoneyPrecise } from "./format";
import { isAdminUser, useCurrentUser } from "../rbac/hooks";
import { usePacingDashboard, useRefreshStatus } from "./hooks";
import { computeHasVideo } from "./alerts-panel";
import { JournalPanel } from "./journal/journal-panel";
import type { PacingDataShape, PacingDisplayShape } from "./types";
import type { BrickCtx } from "./widgets/brick-data";
import { WidgetBoard, type WidgetRenderContext } from "./widgets/widget-engine";
import { buildPacingMetrics } from "./engine/build-metrics";
import { buildPacingAlerts } from "./engine/build-alerts";
import { deriveHeroHealth } from "./pacing-dashboard-health";
import { FilterBar } from "./filters/filter-bar";
import { useUrlFilters } from "./filters/use-url-filters";
import type { PacingLineItemPlanV1 } from "../pacing-plan/types";
import "./pacing-dashboard.css";

interface PacingDashboardProps {
  row: PacingRowV1;
  onBack: () => void;
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
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  // The journal's highlighted-entry date (§15 follow-up): clicking a journal row sets this, and any
  // chart view whose own spec carries `journal: true` draws a vertical marker at it. Page-level state,
  // not a store - there is only ever one pacing dashboard mounted at a time.
  const [journalHighlight, setJournalHighlight] = useState<string | null>(null);

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

  const statusStyle = PACE_STATUS_COLOR;

  const data = dashboardQuery.data;
  const { filters, setFilters } = useUrlFilters();

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
  const scalars = metrics?.scalars ?? {};

  const brickCtx: BrickCtx = useMemo(
    () => ({ metrics, currency: data?.campaign?.currency ?? null }),
    [metrics, data]
  );
  const widgetCtx: WidgetRenderContext = useMemo(
    () => ({ brickCtx, metrics, journalHighlight }),
    [brickCtx, metrics, journalHighlight]
  );

  const spendToDate = scalars.sp ?? null;
  const cpmToDate = (metrics?.campaign?.cpm as number | undefined) ?? null;
  const planBudgetTotal = scalars.budget ?? null;
  // Pace/Margin below read this, not `row.*` directly - see pacing-dashboard-health.ts's docblock.
  const heroHealth = deriveHeroHealth(metrics, row);

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
      <button type="button" className="pdash__back" onClick={onBack}>
        <ChevronLeftIcon /> Back to pacings
      </button>

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
            onClick={() => setSettingsOpen(true)}
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

      {/* Pace/Margin are filter-aware (owner ask, 2026-09-25): they read `heroHealth`, derived
          from `metrics.campaign` (`deriveHeroHealth`, `pacing-dashboard-health.ts`) - the SAME
          Scope/Lens split `build-metrics.ts` already applies (a channel/label/selection/range
          filter moves these; a platform/breakdown filter does not, exactly like the widgets
          beside them). Budget/Spend already came from the dashboard query, not `row`, so they are
          unchanged. `paceStatus`/`marginTargetPct` still fall back to `row.*` while `metrics` is
          unavailable (loading, or the pacing is Complete/Archive - see that file's docblock). */}
      <div className="pdash__hero">
        <div className="pdash__hero-card">
          <div className="pdash__hero-label">Pace</div>
          {heroHealth.pacingDeviationPct == null ? (
            <div className="pdash__hero-value pdash__hero-value--na">No data</div>
          ) : (
            <div className="pdash__hero-value" style={{ color: statusStyle[heroHealth.paceStatus] }}>
              {heroHealth.pacingDeviationPct > 0 ? "+" : ""}
              {heroHealth.pacingDeviationPct.toFixed(1)}pp
            </div>
          )}
          <div className="pdash__hero-sub">{PACE_STATUS_LABEL[heroHealth.paceStatus]}</div>
        </div>
        <div className="pdash__hero-card">
          <div className="pdash__hero-label">Margin</div>
          <MarginCell actual={heroHealth.marginActualPct} target={heroHealth.marginTargetPct} className="pdash__hero-margin" />
        </div>
        <div className="pdash__hero-card">
          <div className="pdash__hero-label">Budget</div>
          {/* Reads the SAME filtered source the old subline did (`planBudgetTotal` = `scalars.budget`,
              already Scope-filtered) instead of `row.budgetTotal` (server-computed, unfiltered) - the
              two disagreed under a filter (e.g. `?ch=Display`: "$100.0K" over "Plan total $12.7K" for
              the same card). One figure now, so the subline that used to justify itself against a
              different number is gone - it would just repeat this one (owner ask, 2026-09-25). */}
          <div className="pdash__hero-value">{fmtBudget(planBudgetTotal)}</div>
        </div>
        <div className="pdash__hero-card">
          <div className="pdash__hero-label">Spend to date</div>
          <div className="pdash__hero-value">{fmtMoney(dashboardQuery.isSuccess ? spendToDate : null)}</div>
          <div className="pdash__hero-sub">CPM {fmtMoneyPrecise(cpmToDate)}</div>
        </div>
      </div>

      {/* Was: every alert's full sentence, joined with " · ", one line per severity.
          On a 180-line-item pacing that is a hundred and thirty sentences in a
          single unbroken paragraph. AlertsBlock lays them out the way the retired
          SPA did — numbers first, cards for what is critical, the tail collapsed. */}
      <AlertsBlock alerts={alerts} />

      {dashboardQuery.isPending && <LoadingBlock label="Loading dashboard" />}
      {dashboardQuery.isError && <p className="form-error">{formatError(dashboardQuery.error)}</p>}

      {dashboardQuery.isSuccess && data && (
        <>
          {/* Display-driven (§6 fix, US-114/115): walks `display.widgets[]` -> each widget's own
              spec.views - never a fixed, hardcoded set of charts. Adding/removing a widget in the
              library panel below changes exactly what renders here. */}
          <WidgetBoard
            widgets={((data.display ?? {}) as PacingDisplayShape).widgets ?? []}
            groups={((data.display ?? {}) as PacingDisplayShape).groups ?? []}
            ctx={widgetCtx}
          />

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
            data={data.data as PacingDataShape | undefined}
            display={(data.display ?? {}) as PacingDisplayShape}
            capabilities={(data.capabilities ?? undefined) as Record<string, unknown> | undefined}
            isAdmin={isAdmin}
            renderCtx={widgetCtx}
            libraryEntries={data.libraryEntries as Record<string, unknown> | undefined}
            notify={data.notify}
            hasVideo={computeHasVideo((data.planByLineItem ?? {}) as Record<string, PacingLineItemPlanV1>)}
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

          <ContainersTable metrics={metrics} />

          <DailyTable metrics={metrics} />
        </>
      )}
    </section>
  );
}

