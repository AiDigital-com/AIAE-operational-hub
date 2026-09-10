/**
 * TEMPORARY — delete once the real Pacing screens land (§4+ of the migration plan).
 *
 * A throwaway page for checking the Hub→Pacing channel by hand. It exists because
 * the endpoint cannot otherwise be exercised without copying a Clerk bearer token
 * out of devtools: here the browser's own session does the work.
 *
 * To remove: delete this folder plus its two lines in `app-shell.tsx` (the lazy
 * import and the `/pacing-probe` route). Nothing else references it.
 */
import { useState } from "react";
import { apiClient } from "../../shared/api/client";
import { formatError } from "../../shared/format/error";
import type { components } from "../../shared/api/generated/schema";
import "./pacing-probe.css";

type PacingListResponse = components["schemas"]["PacingListResponseV1"];
type SyncSummary = components["schemas"]["PacingUserSyncSummaryV1"];
type DriftReport = components["schemas"]["PacingDriftReportV1"];

type Outcome =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ok"; body: PacingListResponse; ms: number }
  | { state: "failed"; message: string; status?: number; ms: number };

type SyncOutcome =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ok"; body: SyncSummary; ms: number }
  | { state: "failed"; message: string; status?: number; ms: number };

type DriftOutcome =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ok"; body: DriftReport; ms: number }
  | { state: "failed"; message: string; status?: number; ms: number };

export function PacingProbe() {
  const [outcome, setOutcome] = useState<Outcome>({ state: "idle" });
  const [sync, setSync] = useState<SyncOutcome>({ state: "idle" });
  const [drift, setDrift] = useState<DriftOutcome>({ state: "idle" });

  /**
   * §2 — push every Hub employee into Pacing's user mirror. Admin-only, and the
   * same run the nightly scheduler performs; this button only makes it
   * observable without waiting for 01:30.
   */
  async function runSync() {
    setSync({ state: "loading" });
    const startedAt = performance.now();
    try {
      const result = await apiClient.POST("/api/v1/sync/pacing-users", {});
      const ms = Math.round(performance.now() - startedAt);
      if (result.error || !result.response.ok || result.data === undefined) {
        setSync({
          state: "failed",
          message: formatError(result.error),
          status: result.response.status,
          ms,
        });
        return;
      }
      setSync({ state: "ok", body: result.data, ms });
    } catch (error) {
      setSync({ state: "failed", message: formatError(error), ms: Math.round(performance.now() - startedAt) });
    }
  }

  /**
   * US-106 — fetch the drift report between the Hub roster and Pacing's user mirror. Admin-only.
   */
  async function runDrift() {
    setDrift({ state: "loading" });
    const startedAt = performance.now();
    try {
      const result = await apiClient.GET("/api/v1/pacing/drift", {});
      const ms = Math.round(performance.now() - startedAt);
      if (result.error || !result.response.ok || result.data === undefined) {
        setDrift({
          state: "failed",
          message: formatError(result.error),
          status: result.response.status,
          ms,
        });
        return;
      }
      setDrift({ state: "ok", body: result.data, ms });
    } catch (error) {
      setDrift({ state: "failed", message: formatError(error), ms: Math.round(performance.now() - startedAt) });
    }
  }

  async function call() {
    setOutcome({ state: "loading" });
    const startedAt = performance.now();
    try {
      const result = await apiClient.GET("/api/v1/pacing/pacings", {});
      const ms = Math.round(performance.now() - startedAt);
      if (result.error || !result.response.ok || result.data === undefined) {
        setOutcome({
          state: "failed",
          message: formatError(result.error),
          status: result.response.status,
          ms,
        });
        return;
      }
      setOutcome({ state: "ok", body: result.data, ms });
    } catch (error) {
      // A transport failure never reaches the block above — openapi-fetch throws
      // rather than returning, and "Pacing is down" is the case worth seeing here.
      setOutcome({
        state: "failed",
        message: formatError(error),
        ms: Math.round(performance.now() - startedAt),
      });
    }
  }

  return (
    <div className="pacing-probe">
      <header className="pacing-probe__header">
        <h1>Pacing connection probe</h1>
        <p className="pacing-probe__note">
          Temporary page. Calls <code>GET /api/v1/pacing/pacings</code> on this Hub, which resolves
          your RBAC scope, signs it, and asks the Pacing service. What comes back is whatever your
          Hub roles entitle you to — nothing is mocked.
        </p>
      </header>

      <div className="pacing-probe__actions">
        <button
          type="button"
          className="pacing-probe__button"
          onClick={call}
          disabled={outcome.state === "loading"}
        >
          {outcome.state === "loading" ? "Calling…" : "Call Pacing"}
        </button>
        <button
          type="button"
          className="pacing-probe__button pacing-probe__button--secondary"
          onClick={runSync}
          disabled={sync.state === "loading"}
        >
          {sync.state === "loading" ? "Syncing…" : "Sync users → Pacing"}
        </button>
        <button
          type="button"
          className="pacing-probe__button pacing-probe__button--secondary"
          onClick={runDrift}
          disabled={drift.state === "loading"}
        >
          {drift.state === "loading" ? "Checking…" : "Drift report (Hub vs Pacing)"}
        </button>
      </div>

      {sync.state === "failed" && (
        <section className="pacing-probe__panel pacing-probe__panel--bad">
          <h2>
            Sync failed{sync.status ? ` — HTTP ${sync.status}` : ""} <small>{sync.ms} ms</small>
          </h2>
          <p>{sync.message}</p>
          <p className="pacing-probe__hints">
            <strong>403</strong> here means your Hub account may not manage roles — the sync is
            admin-only, like the NetSuite one.
          </p>
        </section>
      )}

      {sync.state === "ok" && (
        <section className="pacing-probe__panel">
          <h2>
            User sync <small>{sync.ms} ms</small>
          </h2>
          <p>
            Every Hub employee pushed into Pacing&apos;s user mirror — the same run the scheduler
            performs nightly at 01:30. Departed employees are marked inactive, never deleted:
            pacing ownership, delegations and journal entries all point at those rows.
          </p>
          <p className="pacing-probe__note">
            <code>createdInPacing</code>, <code>activated</code>, <code>deactivated</code> and{" "}
            <code>unchanged</code> are Pacing&apos;s own account of what actually changed, not a
            guess from what the Hub sent.
          </p>
          <table className="pacing-probe__table">
            <tbody>
              <tr>
                <th>Sent</th>
                <td>{sync.body.usersSent}</td>
              </tr>
              <tr>
                <th>Created in Pacing</th>
                <td>{sync.body.createdInPacing}</td>
              </tr>
              <tr>
                <th>Activated</th>
                <td>{sync.body.activated}</td>
              </tr>
              <tr>
                <th>Deactivated</th>
                <td>{sync.body.deactivated}</td>
              </tr>
              <tr>
                <th>Unchanged</th>
                <td>{sync.body.unchanged}</td>
              </tr>
              <tr>
                <th>Ids written back</th>
                <td>{sync.body.idsWritten}</td>
              </tr>
            </tbody>
          </table>
          <p className="pacing-probe__note">
            Run it twice: on the second run, createdInPacing/activated/deactivated should all be 0
            (everyone lands in unchanged) unless something genuinely changed on Pacing&apos;s side
            in between.
          </p>
        </section>
      )}

      {drift.state === "failed" && (
        <section className="pacing-probe__panel pacing-probe__panel--bad">
          <h2>
            Drift report failed{drift.status ? ` — HTTP ${drift.status}` : ""} <small>{drift.ms} ms</small>
          </h2>
          <p>{drift.message}</p>
          <p className="pacing-probe__hints">
            <strong>403</strong> here means your Hub account is not an administrator — this report
            is admin-only.
          </p>
        </section>
      )}

      {drift.state === "ok" && (
        <section className="pacing-probe__panel">
          <h2>
            Drift report (US-106) <small>{drift.ms} ms</small>
          </h2>
          <p>
            Where the Hub roster and Pacing&apos;s user mirror disagree. A row that exists only in
            Pacing (MISSING_IN_HUB) is otherwise invisible: the sync only ever visits emails it
            sends, so it never notices one.
          </p>
          {drift.body.rows.length === 0 ? (
            <p>Empty. Both sides fully agree.</p>
          ) : (
            <table className="pacing-probe__table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Category</th>
                  <th>Hub name</th>
                  <th>Pacing name</th>
                  <th>Hub active</th>
                  <th>Pacing active</th>
                </tr>
              </thead>
              <tbody>
                {drift.body.rows.map((row, index) => (
                  <tr key={`${row.email}-${row.category}-${index}`}>
                    <td>{row.email}</td>
                    <td>{row.category}</td>
                    <td>{row.hubName ?? "—"}</td>
                    <td>{row.pacingName ?? "—"}</td>
                    <td>{row.hubActive === undefined ? "—" : String(row.hubActive)}</td>
                    <td>{row.pacingActive === undefined ? "—" : String(row.pacingActive)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {outcome.state === "failed" && (
        <section className="pacing-probe__panel pacing-probe__panel--bad">
          <h2>
            Failed{outcome.status ? ` — HTTP ${outcome.status}` : ""} <small>{outcome.ms} ms</small>
          </h2>
          <p>{outcome.message}</p>
          <ul className="pacing-probe__hints">
            <li>
              <strong>403 unknown_user</strong> — your email has no row in Pacing&apos;s users
              table. Expected until §2 (User Sync) exists; the mirror is seeded by hand today.
            </li>
            <li>
              <strong>500</strong> — most likely the Pacing service is not running on port 3000.
              Every other Hub page should still work; that is the isolation this design is meant
              to give.
            </li>
          </ul>
        </section>
      )}

      {outcome.state === "ok" && (
        <>
          <section className="pacing-probe__panel">
            <h2>
              Resolved scope <small>{outcome.ms} ms</small>
            </h2>
            <p>
              This is the Hub&apos;s answer to &quot;what may this person see&quot;, computed from
              your role assignments and signed into the request. Pacing applied it; it did not
              decide it.
            </p>
            <pre>{JSON.stringify(outcome.body.scope, null, 2)}</pre>
          </section>

          <section className="pacing-probe__panel">
            <h2>Pacings — {outcome.body.pacings.length}</h2>
            {outcome.body.pacings.length === 0 ? (
              <p>
                Empty. Correct, not broken, when your scope entitles you to nothing — a Client
                Services scope always does today, since campaign filtering needs §3.
              </p>
            ) : (
              <table className="pacing-probe__table">
                <thead>
                  <tr>
                    <th>Slug</th>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {outcome.body.pacings.map((pacing, index) => (
                    <tr key={String(pacing.dash_slug ?? index)}>
                      <td>{String(pacing.dash_slug ?? "—")}</td>
                      <td>{String(pacing.pacing_name ?? "—")}</td>
                      <td>{String(pacing.status ?? "—")}</td>
                      <td>{String(pacing.owner_name ?? "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <details>
              <summary>Raw response</summary>
              <pre>{JSON.stringify(outcome.body.pacings, null, 2)}</pre>
            </details>
          </section>
        </>
      )}
    </div>
  );
}
