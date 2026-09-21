import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatError } from "../../shared/format/error";
import { cn } from "../../shared/style/cn";
import { ChevronLeftIcon, RefreshIcon } from "../../shared/ui/icons/icons";
import { LoadingBlock } from "../../shared/ui/loading-spinner/loading-spinner";
import { MarginCell } from "../../shared/ui/margin-cell/margin-cell";
// Money/date helpers shared with the Overview/Pacing tab so the same figures read identically.
import { fmtBudget, fmtDate } from "../pacing/mock/format";
import { PACE_STATUS_COLOR, PACE_STATUS_LABEL } from "../pacing-overview/format";
import { AlertsBlock } from "../pacing-overview/alerts-block";
import type { PacingRowV1 } from "../pacing-overview/types";
import { savePacingDisplay, triggerPacingRefresh } from "./api";
import { PacingPlanSheet } from "../pacing-plan/pacing-plan-sheet";
import { StatusControl } from "../pacing-plan/status-control";
import { Sheet } from "../../shared/ui/sheet/sheet";
import { ContainersTable } from "./containers-table";
import { DailyTable } from "./daily-table";
import { PacingDashboardLibrary } from "./pacing-dashboard-library";
import { fmtInt, fmtMoney, fmtMoneyPrecise } from "./format";
import { isAdminUser, useCurrentUser } from "../rbac/hooks";
import { usePacingDashboard, useRefreshStatus } from "./hooks";
import type { PacingDisplayShape, PacingWidgetGroup, PacingWidgetInstance } from "./types";
import type { BrickCtx } from "./widgets/brick-data";
import { WidgetBoard, type WidgetRenderContext } from "./widgets/widget-engine";
import type { PacingMetricsBag } from "./types-metrics";
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

  const [libraryOpen, setLibraryOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
  const paceStatus = row.paceStatus ?? "no_data";
  const alerts = row.alerts;

  const data = dashboardQuery.data;

  // Everything below is READ, not derived. Pacing computes this pacing's figures
  // with the one engine that has always computed them (shared/dashboard-metrics.js)
  // and sends them on `metrics`; this screen draws what it is given. A second
  // implementation over here is what the previous pass had, and it reported a
  // larger delivery than Pacing did because it summed fact rows that fall outside
  // a line item's flight — the sort of disagreement that is invisible until
  // somebody reconciles a number against the service.
  const metrics = (data?.metrics ?? null) as PacingMetricsBag | null;
  const scalars = metrics?.scalars ?? {};

  const brickCtx: BrickCtx = useMemo(
    () => ({ metrics, currency: data?.campaign?.currency ?? null }),
    [metrics, data]
  );
  const widgetCtx: WidgetRenderContext = useMemo(() => ({ brickCtx, metrics }), [brickCtx, metrics]);

  const spendToDate = scalars.sp ?? null;
  const cpmToDate = (metrics?.campaign?.cpm as number | undefined) ?? null;
  const planBudgetTotal = scalars.budget ?? null;

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

  async function handleSaveDisplay(patch: { widgets: PacingWidgetInstance[]; groups: PacingWidgetGroup[] }) {
    if (!slug || !data) return;
    setSaving(true);
    setSaveError(null);
    const currentDisplay = (data.display ?? {}) as PacingDisplayShape;
    const nextDisplay = { ...currentDisplay, widgets: patch.widgets, groups: patch.groups };
    const displayRev = currentDisplay.rev ?? 0;
    try {
      const outcome = await savePacingDisplay(
        slug,
        nextDisplay,
        displayRev,
        (data.capabilities ?? undefined) as Record<string, unknown> | undefined
      );
      if (outcome.status === "conflict") {
        setSaveError(
          outcome.conflict.reason === "stale_settings"
            ? "This pacing's layout changed elsewhere. Reload to see the latest before editing again."
            : "The editor needs to reload before saving again."
        );
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["pacing", "dashboard", slug] });
    } catch (error) {
      setSaveError(formatError(error));
    } finally {
      setSaving(false);
    }
  }

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
            onClick={() => setPlanOpen(true)}
          >
            Edit plan
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
          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={() => setLibraryOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={libraryOpen}
          >
            Widgets
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

      <div className="pdash__hero">
        <div className="pdash__hero-card">
          <div className="pdash__hero-label">Pace</div>
          {row.pacingDeviationPct == null ? (
            <div className="pdash__hero-value pdash__hero-value--na">No data</div>
          ) : (
            <div className="pdash__hero-value" style={{ color: statusStyle[paceStatus] }}>
              {row.pacingDeviationPct > 0 ? "+" : ""}
              {row.pacingDeviationPct.toFixed(1)}pp
            </div>
          )}
          <div className="pdash__hero-sub">{PACE_STATUS_LABEL[paceStatus]}</div>
        </div>
        <div className="pdash__hero-card">
          <div className="pdash__hero-label">Margin</div>
          <MarginCell actual={row.marginActualPct ?? null} target={row.marginTargetPct ?? 0} className="pdash__hero-margin" />
        </div>
        <div className="pdash__hero-card">
          <div className="pdash__hero-label">Budget</div>
          <div className="pdash__hero-value">{fmtBudget(row.budgetTotal ?? 0)}</div>
          <div className="pdash__hero-sub">Plan total {fmtBudget(planBudgetTotal)}</div>
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

          {/* Composing the dashboard is a slide-over, not a section of the page.
              The retired SPA made the same call — SettingsDrawer.jsx is a modal
              dialog holding Display alongside Pacing, Data and Notifications —
              and for the same reason: choosing widgets is something a person
              does occasionally, while reading the figures is what they came for.
              Inline, the panel spent screen on a tool most viewers never open,
              and read as part of the data rather than as settings for it. */}
          <Sheet
            open={libraryOpen}
            onClose={() => setLibraryOpen(false)}
            title="Widgets"
            className="pdash__library-sheet"
          >
            <PacingDashboardLibrary
              display={(data.display ?? {}) as PacingDisplayShape}
              saving={saving}
              saveError={saveError}
              onSave={handleSaveDisplay}
              isAdmin={isAdmin}
            />
          </Sheet>

          <PacingPlanSheet
            open={planOpen}
            onClose={() => setPlanOpen(false)}
            slug={slug ?? ""}
            currency={data.campaign?.currency ?? "USD"}
            planByLineItem={(data.planByLineItem ?? {}) as Record<string, PacingLineItemPlanV1>}
          />

          {data.journal.length > 0 && (
            <section className="pdash__section">
              <h2 className="pdash__section-title">Journal</h2>
              <ul className="pdash__journal">
                {data.journal.map((entry) => (
                  <li key={entry.id} className="pdash__journal-item">
                    <span className="pdash__journal-meta">
                      {entry.ts} {entry.uid ? `· ${entry.uid}` : ""}
                    </span>
                    <span className="pdash__journal-msg">{entry.msg}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <ContainersTable metrics={metrics} />

          <DailyTable metrics={metrics} />
        </>
      )}
    </section>
  );
}

