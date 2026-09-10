package com.aidigital.operationalhub.externalservices.pacing.model;

/**
 * A pacing's campaign summary, as {@code GET /api/dashboards/:slug/data} returns it under
 * {@code campaign} (§6 of the migration plan). Built server-side by Pacing's own {@code buildCampaign}
 * (already camelCase on the wire - unlike most of Pacing's API this one is assembled by JS, not read
 * straight off a DB row - so no {@code @JsonProperty} translation is needed here).
 *
 * <p>Deliberately narrow: Pacing's real object also carries {@code rate}/{@code rateLocked}/
 * {@code nsRate}, {@code timezone}, {@code sourceUrl}, {@code periodScope}/{@code periodScopeKey},
 * {@code client}/{@code agency}, {@code links} and {@code notes}/{@code notesRich}; none of those are
 * read here because §6's dashboard view does not use them yet.
 *
 * <p>Note the field Pacing calls {@code id} here is in fact the pacing's {@code dash_slug}, not its
 * {@code pacing_id} - the mapper renames it to {@code slug} on the way into the generated
 * {@code PacingDashboardCampaignV1} contract to avoid that ambiguity.
 *
 * @param id          Pacing's own field name for the pacing's dash_slug (see class javadoc)
 * @param pacingId    the pacing id (Pacing's UUID primary key)
 * @param name        campaign/pacing display name
 * @param startDate   flight start date (YYYY-MM-DD), derived from the line items
 * @param endDate     flight end date (YYYY-MM-DD), derived from the line items
 * @param currency    the pacing's resolved currency code
 * @param status      administrative lifecycle status
 * @param orderNumber the insertion order number, if resolved
 */
public record PacingDashboardCampaign(
		String id,
		String pacingId,
		String name,
		String startDate,
		String endDate,
		String currency,
		String status,
		String orderNumber) {
}
