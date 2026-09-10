package com.aidigital.operationalhub.externalservices.pacing.model;

/**
 * The outcome of a library create/update/delete call (US-118). Modeled the same way as
 * {@link PacingDisplaySaveOutcome}: a concurrent edit or a full library is a distinct, typed outcome,
 * not collapsed into a generic failure - see §6 of the migration plan ("concurrent edit must be
 * reported, not silently overwritten").
 *
 * @param ok               true if the call succeeded
 * @param entry            the resulting entry; set for a successful create/update, null for delete
 * @param deletedId        the removed entry's id; set only for a successful delete
 * @param conflictReason   {@code stale_entry}, {@code library_full} or {@code v2_writer_required};
 *                         null unless the call was refused for one of those reasons
 * @param currentUpdatedAt the entry's actual current {@code updatedAt}; set only for {@code stale_entry}
 */
public record PacingLibrarySaveOutcome(
		boolean ok,
		PacingLibraryEntry entry,
		String deletedId,
		String conflictReason,
		String currentUpdatedAt) {

	public static PacingLibrarySaveOutcome saved(PacingLibraryEntry entry) {
		return new PacingLibrarySaveOutcome(true, entry, null, null, null);
	}

	public static PacingLibrarySaveOutcome deleted(String id) {
		return new PacingLibrarySaveOutcome(true, null, id, null, null);
	}

	public static PacingLibrarySaveOutcome staleEntry(String currentUpdatedAt) {
		return new PacingLibrarySaveOutcome(false, null, null, "stale_entry", currentUpdatedAt);
	}

	public static PacingLibrarySaveOutcome libraryFull() {
		return new PacingLibrarySaveOutcome(false, null, null, "library_full", null);
	}

	public static PacingLibrarySaveOutcome writerRequired() {
		return new PacingLibrarySaveOutcome(false, null, null, "v2_writer_required", null);
	}
}
