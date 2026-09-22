package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * One campaign a pacing belongs to, as Pacing returns it in a row's {@code campaigns} array (§3 of
 * the migration plan). {@code id} and {@code name} happen to be single words, so they need no
 * rename; {@code mpo_team_lead} does — Pacing serves this array straight out of {@code config_json},
 * where the keys are snake_case.
 *
 * @param id          NetSuite campaign id
 * @param name        campaign display name, as last resolved from NetSuite
 * @param mpoTeamLead who NetSuite records as running this campaign (§11, US-132). A NAME, not an id:
 *                    the two systems share no key, so comparing it against the pacing's owner means
 *                    matching this string against that person's name — a convention people maintain
 *                    by hand. Null when NetSuite reports none, and on any pacing that has not
 *                    revalidated since the field started being stored (2026-09-21).
 */
public record PacingCampaignRef(
		String id,
		String name,
		@JsonProperty("mpo_team_lead") String mpoTeamLead) {
}
