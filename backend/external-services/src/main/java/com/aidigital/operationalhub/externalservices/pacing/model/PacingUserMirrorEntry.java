package com.aidigital.operationalhub.externalservices.pacing.model;

/**
 * One row of Pacing's user mirror, as returned by {@code GET /api/internal/users} (US-106, the drift
 * report — §2 of the migration plan).
 *
 * <p>The sync only ever visits emails the Hub sends it, so a row that exists in Pacing but not on the
 * Hub side (e.g. an employee removed from the Hub roster) is never touched by it and would otherwise
 * stay {@code active: true} forever with nothing to notice. This is the read that lets the Hub notice
 * it: fetch the whole mirror and diff it against the current Hub roster (see the {@code pacingdrift}
 * service package), rather than only ever seeing the emails it already knows to ask about.
 *
 * @param email  the user's email address, as stored in Pacing
 * @param name   display name, as stored in Pacing
 * @param active whether Pacing currently considers this person active
 */
public record PacingUserMirrorEntry(String email, String name, boolean active) {
}
