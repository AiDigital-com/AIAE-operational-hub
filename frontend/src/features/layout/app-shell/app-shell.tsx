import { useClerk } from "@clerk/clerk-react";
import { Navigate, Route, Routes, useMatch } from "react-router-dom";
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";
import { SidebarCollapseContext } from "./sidebar-collapse";
import { ApiError } from "../../../shared/api/api-error";
import { useSsoToken } from "../../../shared/auth/useSsoToken";
import { formatError } from "../../../shared/format/error";
import { cn } from "../../../shared/style/cn";
import { LoadingBlock } from "../../../shared/ui/loading-spinner/loading-spinner";
import { isAdminUser, useCurrentUser } from "../../rbac/hooks";
import { AgencyList } from "../../agencies/agency-list";
import { AgencyClients } from "../../clients/agency-clients";
import { Campaigns } from "../../campaigns/campaigns";
import { Overview } from "../../overview/overview";
import { Sidebar } from "../sidebar/sidebar";
import "./app-shell.css";

// Code-split: the admin-only Users Management screen and the campaign workspace (hero/tabs + every
// tab's content) are large enough (and not needed on every visit) to ship as their own chunks instead
// of the main bundle. The workspace's two named exports both resolve from the same dynamic import, so
// Vite still emits one chunk for the module.
const TeamManagement = lazy(() =>
  import("../../team-management/team-management").then((m) => ({ default: m.TeamManagement }))
);
const CampaignWorkspace = lazy(() =>
  import("../../campaigns/campaign-workspace").then((m) => ({ default: m.CampaignWorkspace }))
);
const CampaignTabRedirect = lazy(() =>
  import("../../campaigns/campaign-workspace").then((m) => ({ default: m.CampaignTabRedirect }))
);
const PacingTab = lazy(() => import("../../campaigns/tabs/pacing-tab").then((m) => ({ default: m.PacingTab })));
const SetupTab = lazy(() => import("../../campaigns/tabs/setup-tab").then((m) => ({ default: m.SetupTab })));
const ReportingTab = lazy(() =>
  import("../../campaigns/tabs/reporting-tab").then((m) => ({ default: m.ReportingTab }))
);
const DashboardsTab = lazy(() =>
  import("../../campaigns/tabs/dashboards-tab").then((m) => ({ default: m.DashboardsTab }))
);

function getTimeGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

export function AppShell() {
  const token = useSsoToken();
  const meQuery = useCurrentUser(token.isLoaded && token.isSignedIn && token.ready);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const onToggleCollapsed = useCallback(() => setSidebarCollapsed((current) => !current), []);
  // Shared with the pages inside, so one that needs the width can take it - see SidebarCollapseContext.
  const sidebarCollapse = useMemo(
    () => ({ collapsed: sidebarCollapsed, setCollapsed: setSidebarCollapsed }),
    [sidebarCollapsed]
  );

  // The topbar is greeting-only and only shown on the Overview; search lives in the sidebar (agency/
  // client tree) and locally on each page that needs it (Overview/Campaigns/AgencyClients each own
  // their own search box now — see 01-MIGRATION-PLAN.md S2).
  const isOverview = useMatch("/");
  // Every page built around a wide data table (Overview, the client's Campaigns page - same table
  // component/style - and every campaign workspace tab) wants the full page width, not the app's
  // default reading-width cap - see app-shell.css's `.app__content--wide`.
  const isCampaignsTable = useMatch("/agencies/:agencyId/clients/:clientId");
  const isCampaignWorkspace = useMatch("/campaigns/:campaignId/*");
  const isWide = isOverview || isCampaignsTable || isCampaignWorkspace;

  if (token.error) {
    return <CenteredMessage danger title="Profile cannot be loaded" body={token.error} />;
  }

  if (!token.isLoaded || !token.ready || meQuery.isPending) {
    return <CenteredMessage body="Loading profile" loading />;
  }

  if (meQuery.isError) {
    // A 403 is a deliberate denial (the signed-in identity isn't a provisioned employee), not a
    // failure — show a calm access panel and sign the identity out automatically instead of leaving
    // it stuck on a dead-end screen with no way back to the sign-in page.
    if (meQuery.error instanceof ApiError && meQuery.error.status === 403) {
      return <AccessDeniedAutoSignOut body={formatError(meQuery.error)} />;
    }
    return <CenteredMessage danger title="Profile cannot be loaded" body={formatError(meQuery.error)} />;
  }

  const me = meQuery.data;
  const admin = isAdminUser(me);

  return (
    <SidebarCollapseContext.Provider value={sidebarCollapse}>
    <div className={cn("app", sidebarCollapsed && "app--collapsed")}>
      <Sidebar
        isAdmin={admin}
        user={me}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={onToggleCollapsed}
      />
      <main className="app__main">
        {isOverview && (
          <header className="topbar">
            <div className="topbar__greeting">
              Good {getTimeGreeting()}, <b>{me?.full_name?.split(" ")[0] || "there"}</b> — here's your workspace
            </div>
          </header>
        )}
        <div className={cn("app__content", isWide && "app__content--wide")}>
          <Suspense fallback={<LoadingBlock label="Loading" />}>
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/agencies" element={<AgencyList />} />
              <Route path="/agencies/:agencyId" element={<AgencyClients />} />
              <Route path="/agencies/:agencyId/clients/:clientId" element={<Campaigns />} />
              <Route path="/campaigns/:campaignId" element={<CampaignWorkspace />}>
                <Route index element={<CampaignTabRedirect />} />
                <Route path="pacing" element={<PacingTab />} />
                <Route path="setup" element={<SetupTab />} />
                <Route path="reporting" element={<ReportingTab />} />
                <Route path="dashboards" element={<DashboardsTab />} />
              </Route>
              <Route path="/teams" element={admin ? <TeamManagement /> : <Navigate to="/" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </div>
      </main>
    </div>
    </SidebarCollapseContext.Provider>
  );
}

function CenteredMessage({
  title,
  body,
  danger,
  loading,
  note,
}: {
  title?: string;
  body: string;
  danger?: boolean;
  loading?: boolean;
  note?: string;
}) {
  return (
    <main className="app app--centered">
      <section className={danger ? "message-panel message-panel--danger" : "message-panel"}>
        {title && <h1>{title}</h1>}
        {loading ? <LoadingBlock label={body} /> : <p>{body}</p>}
        {note && <p>{note}</p>}
      </section>
    </main>
  );
}

/** Signs the denied identity out automatically instead of leaving it stuck here: the Sidebar's
 * UserButton (the only in-app sign-out control) never mounts on this early-return branch, so without
 * this there would be no way back to the sign-in page short of clearing cookies. */
function AccessDeniedAutoSignOut({ body }: { body: string }) {
  const { signOut } = useClerk();
  useEffect(() => {
    signOut();
  }, [signOut]);

  return <CenteredMessage title="Access denied" body={body} note="Signing you out…" />;
}
