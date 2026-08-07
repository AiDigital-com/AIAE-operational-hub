import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { formatError } from "../../shared/format/error";
import { useDebounce } from "../../shared/hooks/use-debounce";
import { LoadingBlock, LoadingOverlay, LoadingSpinner } from "../../shared/ui/loading-spinner/loading-spinner";
import { MoreVerticalIcon } from "../../shared/ui/icons/icons";
import { useToast } from "../../shared/ui/toast/toast";
import { listRoleAssignments, listRoles, revokeRole, searchUsers, assignRole } from "../rbac/api";
import { useCurrentUser } from "../rbac/hooks";
import type { HubUserSearchRequestV1, HubUserSummaryV1, RoleV1 } from "../rbac/types";
import { listTeams } from "../teams/api";
import type { TeamV1 } from "../teams/types";
import { SearchFilter } from "./search-filter";
import { StatusBadge } from "./status-badge";
import { TeamSelect } from "./team-select";

const ACTIVE_STATUS = "ACTIVE";
const ADMIN_ROLE_CODE = "ADMIN";
const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

function buildSearchBody(search: string): HubUserSearchRequestV1 {
  return {
    filters: search
      ? [{ field: "FULL_NAME", value: search, operation: "CONTAINS", caseSensitive: false }]
      : [],
    sorting: { field: "FULL_NAME", direction: "ASC" },
  };
}

/**
 * Users tab — a read-only, searchable, paged list of database users. Users are provisioned on login
 * (never created here). Per row, an MPO role can be assigned scoped to an active team.
 */
export function UsersPanel() {
  const queryClient = useQueryClient();
  const meQuery = useCurrentUser(true);
  const [pageNumber, setPageNumber] = useState(1);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, SEARCH_DEBOUNCE_MS);

  // A new (debounced) search resets to the first page — derived synchronously during render (not in
  // an effect reacting to debouncedSearch) so the query key never briefly pairs the stale page with
  // the new search.
  const [lastSearch, setLastSearch] = useState(debouncedSearch);
  if (debouncedSearch !== lastSearch) {
    setLastSearch(debouncedSearch);
    setPageNumber(1);
  }

  const usersQuery = useQuery({
    queryKey: ["rbac", "users", { pageNumber, search: debouncedSearch }],
    queryFn: () => searchUsers(pageNumber, PAGE_SIZE, buildSearchBody(debouncedSearch)),
    placeholderData: keepPreviousData,
  });
  // The roles dictionary never changes within a session; the team list changes rarely and the
  // existing post-mutation invalidateQueries({ queryKey: ["teams"] }) in teams-panel.tsx keeps it
  // fresh after edits. Both would otherwise refetch on every Users↔Teams tab switch, since switching
  // tabs unmounts and remounts this panel.
  const rolesQuery = useQuery({ queryKey: ["dictionary", "roles"], queryFn: listRoles, staleTime: Infinity });
  const teamsQuery = useQuery({ queryKey: ["teams"], queryFn: listTeams, staleTime: 5 * 60_000 });

  // Assignable roles: everything that is not a future/unreleased role (admin included).
  const assignableRoles = useMemo(
    () => (rolesQuery.data ?? []).filter((role) => !role.future),
    [rolesQuery.data]
  );
  // Only active teams can be the scope of a role assignment.
  const activeTeams = useMemo(
    () => (teamsQuery.data ?? []).filter((team) => team.status === ACTIVE_STATUS),
    [teamsQuery.data]
  );

  const page = usersQuery.data;
  const users = page?.content ?? [];
  const totalPages = page?.totalPages ?? 0;
  const totalElements = page?.totalElements ?? 0;
  const refreshing = usersQuery.isFetching && !usersQuery.isPending;

  async function invalidate(editedUserId: number) {
    await queryClient.invalidateQueries({ queryKey: ["rbac", "users"] });
    // Only the current admin's own profile can affect their own session UI (e.g. admin-gating);
    // editing another user's role must not refetch it.
    if (editedUserId === meQuery.data?.hub_user_id) {
      await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    }
  }

  return (
    <>
      <div className="team-card">
        <div className="team-toolbar">
          <div className="team-toolbar__actions">
            <SearchFilter
              value={search}
              onChange={setSearch}
              fieldLabel="Full name"
              ariaLabel="Search users by name"
              placeholder="Search by name…"
            />
          </div>
        </div>

        {usersQuery.isPending && <LoadingBlock label="Loading users" />}
        {usersQuery.isError && <p className="form-error">{formatError(usersQuery.error)}</p>}

        {usersQuery.isSuccess && (
          <div className="team-mgmt__table-wrap" aria-busy={refreshing}>
            <table className="users-tbl">
              <thead>
                <tr>
                  <th>Full Name</th>
                  <th>Email Address</th>
                  <th>Role</th>
                  <th>Team</th>
                  <th>Status</th>
                  <th aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {users.length === 0 && (
                  <tr className="team-mgmt__empty-row">
                    <td colSpan={6}>
                      {totalElements === 0 ? "No users found." : "No users match your search."}
                    </td>
                  </tr>
                )}
                {users.map((user) => (
                  <UserRow
                    key={user.hub_user_id}
                    user={user}
                    roles={assignableRoles}
                    teams={activeTeams}
                    onChanged={() => invalidate(user.hub_user_id)}
                  />
                ))}
              </tbody>
            </table>
            {refreshing && <LoadingOverlay label="Updating users" />}
          </div>
        )}
      </div>

      {usersQuery.isSuccess && (
        <div className="team-mgmt__pagination">
          <span className="team-mgmt__pagination-info">
            {totalElements} {totalElements === 1 ? "user" : "users"} · Page {pageNumber} of {Math.max(totalPages, 1)}
          </span>
          <div className="team-mgmt__pagination-controls">
            <button
              type="button"
              className="button button--secondary button--sm"
              disabled={pageNumber <= 1 || refreshing}
              onClick={() => setPageNumber((current) => Math.max(current - 1, 1))}
            >
              Previous
            </button>
            <button
              type="button"
              className="button button--secondary button--sm"
              disabled={pageNumber >= totalPages || refreshing}
              onClick={() => setPageNumber((current) => current + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function UserRow({
  user,
  roles,
  teams,
  onChanged,
}: {
  user: HubUserSummaryV1;
  roles: RoleV1[];
  teams: TeamV1[];
  onChanged: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [roleCode, setRoleCode] = useState(user.role_code ?? "");
  const [teamId, setTeamId] = useState(user.team_id != null ? String(user.team_id) : "");
  const [menuOpen, setMenuOpen] = useState(false);
  const adminRole = roleCode === ADMIN_ROLE_CODE;
  const removingRole = roleCode === "";

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (event: globalThis.PointerEvent) => {
      if (!(event.target as HTMLElement).closest(".team-mgmt__menu-wrap")) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menuOpen]);

  const assignMutation = useMutation({
    mutationFn: () =>
      assignRole(
        user.hub_user_id,
        adminRole
          ? { role_code: roleCode, scope_code: "ALL" }
          : { role_code: roleCode, scope_code: "TEAM", scope_id: Number(teamId) }
      ),
    onSuccess: async () => {
      await onChanged();
      toast.showSuccess("Role assigned.");
    },
    onError: (error) => toast.showError(formatError(error)),
  });

  const revokeMutation = useMutation({
    mutationFn: async () => {
      const assignments = await listRoleAssignments(user.hub_user_id);
      const active = assignments.filter((assignment) => assignment.status === ACTIVE_STATUS);
      await Promise.all(active.map((assignment) => revokeRole(assignment.user_id, assignment.id)));
    },
    onSuccess: async () => {
      await onChanged();
      toast.showSuccess("Role removed.");
    },
    onError: (error) => toast.showError(formatError(error)),
  });

  const pending = assignMutation.isPending || revokeMutation.isPending;
  // "No role" applies a revoke; admin needs no team; any other role needs a team.
  const canApply = !pending && (removingRole ? Boolean(user.role_code) : adminRole || Boolean(teamId));

  function apply() {
    if (removingRole) revokeMutation.mutate();
    else assignMutation.mutate();
  }

  return (
    <tr>
      <td className="u-name">{user.full_name || "—"}</td>
      <td className="u-email">{user.email}</td>
      <td>
        <span className="select team-mgmt__cell-select">
          <select aria-label={`Role for ${user.full_name || user.email}`} value={roleCode} onChange={(event) => setRoleCode(event.target.value)}>
            <option value="">No role</option>
            {roles.map((role) => (
              <option key={role.id} value={role.role_code}>{role.display_name}</option>
            ))}
          </select>
        </span>
      </td>
      <td>
        <TeamSelect
          teams={teams}
          value={teamId}
          onChange={setTeamId}
          disabled={adminRole}
          ariaLabel={`Team for ${user.full_name || user.email}`}
        />
      </td>
      <td><StatusBadge status={user.status} /></td>
      <td>
        <div className="team-mgmt__actions">
          <button type="button" className="button button--sm" disabled={!canApply} onClick={apply}>
            {pending && <LoadingSpinner size="sm" />}
            Assign role
          </button>
          <div className="team-mgmt__menu-wrap">
            <button
              type="button"
              className="team-mgmt__kebab"
              aria-label={`Actions for ${user.full_name || user.email}`}
              aria-expanded={menuOpen}
              disabled={pending}
              onClick={() => setMenuOpen((current) => !current)}
            >
              <MoreVerticalIcon />
            </button>
            {menuOpen && (
              <div className="team-mgmt__menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  disabled={!user.role_code}
                  onClick={() => { setMenuOpen(false); revokeMutation.mutate(); }}
                >
                  Revoke Role
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); toast.showError("Deactivate user — out of scope for this phase."); }}
                >
                  Deactivate User
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="team-mgmt__menu-danger"
                  onClick={() => { setMenuOpen(false); toast.showError("Delete user — out of scope for this phase."); }}
                >
                  Delete User
                </button>
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}
