import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { formatError } from "../../shared/format/error";
import { useDebounce } from "../../shared/hooks/use-debounce";
import { LoadingBlock, LoadingOverlay, LoadingSpinner } from "../../shared/ui/loading-spinner/loading-spinner";
import { MoreVerticalIcon } from "../../shared/ui/icons/icons";
import { useToast } from "../../shared/ui/toast/toast";
import { createTeam, searchTeams, updateTeam } from "../teams/api";
import type { TeamV1 } from "../teams/types";
import { SearchFilter } from "./search-filter";
import { StatusBadge } from "./status-badge";

const ACTIVE_STATUS = "ACTIVE";
const INACTIVE_STATUS = "INACTIVE";
const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

interface TeamFormState {
  team_name: string;
  pod_key: string;
  status: string;
}

const EMPTY_TEAM: TeamFormState = { team_name: "", pod_key: "", status: ACTIVE_STATUS };

/**
 * Teams tab — the application's teams, fetched with server-side paging and name search (like the
 * Users tab). Teams can be created (status defaults to active) and edited, and their status toggled
 * from the per-row actions menu.
 */
export function TeamsPanel() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [pageNumber, setPageNumber] = useState(1);
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [teamSearch, setTeamSearch] = useState("");
  const [form, setForm] = useState<TeamFormState>(EMPTY_TEAM);
  const debouncedSearch = useDebounce(teamSearch, SEARCH_DEBOUNCE_MS);

  // A new (debounced) search resets to the first page — derived synchronously during render (not in
  // an effect reacting to debouncedSearch) so the query key never briefly pairs the stale page with
  // the new search.
  const [lastSearch, setLastSearch] = useState(debouncedSearch);
  if (debouncedSearch !== lastSearch) {
    setLastSearch(debouncedSearch);
    setPageNumber(1);
  }

  useEffect(() => {
    if (openMenuId === null) return undefined;
    const onDown = (event: globalThis.PointerEvent) => {
      if (!(event.target as HTMLElement).closest(".team-mgmt__menu-wrap")) setOpenMenuId(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [openMenuId]);

  const teamsQuery = useQuery({
    queryKey: ["teams", "search", { pageNumber, search: debouncedSearch }],
    queryFn: () => searchTeams(pageNumber, PAGE_SIZE, debouncedSearch ? { name: debouncedSearch } : {}),
    placeholderData: keepPreviousData,
  });

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: ["teams"] });
  }

  const createMutation = useMutation({
    mutationFn: createTeam,
    onSuccess: async () => {
      await invalidate();
      closeForm();
      toast.showSuccess("Team created.");
    },
    onError: (error) => toast.showError(formatError(error)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: TeamFormState }) => updateTeam(id, body),
    onSuccess: async () => {
      await invalidate();
      closeForm();
      toast.showSuccess("Team updated.");
    },
    onError: (error) => toast.showError(formatError(error)),
  });

  function startCreate() {
    setEditingId(null);
    setOpenMenuId(null);
    setForm(EMPTY_TEAM);
    setIsCreating(true);
  }

  function startEdit(team: TeamV1) {
    setIsCreating(false);
    setOpenMenuId(null);
    setEditingId(team.id ?? null);
    setForm({ team_name: team.team_name ?? "", pod_key: team.pod_key ?? "", status: team.status ?? ACTIVE_STATUS });
  }

  function closeForm() {
    setIsCreating(false);
    setEditingId(null);
    setForm(EMPTY_TEAM);
  }

  function submit() {
    if (!form.team_name.trim()) return;
    if (isCreating) {
      createMutation.mutate({ team_name: form.team_name.trim(), pod_key: form.pod_key.trim(), status: ACTIVE_STATUS });
    } else if (editingId !== null) {
      updateMutation.mutate({ id: editingId, body: { ...form, status: form.status || ACTIVE_STATUS } });
    }
  }

  function toggleStatus(team: TeamV1) {
    if (team.id == null) return;
    setOpenMenuId(null);
    const nextStatus = team.status === ACTIVE_STATUS ? INACTIVE_STATUS : ACTIVE_STATUS;
    updateMutation.mutate({
      id: team.id,
      body: { team_name: team.team_name ?? "", pod_key: team.pod_key ?? "", status: nextStatus },
    });
  }

  const page = teamsQuery.data;
  const teams = page?.content ?? [];
  const totalPages = page?.totalPages ?? 0;
  const totalElements = page?.totalElements ?? 0;
  const isPending = createMutation.isPending || updateMutation.isPending;
  const refreshing = teamsQuery.isFetching && !teamsQuery.isPending;

  function editableRow(key: string, status: string) {
    const onEnter = (event: React.KeyboardEvent) => {
      if (event.key === "Enter") submit();
    };
    return (
      <tr key={key}>
        <td>
          <input
            className="team-mgmt__input"
            aria-label="Team name"
            placeholder="Team name"
            value={form.team_name}
            onKeyDown={onEnter}
            onChange={(event) => setForm((current) => ({ ...current, team_name: event.target.value }))}
            autoFocus
          />
        </td>
        <td>
          <input
            className="team-mgmt__input"
            aria-label="Pod key"
            placeholder="Pod key"
            value={form.pod_key}
            onKeyDown={onEnter}
            onChange={(event) => setForm((current) => ({ ...current, pod_key: event.target.value }))}
          />
        </td>
        <td><StatusBadge status={status} /></td>
        <td>
          <div className="team-mgmt__actions">
            <button type="button" className="button button--cta button--sm" disabled={isPending} onClick={submit}>
              {isPending && <LoadingSpinner size="sm" />}
              Save
            </button>
            <button type="button" className="button button--secondary button--sm" onClick={closeForm}>Cancel</button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <>
      <div className="team-card">
        <div className="team-toolbar">
          <div className="team-toolbar__actions">
            <SearchFilter
              value={teamSearch}
              onChange={setTeamSearch}
              fieldLabel="Team name"
              ariaLabel="Search teams by name"
              placeholder="Search teams…"
            />
            {!isCreating && editingId === null && (
              <button type="button" className="button button--cta button--sm" onClick={startCreate}>
                Create New
              </button>
            )}
          </div>
        </div>

        {teamsQuery.isPending && <LoadingBlock label="Loading teams" />}
        {teamsQuery.isError && <p className="form-error">{formatError(teamsQuery.error)}</p>}

        {teamsQuery.isSuccess && (
          <div className="team-mgmt__table-wrap" aria-busy={refreshing}>
            <table className="users-tbl">
              <thead>
                <tr>
                  <th>Team Name</th>
                  <th>Pod Key</th>
                  <th>Status</th>
                  <th aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {isCreating && editableRow("new", ACTIVE_STATUS)}

                {teams.length === 0 && !isCreating && (
                  <tr className="team-mgmt__empty-row">
                    <td colSpan={4}>{debouncedSearch ? "No teams match your search." : "No teams found."}</td>
                  </tr>
                )}

                {teams.map((team) =>
                  editingId === team.id
                    ? editableRow(String(team.id), form.status)
                    : (
                      <tr key={team.id}>
                        <td className="u-name">
                          {team.team_name || "—"}
                          {team.fromNetSuite && <span className="team-mgmt__source-tag">NetSuite</span>}
                        </td>
                        <td className="u-email">{team.pod_key || "—"}</td>
                        <td><StatusBadge status={team.status} /></td>
                        <td>
                          {!team.fromNetSuite && (
                            <div className="team-mgmt__menu-wrap">
                              <button
                                type="button"
                                className="team-mgmt__kebab"
                                aria-label={`Actions for ${team.team_name}`}
                                aria-expanded={openMenuId === team.id}
                                disabled={isPending}
                                onClick={() => setOpenMenuId((current) => (current === team.id ? null : team.id ?? null))}
                              >
                                <MoreVerticalIcon />
                              </button>
                              {openMenuId === team.id && (
                                <div className="team-mgmt__menu" role="menu">
                                  <button type="button" role="menuitem" onClick={() => startEdit(team)}>Edit</button>
                                  <button type="button" role="menuitem" onClick={() => toggleStatus(team)}>
                                    {team.status === ACTIVE_STATUS ? "Deactivate" : "Activate"}
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                )}
              </tbody>
            </table>
            {refreshing && <LoadingOverlay label="Updating teams" />}
          </div>
        )}
      </div>

      {teamsQuery.isSuccess && (
        <div className="team-mgmt__pagination">
          <span className="team-mgmt__pagination-info">
            {totalElements} {totalElements === 1 ? "team" : "teams"} · Page {pageNumber} of {Math.max(totalPages, 1)}
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
