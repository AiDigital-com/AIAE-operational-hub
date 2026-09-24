package com.aidigital.operationalhub.externalservices.pacing.model;

/**
 * A rate detector expressed as a factor of its own target (§14 of the migration plan) - e.g. 0.7
 * means "below 70% of target", 2.0 means "above 200% of target". Used for {@code ctr_below_target},
 * {@code vcr_below_target} and {@code ctr_above_target}.
 *
 * <p>A factor of 0 is read by Pacing's detectors as "use the built-in default" for that key
 * ({@code cfg.factor || 0.7}), not as a literal zero threshold.
 *
 * @param enabled whether this detector runs at all
 * @param slack   whether a firing alert also posts to Slack
 * @param factor  the target multiplier
 */
public record PacingAlertRuleFactor(boolean enabled, boolean slack, double factor) {
}
