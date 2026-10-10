import { ApiError } from "../../shared/api/api-error";
import { apiClient } from "../../shared/api/client";
import { formatError } from "../../shared/format/error";
import type {
  PacingCampaignLinkV1,
  PacingDashboardV1,
  PacingDataSettingsUpdateV1,
  PacingDisplaySaveOutcome,
  PacingJournalEntryV1,
  PacingJournalEntryWriteV1,
  PacingLibraryEntryV1,
  PacingLibraryKindV1,
  PacingLibrarySaveOutcome,
  PacingLikeResultV1,
  PacingNotifySettingsV1,
  PacingRefreshOutcome,
  PacingRefreshStatusV1,
  PacingThirdPartyCampaignsV1,
  PacingThirdPartyDataV1,
  PacingThirdPartyStatusV1,
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

/**
 * Saves the campaign's reference links (§16 of the migration plan, US-140/141) - the bookmarks the
 * header chips show and the Documents panel edits.
 *
 * A WHOLE-ARRAY replace, like `savePacingNotifySettings` and unlike the data-settings patch: Pacing
 * stores `campaign_links` as one unit, so `links` must be every link the pacing should keep - an
 * entry left out is an entry deleted. The Hub's backend validates the list (http/https only, the
 * Asana rule of US-141, length/count caps) and answers 400 naming the offending link; Pacing itself
 * stores the array verbatim.
 */
export async function savePacingCampaignLinks(slug: string, links: PacingCampaignLinkV1[]): Promise<void> {
  const result = await apiClient.POST("/api/v1/pacing/dashboards/{slug}/links", {
    params: { path: { slug } },
    body: { links },
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
 * Where a pacing's CM360 read stands. Cheap enough for a widget to poll while a fetch is in flight:
 * Pacing answers it off the head of the published file, never its rows.
 */
export async function getPacingThirdPartyStatus(slug: string): Promise<PacingThirdPartyStatusV1> {
  const result = await apiClient.GET("/api/v1/pacing/dashboards/{slug}/third-party/status", {
    params: { path: { slug } },
  });
  if (result.error || !result.response.ok || result.data === undefined) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
  return result.data;
}

/**
 * The published CM360 file. LARGE - tens of megabytes on a real pacing - so this is asked for only
 * once a widget is on screen and its status reads `ready`.
 *
 * Throws on a 404, like every other call here. That is not an oversight: a pacing with nothing
 * published answers 404, and the widget's own `if (error || !data)` draws the same empty box for a
 * failure as for no rows - the reference behaves identically, because its apiFetch throws on any
 * non-2xx. Translating the 404 into an empty success would add a third opinion about a state the
 * two layers already agree on.
 */
export async function getPacingThirdPartyData(slug: string): Promise<PacingThirdPartyDataV1> {
  const result = await apiClient.GET("/api/v1/pacing/dashboards/{slug}/third-party/data", {
    params: { path: { slug } },
  });
  if (result.error || !result.response.ok || result.data === undefined) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
  return result.data;
}

/**
 * Every CM360 campaign the ad-server export carries, for the source picker. Global - the slug only
 * authorises the read - and served from Pacing's ten-minute cache, which answers a failed upstream
 * with its last good copy rather than an empty list (`stale`).
 */
export async function getPacingThirdPartyCampaigns(slug: string): Promise<PacingThirdPartyCampaignsV1> {
  const result = await apiClient.GET("/api/v1/pacing/dashboards/{slug}/third-party/campaigns", {
    params: { path: { slug } },
  });
  if (result.error || !result.response.ok || result.data === undefined) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
  return result.data;
}

/**
 * Replaces this pacing's CM360 sources. A WHOLE-ARRAY replace: send every entry that should survive,
 * not only the ones that changed.
 *
 * Saving TRIGGERS a pull, so the pacing goes `pending` and the status endpoint is what says when it
 * lands. This resolves as soon as the save is accepted, not when the data arrives.
 */
export async function savePacingThirdParty(
  slug: string,
  thirdParty: Record<string, unknown>[],
): Promise<void> {
  const result = await apiClient.POST("/api/v1/pacing/dashboards/{slug}/third-party-settings", {
    params: { path: { slug } },
    body: { thirdParty },
  });
  if (result.error || !result.response.ok) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
}

/**
 * Replaces this pacing's mapping entities - the dimension libraries that classify CM360 rows and
 * delivery rows into the same values, which is what lets the two be compared.
 *
 * `null` CLEARS the list and is a real instruction, distinct from an empty array.
 */
export async function savePacingMappings(
  slug: string,
  mappings: Record<string, unknown>[] | null,
): Promise<void> {
  const result = await apiClient.POST("/api/v1/pacing/dashboards/{slug}/mappings", {
    params: { path: { slug } },
    body: { mappings },
  });
  if (result.error || !result.response.ok) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
}

/** What a CM360 re-pull request came back with. None of the three is an error. */
export interface PacingThirdPartyRefetchOutcome {
  started: boolean;
  notConfigured: boolean;
  rateLimited: boolean;
}

/**
 * Pulls this pacing's CM360 rows again now.
 *
 * Fire-and-forget: the status endpoint is what says where the pull got to. "Nothing to pull" and
 * "the refresh budget is spent" come back as outcomes, not throws - neither is a fault, and a
 * caller should show them as a sentence rather than as a failed request.
 */
export async function refetchPacingThirdParty(
  slug: string,
): Promise<PacingThirdPartyRefetchOutcome> {
  const result = await apiClient.POST(
    "/api/v1/pacing/dashboards/{slug}/third-party/refetch",
    { params: { path: { slug } } },
  );
  if (result.error || !result.response.ok || result.data === undefined) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
  return {
    started: !!result.data.started,
    notConfigured: !!result.data.notConfigured,
    rateLimited: !!result.data.rateLimited,
  };
}

/** One proposed dimension, as the suggestion endpoint returns it. Drafts - nothing is stored. */
export interface PacingMappingSuggestion {
  name: string;
  values: { value: string; aliases?: string[] }[];
}

/** What a suggestion request came back with. An empty list with a `notice` is a success. */
export interface PacingMappingSuggestionResult {
  dimensions: PacingMappingSuggestion[];
  notice: string | null;
}

/**
 * Asks Pacing to propose dimensions for a mapping, from the words actually present in this pacing's
 * delivery rows and CM360 placements.
 *
 * Proposals are DRAFTS: nothing is stored until the caller accepts one and saves the mapping. An
 * empty list carrying a notice is NOT an error - today it means no model is connected yet, and the
 * caller should show those words rather than a failure.
 */
export async function suggestPacingMappingLibrary(
  slug: string,
  mappingId: string | null,
): Promise<PacingMappingSuggestionResult> {
  const result = await apiClient.POST("/api/v1/pacing/dashboards/{slug}/mapping/suggest", {
    params: { path: { slug } },
    body: { mappingId },
  });
  if (result.error || !result.response.ok || result.data === undefined) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
  return {
    dimensions: (result.data.dimensions ?? []) as PacingMappingSuggestion[],
    notice: result.data.notice ?? null,
  };
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

/**
 * Adds a free-text journal note to a pacing (§15 of the migration plan, US-139). The response is the
 * pacing's whole fresh journal, newest write included - callers patch it straight into the cached
 * dashboard (`["pacing", "dashboard", slug]`) rather than refetching the multi-megabyte payload.
 */
export async function addPacingJournalEntry(
  slug: string,
  body: PacingJournalEntryWriteV1
): Promise<PacingJournalEntryV1[]> {
  const result = await apiClient.POST("/api/v1/pacing/dashboards/{slug}/journal", {
    params: { path: { slug } },
    body,
  });
  if (result.error || !result.response.ok || result.data === undefined) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
  return result.data.journal;
}

/**
 * Edits a journal entry in place (§15, US-139). Author-or-admin, enforced by Pacing and mirrored by
 * each entry's `canEdit`. The response is the pacing's whole fresh journal.
 */
export async function updatePacingJournalEntry(
  slug: string,
  entryId: string,
  body: PacingJournalEntryWriteV1
): Promise<PacingJournalEntryV1[]> {
  const result = await apiClient.PATCH("/api/v1/pacing/dashboards/{slug}/journal/{entryId}", {
    params: { path: { slug, entryId } },
    body,
  });
  if (result.error || !result.response.ok || result.data === undefined) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
  return result.data.journal;
}

/**
 * Soft-deletes a journal entry (§15, US-139). Deliberately no author check, on either side - anyone
 * with dashboard access to this pacing may delete any entry, the reference behaviour, kept on purpose.
 * The response is the pacing's whole fresh journal.
 */
export async function deletePacingJournalEntry(slug: string, entryId: string): Promise<PacingJournalEntryV1[]> {
  const result = await apiClient.DELETE("/api/v1/pacing/dashboards/{slug}/journal/{entryId}", {
    params: { path: { slug, entryId } },
  });
  if (result.error || !result.response.ok || result.data === undefined) {
    throw new ApiError(formatError(result.error), result.response.status);
  }
  return result.data.journal;
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
