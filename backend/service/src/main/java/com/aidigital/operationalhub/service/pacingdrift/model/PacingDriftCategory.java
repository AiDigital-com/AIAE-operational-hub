package com.aidigital.operationalhub.service.pacingdrift.model;

/**
 * Why one row of the US-106 drift report exists (§2 of the migration plan).
 */
public enum PacingDriftCategory {

	/**
	 * The Hub knows this employee, but Pacing's user mirror does not. The sync ({@code
	 * PacingUserSyncService}) will create this row the next time it runs — this category exists so it is
	 * visible before that, not only in hindsight.
	 */
	MISSING_IN_PACING,

	/**
	 * Pacing has a row for this email, but the Hub does not. This is the gap the sync itself can never
	 * close: it only ever visits emails it sends, so a user removed from (or never present in) the Hub
	 * roster keeps whatever state it last had in Pacing — including {@code active: true} — forever,
	 * unless this report surfaces it. {@code alice@aidigital.com} and {@code NEWBIE@AiDigital.com} are
	 * exactly this case in the local database.
	 */
	MISSING_IN_HUB,

	/**
	 * Both systems have a row for this email, but the display name differs.
	 */
	NAME_MISMATCH,

	/**
	 * Both systems have a row for this email, but whether the person is active differs.
	 */
	ACTIVE_MISMATCH
}
