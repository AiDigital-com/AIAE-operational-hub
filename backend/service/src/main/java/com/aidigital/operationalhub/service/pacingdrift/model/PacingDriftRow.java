package com.aidigital.operationalhub.service.pacingdrift.model;

/**
 * One disagreement between the Hub roster and Pacing's user mirror (US-106, §2 of the migration plan).
 *
 * <p>Every field the affected systems can hold a value for is populated regardless of
 * {@code category}, so a caller never has to re-fetch either side to see "which system holds which
 * value" — the acceptance criterion this report exists to satisfy. For a {@code MISSING_IN_*} row, the
 * side that does not have the employee reports {@code null} for its name/active fields; there is
 * nothing else it could honestly report.
 *
 * @param email       the email address both systems are keyed on
 * @param category    why this row exists
 * @param hubName     the Hub's display name for this email, or {@code null} if the Hub has no row
 * @param pacingName  Pacing's display name for this email, or {@code null} if Pacing has no row
 * @param hubActive   whether the Hub considers this person an active employee, or {@code null} if the
 *                    Hub has no row
 * @param pacingActive whether Pacing considers this person active, or {@code null} if Pacing has no row
 */
public record PacingDriftRow(
		String email,
		PacingDriftCategory category,
		String hubName,
		String pacingName,
		Boolean hubActive,
		Boolean pacingActive) {
}
