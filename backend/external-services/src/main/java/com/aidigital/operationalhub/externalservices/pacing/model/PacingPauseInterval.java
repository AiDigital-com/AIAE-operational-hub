package com.aidigital.operationalhub.externalservices.pacing.model;

/**
 * One paused date range on a line item's plan (already camelCase-free, plain {@code from}/{@code to}
 * on the wire). The plan-vs-actual expected-pace curve does not accrue during a paused interval - see
 * {@code shared/pacing-core.js}'s {@code pausedExpSubtract}.
 *
 * @param from inclusive start date (YYYY-MM-DD)
 * @param to   inclusive end date (YYYY-MM-DD); null means the pause is still open
 */
public record PacingPauseInterval(String from, String to) {
}
