/**
 * The reference's `api.library` and `api.me`, over this app's API client - what the moved Library
 * screen, Groups section, card menu and Layout mode's Share call (`spa/store.js` `api`).
 *
 * Two translations, both at this boundary so the moved files stay as they were:
 *
 *   - Shapes. This app's contract is camelCase (`updatedAt`, `ownerName`) and carries neither
 *     `standard` nor `owner_id`; the moved code reads Pacing's own snake_case rows. `standard` is
 *     what a `std:` key means, and `owner_id` is only ever compared with the viewer's own id for the
 *     owner-or-admin gates, so it is the `mine` flag spelled the way that comparison reads (`ME`).
 *   - Failures. The moved code reads a refusal the way Pacing's `apiFetch` throws it: `err.message`
 *     is the server's CODE (`stale_entry`, `library_full`, `stale_settings`), `err.status` the HTTP
 *     status, and `spa/save-error.js` turns the code into words.
 *
 * Visibility ("only me" / "team") is the reference's, as it is there (2026-10-26, reversing the
 * owner decision of 2026-10-14 that hid it): Share carries the choice, `setVisibility` flips it.
 */
import {
  createPacingLibraryEntry,
  deletePacingLibraryEntry,
  listPacingLibrary,
  setPacingLibraryLike,
  setPacingLibraryEntryVisibility,
  updatePacingLibraryEntry,
} from "./api";
import type { PacingLibraryEntryV1, PacingLibraryKindV1, PacingLibraryVisibilityV1 } from "./types";

/** The viewer's id as the moved gates compare it: `me.user_id === entry.owner_id`. */
export const ME = "me";

/** A row as Pacing's own library routes answer it. */
export function toReferenceEntry(entry: PacingLibraryEntryV1): Record<string, unknown> {
  return {
    id: entry.id,
    key: entry.id,
    kind: entry.kind,
    name: entry.name,
    description: entry.description ?? null,
    definition: entry.definition ?? null,
    owner_id: entry.mine ? ME : null,
    owner_name: entry.ownerName ?? null,
    created_at: entry.createdAt ?? null,
    updated_at: entry.updatedAt ?? null,
    likes: entry.likes,
    liked: entry.liked,
    mine: entry.mine,
    usage: entry.usage,
    standard: entry.id.startsWith("std:"),
    // An answer from a Pacing that predates the column carries none: that entry is shared.
    visibility: entry.visibility ?? "team",
  };
}

/** A refusal shaped the way the moved code reads one. */
export function referenceError(code: string, status: number, detail?: string): Error {
  const err = new Error(code) as Error & { status: number; detail?: string };
  err.status = status;
  if (detail) err.detail = detail;
  return err;
}

interface ShareBody {
  kind?: PacingLibraryKindV1;
  name: string;
  description?: string | null;
  definition: Record<string, unknown>;
  visibility?: PacingLibraryVisibilityV1 | null;
}

export const pacingLibraryApi = {
  async list(params?: Record<string, string>) {
    const entries = await listPacingLibrary({
      q: params?.q || undefined,
      sort: params?.sort === "likes" ? "likes" : "usage",
      shelf: params?.shelf || undefined,
      kind: (params?.kind as PacingLibraryKindV1 | undefined) || undefined,
    });
    return { ok: true, entries: entries.map(toReferenceEntry) };
  },

  async share(body: ShareBody) {
    const outcome = await createPacingLibraryEntry(
      body.kind ?? "widget",
      body.name,
      body.description ?? undefined,
      body.definition,
      body.visibility ?? undefined
    );
    if (outcome.status === "conflict") throw referenceError(outcome.conflict.reason, 409);
    return { ok: true, entry: toReferenceEntry(outcome.result) };
  },

  async update(id: string, body: ShareBody & { updated_at: string }) {
    const outcome = await updatePacingLibraryEntry(
      id,
      body.name,
      body.description ?? undefined,
      body.definition,
      body.updated_at
    );
    if (outcome.status === "conflict") throw referenceError(outcome.conflict.reason, 409);
    return { ok: true, entry: toReferenceEntry(outcome.result) };
  },

  async remove(id: string, updatedAt: string) {
    const outcome = await deletePacingLibraryEntry(id, updatedAt);
    if (outcome.status === "conflict") throw referenceError(outcome.conflict.reason, 409);
    return { ok: true };
  },

  async setVisibility(id: string, visibility: PacingLibraryVisibilityV1) {
    const outcome = await setPacingLibraryEntryVisibility(id, visibility);
    if (outcome.status === "conflict") throw referenceError(outcome.conflict.reason, 409);
    return { ok: true, entry: toReferenceEntry(outcome.result) };
  },

  async like(id: string) {
    const result = await setPacingLibraryLike(id, true);
    return { ok: true, ...result };
  },

  async unlike(id: string) {
    const result = await setPacingLibraryLike(id, false);
    return { ok: true, ...result };
  },
};

/** The reference's `api.me()`, the two fields its gates read. */
export function referenceMe(isAdmin: boolean) {
  return { user_id: ME, role: isAdmin ? "admin" : "user" };
}
