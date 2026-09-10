/**
 * Pacing administration screen (not in the migration plan - the plan's seventeen sections skip it
 * entirely - but carried over from the retired Pacing front end's own Admin screen, because without
 * it an administrator has no way to delete a mistakenly created pacing or to re-run the nightly
 * Daily Build off-schedule). Reachable only by an admin: gated at the route (app-shell.tsx) and,
 * more importantly, at the Hub's own backend (`PacingAdminController#requireAdmin`) - this screen
 * never merely hides its buttons from a non-admin.
 *
 * Reuses `usePacingOverview` for the list (§4's own row shape already carries name, slug, owner,
 * status and flight; `createdAt` was added to that same row for this screen) and pacing-plan's
 * `StatusControl` for the per-row status change (§9) - no second implementation of either.
 */
import { useEffect, useMemo, useState } from "react";
import { ApiError } from "../../shared/api/api-error";
import { formatError } from "../../shared/format/error";
import { useDebounce } from "../../shared/hooks/use-debounce";
import { SearchIcon } from "../../shared/ui/icons/icons";
import { LoadingBlock } from "../../shared/ui/loading-spinner/loading-spinner";
// Ported verbatim from Pacing's own retired front end so dates read identically everywhere in the
// Hub (see pacing-overview's own use of the same helper) - not a second date-formatting rule.
import { fmtDate } from "../pacing/mock/format";
import { usePacingOverview } from "../pacing-overview/hooks";
import type { PacingRowV1 } from "../pacing-overview/types";
import { StatusControl } from "../pacing-plan/status-control";
import { useRefreshAllDashboards } from "./hooks";
import { BulkDeletePacingModal, DeletePacingModal } from "./pacing-admin-delete-modals";
import "./pacing-admin.css";

const SEARCH_DEBOUNCE_MS = 300;

function matchesSearch(row: PacingRowV1, term: string): boolean {
  if (!term) return true;
  if (row.name.toLowerCase().includes(term)) return true;
  return (row.dashSlug ?? "").toLowerCase().includes(term);
}

export function PacingAdmin() {
  const overview = usePacingOverview();
  const rows = useMemo(() => overview.data?.pacings ?? [], [overview.data]);

  const [searchInput, setSearchInput] = useState("");
  const search = useDebounce(searchInput, SEARCH_DEBOUNCE_MS).trim().toLowerCase();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<PacingRowV1 | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const refreshAll = useRefreshAllDashboards();

  // Same tick-based countdown as pacing-dashboard's single-pacing refresh (US-119) - a live number,
  // not a static "try again later".
  useEffect(() => {
    if (cooldownUntil == null) return undefined;
    const tick = () => setCooldownSeconds(Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [cooldownUntil]);

  const filteredRows = useMemo(() => rows.filter((row) => matchesSearch(row, search)), [rows, search]);
  const selectedRows = useMemo(() => rows.filter((row) => selected.has(row.id)), [rows, selected]);
  const allFilteredSelected = filteredRows.length > 0 && filteredRows.every((row) => selected.has(row.id));

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllFiltered() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const row of filteredRows) next.delete(row.id);
      } else {
        for (const row of filteredRows) next.add(row.id);
      }
      return next;
    });
  }

  async function handleRefreshAll() {
    setRefreshMessage(null);
    try {
      const outcome = await refreshAll.mutateAsync();
      if (outcome.status === "cooldown") {
        setCooldownUntil(Date.now() + outcome.retryAfterSeconds * 1000);
        return;
      }
      setCooldownUntil(null);
      // Fire-and-forget on the Pacing side (§ admin): this says the build STARTED, never that it
      // finished - Pacing runs it in n8n and there is no completion signal to wait on here.
      setRefreshMessage("Started — the Daily Build is running in the background and may take a few minutes.");
    } catch (error) {
      setRefreshMessage(
        error instanceof ApiError ? formatError(error) : "Could not trigger the Daily Build."
      );
    }
  }

  const inCooldown = cooldownUntil != null && cooldownSeconds > 0;

  return (
    <section className="pacing-admin">
      <div className="pacing-admin__head">
        <h1 className="pacing-admin__title">Pacing administration</h1>
      </div>

      {overview.isPending && <LoadingBlock label="Loading pacings" />}
      {overview.isError && <p className="form-error">{formatError(overview.error)}</p>}

      {overview.isSuccess && (
        <>
          <div className="pacing-admin__toolbar">
            <label className="pacing-admin__search">
              <SearchIcon />
              <input
                type="search"
                placeholder="Search by name or slug…"
                aria-label="Search pacings by name or slug"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
            </label>
            <div className="pacing-admin__toolbar-actions">
              <button
                type="button"
                className="button button--ghost button--sm"
                onClick={handleRefreshAll}
                disabled={refreshAll.isPending || inCooldown}
              >
                {inCooldown
                  ? `Refresh all dashboards (${cooldownSeconds}s)`
                  : refreshAll.isPending
                    ? "Starting…"
                    : "Refresh all dashboards"}
              </button>
            </div>
          </div>
          {refreshMessage && <p className="pacing-admin__refresh-msg">{refreshMessage}</p>}

          {selected.size > 0 && (
            <div className="pacing-admin__bulk-bar">
              <span className="pacing-admin__bulk-count">{selected.size} selected</span>
              <div className="pacing-admin__bulk-spacer" />
              <button
                type="button"
                className="button button--ghost button--sm"
                onClick={() => setSelected(new Set())}
              >
                Clear
              </button>
              <button
                type="button"
                className="button button--danger button--sm"
                onClick={() => setBulkDeleteOpen(true)}
              >
                Delete selected
              </button>
            </div>
          )}

          {filteredRows.length === 0 ? (
            <div className="pacing-admin__empty">
              <p className="pacing-admin__empty-title">
                {rows.length === 0 ? "No pacings" : "No pacings match your search"}
              </p>
              {rows.length > 0 && (
                <p className="pacing-admin__empty-body">
                  {rows.length} pacing{rows.length === 1 ? "" : "s"} loaded, none match "{searchInput}".
                </p>
              )}
            </div>
          ) : (
            <div className="pacing-admin__table-wrap">
              <table className="pacing-admin__table">
                <thead>
                  <tr>
                    <th className="pacing-admin__checkbox-col">
                      <input
                        type="checkbox"
                        aria-label="Select all pacings matching the current search"
                        checked={allFilteredSelected}
                        onChange={toggleAllFiltered}
                      />
                    </th>
                    <th>Name</th>
                    <th>Slug</th>
                    <th>Owner</th>
                    <th>Status</th>
                    <th>Flight</th>
                    <th>Created</th>
                    <th className="pacing-admin__actions-col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr key={row.id}>
                      <td className="pacing-admin__checkbox-col">
                        <input
                          type="checkbox"
                          aria-label={`Select ${row.name}`}
                          checked={selected.has(row.id)}
                          onChange={() => toggleOne(row.id)}
                        />
                      </td>
                      <td className="pacing-admin__name">{row.name}</td>
                      <td className="pacing-admin__slug">{row.dashSlug ?? "—"}</td>
                      <td>{row.ownerName ?? "—"}</td>
                      <td>
                        <StatusControl pacingId={row.id} status={row.status} />
                      </td>
                      <td className="pacing-admin__flight">
                        {row.flightStart ? fmtDate(row.flightStart) : "—"}
                        <span className="pacing-admin__flight-sep">–</span>
                        {row.flightEnd ? fmtDate(row.flightEnd) : "—"}
                      </td>
                      <td className="pacing-admin__created">
                        {row.createdAt ? fmtDate(row.createdAt) : "—"}
                      </td>
                      <td className="pacing-admin__actions-col">
                        <button
                          type="button"
                          className="button button--danger button--sm"
                          onClick={() => setDeleteTarget(row)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {deleteTarget && <DeletePacingModal row={deleteTarget} onClose={() => setDeleteTarget(null)} />}
      {bulkDeleteOpen && (
        <BulkDeletePacingModal
          rows={selectedRows}
          onClose={() => setBulkDeleteOpen(false)}
          onDeleted={() => {
            setSelected(new Set());
            setBulkDeleteOpen(false);
          }}
        />
      )}
    </section>
  );
}
