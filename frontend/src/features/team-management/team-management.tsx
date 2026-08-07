import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { formatError } from "../../shared/format/error";
import { cn } from "../../shared/style/cn";
import { LoadingSpinner } from "../../shared/ui/loading-spinner/loading-spinner";
import { useToast } from "../../shared/ui/toast/toast";
import { searchUsers } from "../rbac/api";
import { searchTeams, syncNetSuite } from "../teams/api";
import { TeamsPanel } from "./teams-panel";
import { UsersPanel } from "./users-panel";
import "./team-management.css";

type Tab = "users" | "teams";

/**
 * Users Management screen (reached via the "Team" menu). Two tabs: Users — a read-only list of the
 * organization's database users (users are provisioned on login, never created here) — and Teams —
 * the application's teams, which can be created and edited.
 */
export function TeamManagement() {
  const [tab, setTab] = useState<Tab>("users");
  const queryClient = useQueryClient();
  const toast = useToast();

  // Tab counts. Each badge is a tiny one-row paged request reused for its total, so neither tab has to
  // load a full list just to show a count (the Teams tab pages its list; the Users tab loads all teams
  // only for the role-assignment dropdown). A long staleTime keeps a revisit to /teams from repeating
  // these on top of the visible panel's own page-1 request; the sync/create/update mutations below
  // already invalidate the ["rbac","users"] and ["teams"] prefixes these keys fall under, so an edit
  // still refreshes the badge.
  const usersCountQuery = useQuery({
    queryKey: ["rbac", "users", "count"],
    queryFn: () => searchUsers(1, 1, { filters: [], sorting: { field: "FULL_NAME", direction: "ASC" } }),
    select: (page) => page.totalElements,
    staleTime: 5 * 60_000,
  });
  const teamsCountQuery = useQuery({
    queryKey: ["teams", "count"],
    queryFn: () => searchTeams(1, 1, {}),
    select: (page) => page.totalElements,
    staleTime: 5 * 60_000,
  });

  // Admin-only eager sync of users/teams/assignments from NetSuite/Rippling. The whole /teams route
  // is admin-gated, so reaching this button already implies the manage-roles permission.
  const syncMutation = useMutation({
    mutationFn: syncNetSuite,
    onSuccess: async (summary) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["teams"] }),
        queryClient.invalidateQueries({ queryKey: ["rbac", "users"] }),
      ]);
      toast.showSuccess(
        `Synced ${summary.teams} teams, ${summary.users} users, ${summary.assignmentsUpdated} assignments updated, ` +
          `${summary.agenciesMapped} agencies mapped.`
      );
    },
    onError: (error) => toast.showError(formatError(error)),
  });

  const usersCount = usersCountQuery.data;
  const teamsCount = teamsCountQuery.data;

  return (
    <section className="team-mgmt">
      <div className="team-mgmt__header">
        <div>
          <h1 className="team-mgmt__title">Users Management</h1>
          <p className="team-mgmt__subtitle">View and manage your organization users and teams.</p>
        </div>
        <button
          type="button"
          className="button button--secondary button--sm"
          disabled={syncMutation.isPending}
          onClick={() => syncMutation.mutate()}
        >
          {syncMutation.isPending && <LoadingSpinner size="sm" />}
          Sync from BQ
        </button>
      </div>

      <div className="team-mgmt__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "users"}
          className={cn("team-mgmt__tab", tab === "users" && "team-mgmt__tab--active")}
          onClick={() => setTab("users")}
        >
          Users
          {usersCountQuery.isPending && <LoadingSpinner size="sm" />}
          {usersCount !== undefined && <span className="team-mgmt__tab-count">{usersCount}</span>}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "teams"}
          className={cn("team-mgmt__tab", tab === "teams" && "team-mgmt__tab--active")}
          onClick={() => setTab("teams")}
        >
          Teams
          {teamsCountQuery.isPending && <LoadingSpinner size="sm" />}
          {teamsCount !== undefined && <span className="team-mgmt__tab-count">{teamsCount}</span>}
        </button>
      </div>

      {tab === "users" ? <UsersPanel /> : <TeamsPanel />}
    </section>
  );
}
