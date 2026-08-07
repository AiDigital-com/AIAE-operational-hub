import { useEffect } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useParams } from "react-router-dom";
import { formatError } from "../../shared/format/error";
import { campaignDisplayName } from "../../shared/format/names";
import { cn } from "../../shared/style/cn";
import { LoadingBlock } from "../../shared/ui/loading-spinner/loading-spinner";
import { displayStatusLabel, resolveStatusStyle } from "../../shared/ui/status-badge/status-badge";
import { useCampaign } from "./hooks";
import type { CampaignV1 } from "./types";
import "./campaign-workspace.css";

interface WorkspaceState {
  campaign?: CampaignV1;
  agencyId?: number;
  agencyName?: string;
  clientId?: number;
  clientName?: string;
}

/** Passed down to each tab route via `<Outlet context>`; read with `useOutletContext<CampaignTabContext>()`. */
export interface CampaignTabContext {
  campaign: CampaignV1;
  agencyId?: number;
  agencyName?: string;
  clientId?: number;
  clientName?: string;
}

const TABS = ["setup", "pacing", "reporting", "dashboards"] as const;
type Tab = (typeof TABS)[number];
// Pacing and Dashboards are mock-only data - hidden from the nav for now. Their routes/tabs still
// exist (so a stale session-stored tab or a direct link still works), they are just not offered as
// places to navigate to.
const HIDDEN_TABS = new Set<Tab>(["pacing", "dashboards"]);
const VISIBLE_TABS = TABS.filter((tab) => !HIDDEN_TABS.has(tab));
const DEFAULT_TAB: Tab = "reporting";

function sessionTabKey(campaignId: string): string {
  return `oph.campaign-tab.${campaignId}`;
}

function isTab(value: string | null): value is Tab {
  return (TABS as readonly string[]).includes(value ?? "");
}

/**
 * The index route for `/campaigns/:campaignId` — redirects to the last tab this campaign was viewed
 * on this session (US-008: "tab state persists within the session"), defaulting to Pacing.
 */
export function CampaignTabRedirect() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const location = useLocation();
  const stored = campaignId ? sessionStorage.getItem(sessionTabKey(campaignId)) : null;
  // <Navigate> drops the current location's state unless it's explicitly forwarded, which would lose
  // the campaign carried in via router state on the very first render of this route.
  return <Navigate to={isTab(stored) ? stored : DEFAULT_TAB} replace state={location.state} />;
}

function formatDate(date?: string | null): string {
  if (!date) return "—";
  const d = new Date(date);
  if (isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function clientListRoute(state: WorkspaceState): string {
  if (state.agencyId == null || state.clientId == null) {
    return "/agencies";
  }
  const clientName = state.clientName?.trim();
  const search = clientName ? `?clientName=${encodeURIComponent(clientName)}` : "";
  return `/agencies/${state.agencyId}/clients/${state.clientId}${search}`;
}

/**
 * The campaign layout route: hero (title, agency/client eyebrow, status + flight-date pills) and the
 * Setup/Pacing/Reporting/Dashboards tab bar (US-007, US-008), rendering the active tab via
 * `<Outlet/>`. The active tab is derived from the URL and persisted per campaign for the session.
 *
 * Opening the workspace from a list (Overview, the Campaigns table) carries the campaign along in
 * router state, so no request is needed. Any other entry path — a pasted link, a bookmark, a new tab,
 * a restored session — carries no state, and the campaign is fetched by id instead (`useCampaign`).
 * The agency/client eyebrow and breadcrumbs come only from that state, so they stay absent on a deep
 * link; the campaign's own hero and tabs work either way.
 */
export function CampaignWorkspace() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const location = useLocation();
  const state = (location.state as WorkspaceState | null) ?? {};
  const numericId = campaignId ? Number(campaignId) : undefined;
  const { campaign, isPending, isError, error } = useCampaign(numericId, state.campaign);

  const activeTab = TABS.find((tab) => location.pathname.endsWith(`/${tab}`));

  useEffect(() => {
    if (campaignId && activeTab) {
      sessionStorage.setItem(sessionTabKey(campaignId), activeTab);
    }
  }, [campaignId, activeTab]);

  if (isPending) {
    return <LoadingBlock label="Loading campaign" />;
  }

  if (isError || !campaign) {
    return (
      <section className="campaign-ws">
        <p className="campaign-ws__note">
          {isError
            ? formatError(error)
            : "This campaign couldn't be found, or you don't have access to it."}{" "}
          <Link to="/agencies">Go to Agencies</Link> to browse the campaigns you can open.
        </p>
      </section>
    );
  }

  const name = campaignDisplayName(campaign.name);
  const statusStyle = resolveStatusStyle(campaign.status);
  const eyebrow = [state.agencyName, state.clientName].filter(Boolean).join(" · ");

  return (
    <section className="campaign-ws">
      <div className="campaign-ws__crumbs">
        <Link to="/agencies" className="campaign-ws__crumbs-link">Agencies</Link>
        {state.agencyName && state.agencyId != null && (
          <>
            <span className="campaign-ws__crumbs-sep">›</span>
            <Link
              to={`/agencies/${state.agencyId}`}
              state={{ agencyName: state.agencyName }}
              className="campaign-ws__crumbs-link"
            >
              {state.agencyName}
            </Link>
          </>
        )}
        {state.clientName && state.clientId != null && (
          <>
            <span className="campaign-ws__crumbs-sep">›</span>
            <Link
              to={clientListRoute(state)}
              state={{ clientName: state.clientName, agencyId: state.agencyId, agencyName: state.agencyName }}
              className="campaign-ws__crumbs-link"
            >
              {state.clientName}
            </Link>
          </>
        )}
        <span className="campaign-ws__crumbs-sep">›</span>
        <span className="campaign-ws__crumbs-cur">{name}</span>
        {activeTab && (
          <>
            <span className="campaign-ws__crumbs-sep">›</span>
            <span className="campaign-ws__crumbs-cur">{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}</span>
          </>
        )}
      </div>

      <header className="campaign-ws__hero">
        <h1 className="campaign-ws__title">{name}</h1>
        {eyebrow && <div className="campaign-ws__hero-sub">{eyebrow}</div>}
        <div className="campaign-ws__pills">
          {campaign.status && (
            <span className="campaign-ws__pill">
              <span className="campaign-ws__pill-led" style={{ background: statusStyle.color }} />
              {displayStatusLabel(campaign.status).toUpperCase()}
            </span>
          )}
          {(campaign.start_date || campaign.end_date) && (
            <span className="campaign-ws__pill campaign-ws__pill--date">
              {formatDate(campaign.start_date)} — {formatDate(campaign.end_date)}
            </span>
          )}
        </div>
      </header>

      <nav className="campaign-ws__tabs" aria-label="Campaign sections">
        {VISIBLE_TABS.map((tab) => (
          <NavLink
            key={tab}
            to={tab}
            // A plain relative link drops the current location's state by default - forward it
            // explicitly so switching tabs doesn't lose the campaign the hero above depends on.
            state={location.state}
            className={({ isActive }) => cn("campaign-ws__tab", isActive && "campaign-ws__tab--active")}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </NavLink>
        ))}
      </nav>

      <Outlet
        context={{
          campaign,
          agencyId: state.agencyId,
          agencyName: state.agencyName,
          clientId: state.clientId,
          clientName: state.clientName,
        } satisfies CampaignTabContext}
      />
    </section>
  );
}
