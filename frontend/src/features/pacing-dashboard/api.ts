import { ApiError } from "../../shared/api/api-error";
import { apiClient } from "../../shared/api/client";
import { formatError } from "../../shared/format/error";
import type {
  PacingDashboardV1,
  PacingDataSettingsUpdateV1,
  PacingDisplaySaveOutcome,
  PacingLibraryEntryV1,
  PacingLibraryKindV1,
  PacingLibrarySaveOutcome,
  PacingLikeResultV1,
  PacingNotifySettingsV1,
  PacingRefreshOutcome,
  PacingRefreshStatusV1,
} from "./types";

/**
 * Fetches one pacing's full dashboard payload (§6 of the migration plan, US-114/115). `slug` is the
 * pacing's `dashSlug` (see `pacing-overview`'s `PacingRowV1.dashSlug`), not its `id`.
 */
export async function getPacingDashboard(slug: string): Promise<PacingDashboardV1> {
  const result = await apiClient.GET("/api/v1/pacing/dashboards/{slug}", { params: { path: { slug } } });
  if (result.error || !result.response.ok || result.data === undefined) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
  return result.data;
}

/**
 * Saves a pacing's data settings: which BigQuery table its delivery is read from, and which optional
 * extras are fetched with it.
 *
 * A PARTIAL patch - Pacing merges the `data` namespace key by key and writes only what it receives -
 * so omit a field rather than sending a value for it when this screen did not touch it. `dimSources`
 * is the exception: it is a whole-array replace, and the caller must pass every entry the pacing
 * should keep, not only the ones it toggles.
 *
 * Nothing on screen changes on success. The source is interpolated into the delivery query, so the
 * figures move only once that query runs again - the nightly build, or a manual refresh.
 */
export async function savePacingDataSettings(
  slug: string,
  settings: PacingDataSettingsUpdateV1
): Promise<void> {
  const result = await apiClient.POST("/api/v1/pacing/dashboards/{slug}/data-settings", {
    params: { path: { slug } },
    body: settings,
  });
  if (result.error || !result.response.ok) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
}

/**
 * Saves a pacing's alert configuration (§14 of the migration plan): which of the 13 detectors run,
 * which also post to Slack, each threshold, the master Slack switch, the legacy VCR/ACR summary
 * column, whether paused line items are hidden from the Slack summary, and which projection the
 * summary's target column prints.
 *
 * A WHOLE-OBJECT replace, unlike `savePacingDataSettings` - Pacing stores `notify` as one unit and
 * refuses a save missing any of the 13 alert keys, so `settings` must be the complete configuration
 * this pacing should have after the save, not a patch of only what changed.
 *
 * Nothing on screen changes on success - it only changes who gets alerted and what the Slack summary
 * shows, both computed on the next detector run.
 */
export async function savePacingNotifySettings(slug: string, settings: PacingNotifySettingsV1): Promise<void> {
  const result = await apiClient.POST("/api/v1/pacing/dashboards/{slug}/notify-settings", {
    params: { path: { slug } },
    body: settings,
  });
  if (result.error || !result.response.ok) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
}

/** Polls the last completed refresh for a pacing (US-119) - see `usePollingRefreshStatus`. */
export async function getPacingRefreshStatus(slug: string): Promise<PacingRefreshStatusV1> {
  const result = await apiClient.GET("/api/v1/pacing/dashboards/{slug}/refresh-status", {
    params: { path: { slug } },
  });
  if (result.error || !result.response.ok || result.data === undefined) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
  return result.data;
}

/**
 * Triggers an on-demand refresh (US-119). A 429 inside the cooldown is not thrown - it is a normal
 * outcome the caller renders as a countdown, never queuing a second run.
 */
export async function triggerPacingRefresh(pacingId: string): Promise<PacingRefreshOutcome> {
  const result = await apiClient.POST("/api/v1/pacing/pacings/{pacingId}/refresh", {
    params: { path: { pacingId } },
  });
  if (result.response.status === 429) {
    const retryAfterSeconds =
      (result.error as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds ?? 120;
    return { status: "cooldown", retryAfterSeconds };
  }
  if (result.error || !result.response.ok || result.data === undefined) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
  return { status: "started" };
}

/**
 * Saves this pacing's widget/layout selection (US-116/117/118). A concurrent edit (409) is not
 * thrown - it is returned as a `conflict` outcome so the caller can tell the user rather than silently
 * overwrite or crash.
 */
export async function savePacingDisplay(
  slug: string,
  display: Record<string, unknown>,
  displayRev: number,
  /** The `capabilities` object from this pacing's dashboard payload, passed back
   *  unchanged. Pacing refuses a save that changes a v2 widget without it, and the
   *  refusal reads to a user as "the editor needs to reload" — so a missing one
   *  looks like a stale bundle rather than a missing field. Echoed, never
   *  constructed: declaring a grammar version the server never advertised would be
   *  asserting a capability nobody checked. */
  displayWriter?: Record<string, unknown>
): Promise<PacingDisplaySaveOutcome> {
  const result = await apiClient.POST("/api/v1/pacing/dashboards/{slug}/settings", {
    params: { path: { slug } },
    body: { display, displayRev, displayWriter },
  });
  if (result.response.status === 409) {
    return { status: "conflict", conflict: result.error as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  if (result.error || !result.response.ok || result.data === undefined) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
  return { status: "saved", display: result.data.display ?? {} };
}

/** Browses the shared widget/block/layout library (US-116). */
export async function listPacingLibrary(params: {
  q?: string;
  sort?: "usage" | "likes";
  shelf?: string;
  kind?: PacingLibraryKindV1;
}): Promise<PacingLibraryEntryV1[]> {
  const result = await apiClient.GET("/api/v1/pacing/library", { params: { query: params } });
  if (result.error || !result.response.ok || result.data === undefined) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
  return result.data.entries;
}

/** Saves a configured widget to the shared library (US-118). Only `kind: "widget"` is used by the
 *  Hub's own UI today - see the endpoint's own description for why. */
export async function createPacingLibraryEntry(
  kind: PacingLibraryKindV1,
  name: string,
  description: string | undefined,
  definition: Record<string, unknown>
): Promise<PacingLibrarySaveOutcome<PacingLibraryEntryV1>> {
  const result = await apiClient.POST("/api/v1/pacing/library", {
    body: { kind, name, description, definition },
  });
  if (result.response.status === 409) {
    return { status: "conflict", conflict: result.error as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  if (result.error || !result.response.ok || result.data === undefined) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
  return { status: "saved", result: result.data };
}

/** Updates a library widget entry (US-118), guarded by `expectedUpdatedAt`. */
export async function updatePacingLibraryEntry(
  id: string,
  name: string,
  description: string | undefined,
  definition: Record<string, unknown>,
  expectedUpdatedAt: string
): Promise<PacingLibrarySaveOutcome<PacingLibraryEntryV1>> {
  const result = await apiClient.PUT("/api/v1/pacing/library/{id}", {
    params: { path: { id } },
    body: { name, description, definition, expectedUpdatedAt },
  });
  if (result.response.status === 409) {
    return { status: "conflict", conflict: result.error as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  if (result.error || !result.response.ok || result.data === undefined) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
  return { status: "saved", result: result.data };
}

/** Removes a library entry (US-118), guarded by the same `expectedUpdatedAt` CAS as update. */
export async function deletePacingLibraryEntry(
  id: string,
  expectedUpdatedAt: string
): Promise<PacingLibrarySaveOutcome<string>> {
  const result = await apiClient.DELETE("/api/v1/pacing/library/{id}", {
    params: { path: { id } },
    body: { expectedUpdatedAt },
  });
  if (result.response.status === 409) {
    return { status: "conflict", conflict: result.error as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  if (result.error || !result.response.ok || result.data === undefined) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
  return { status: "saved", result: result.data.id };
}

/** Likes/unlikes a library entry (both idempotent) - US-118. */
export async function setPacingLibraryLike(id: string, liked: boolean): Promise<PacingLikeResultV1> {
  const result = liked
    ? await apiClient.POST("/api/v1/pacing/library/{id}/like", { params: { path: { id } } })
    : await apiClient.DELETE("/api/v1/pacing/library/{id}/like", { params: { path: { id } } });
  if (result.error || !result.response.ok || result.data === undefined) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
  return result.data;
}
