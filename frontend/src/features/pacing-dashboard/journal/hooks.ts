import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addPacingJournalEntry, deletePacingJournalEntry, updatePacingJournalEntry } from "../api";
import type { PacingDashboardV1, PacingJournalEntryWriteV1 } from "../types";

/**
 * Patches a fresh journal array straight into the cached dashboard payload (§15, US-139).
 *
 * All three journal writes return the pacing's whole fresh journal, so the mutation hooks below use
 * `setQueryData` rather than `invalidateQueries` - unlike `useSavePacingDataSettings`, refetching the
 * dashboard would re-pull its whole multi-megabyte payload for a change that only touched the journal.
 */
function patchJournal(queryClient: ReturnType<typeof useQueryClient>, slug: string | undefined, journal: PacingDashboardV1["journal"]) {
  queryClient.setQueryData<PacingDashboardV1>(["pacing", "dashboard", slug], (prev) =>
    prev ? { ...prev, journal } : prev
  );
}

/** Adds a journal note (§15, US-139). */
export function useAddJournalEntry(slug: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: PacingJournalEntryWriteV1) => addPacingJournalEntry(slug as string, body),
    onSuccess: (journal) => patchJournal(queryClient, slug, journal),
  });
}

/** Edits a journal note in place (§15, US-139). */
export function useUpdateJournalEntry(slug: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entryId, body }: { entryId: string; body: PacingJournalEntryWriteV1 }) =>
      updatePacingJournalEntry(slug as string, entryId, body),
    onSuccess: (journal) => patchJournal(queryClient, slug, journal),
  });
}

/** Soft-deletes a journal note (§15, US-139) - permissive, no author check. */
export function useDeleteJournalEntry(slug: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entryId: string) => deletePacingJournalEntry(slug as string, entryId),
    onSuccess: (journal) => patchJournal(queryClient, slug, journal),
  });
}
