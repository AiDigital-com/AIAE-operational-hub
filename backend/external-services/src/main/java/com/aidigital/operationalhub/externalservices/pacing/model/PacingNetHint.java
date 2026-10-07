package com.aidigital.operationalhub.externalservices.pacing.model;

/**
 * Net cost mode's create-form hint, as Pacing's validate endpoint returns it (Pacing spec
 * 2026-09-07): how many of the draft's line items NetSuite reports a usable gross ≠ net ratio for.
 * The create screen offers the Net toggle - and pre-fills the Net % column - only when this says
 * the feature would do something.
 *
 * @param count number of line items whose NetSuite budgets yield a ratio in (0,1)
 */
public record PacingNetHint(Integer count) {
}
