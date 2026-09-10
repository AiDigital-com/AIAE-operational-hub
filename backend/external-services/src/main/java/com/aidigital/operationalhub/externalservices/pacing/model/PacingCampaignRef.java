package com.aidigital.operationalhub.externalservices.pacing.model;

/**
 * One campaign a pacing belongs to, as Pacing returns it in a row's {@code campaigns} array (§3 of
 * the migration plan). Already camelCase on the wire — no {@code @JsonProperty} needed.
 *
 * @param id   NetSuite campaign id
 * @param name campaign display name, as last resolved from NetSuite
 */
public record PacingCampaignRef(String id, String name) {
}
