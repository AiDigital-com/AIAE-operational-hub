package com.aidigital.operationalhub.externalservices.pacing.model;

import java.util.Map;

/**
 * The outcome of {@code POST /api/dashboards/:slug/settings} when saving a {@code display} patch
 * (US-116/117/118). A concurrent edit (stale revision, or a stale Hub writer capability) is reported
 * as a distinct, typed conflict rather than collapsed into a generic failure or silently overwritten -
 * see §6 of the migration plan.
 *
 * @param ok           true if the save succeeded
 * @param display      the saved display, echoed back by Pacing; null unless {@code ok}
 * @param conflictReason {@code stale_settings} or {@code v2_writer_required}; null unless the save was
 *                       refused for one of those two reasons
 * @param currentRev     the display's actual current revision; set only for {@code stale_settings}
 */
public record PacingDisplaySaveOutcome(
		boolean ok, Map<String, Object> display, String conflictReason, Integer currentRev) {

	public static PacingDisplaySaveOutcome saved(Map<String, Object> display) {
		return new PacingDisplaySaveOutcome(true, display, null, null);
	}

	public static PacingDisplaySaveOutcome staleSettings(Integer currentRev) {
		return new PacingDisplaySaveOutcome(false, null, "stale_settings", currentRev);
	}

	public static PacingDisplaySaveOutcome writerRequired() {
		return new PacingDisplaySaveOutcome(false, null, "v2_writer_required", null);
	}
}
