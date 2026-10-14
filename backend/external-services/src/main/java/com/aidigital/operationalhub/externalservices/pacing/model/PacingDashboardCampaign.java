package com.aidigital.operationalhub.externalservices.pacing.model;

import java.util.List;

/**
 * A pacing's campaign summary, as {@code GET /api/dashboards/:slug/data} returns it under
 * {@code campaign} (§6 of the migration plan). Built server-side by Pacing's own {@code buildCampaign}
 * (already camelCase on the wire - unlike most of Pacing's API this one is assembled by JS, not read
 * straight off a DB row - so no {@code @JsonProperty} translation is needed here).
 *
 * <p>Deliberately narrow: Pacing's real object also carries {@code timezone},
 * {@code client}/{@code agency} and {@code notes}/{@code notesRich}; none of those are read here
 * because the migrated screens do not use them yet. {@code rate} IS read: it is a MATH input to the
 * browser-side metric engine ({@code Currency.currencyToUsd} converts delivery cost with it), not a
 * display-only field, so it travels through to {@code PacingDashboardCampaignV1}. {@code rateLocked}
 * and {@code nsRate} joined for the Settings → Plan exchange-rate control: the lock it shows and the
 * NetSuite rate its "Reset to NS" restores. {@code sourceUrl}
 * and {@code links} joined for §16 (Documents and Links): the Hub's header chips and Documents
 * editor read them, and {@code buildCampaign} already drops any link whose URL duplicates
 * {@code sourceUrl}, so no de-duplication is repeated on this side.
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
 * @param rate        the currency conversion rate (native -> USD); 1 for a USD campaign, always
 *                    present (`resolveCampaignCurrency` defaults to `'USD'`/`1`)
 * @param status      administrative lifecycle status
 * @param orderNumber the insertion order number, if resolved
 * @param sourceUrl   the pacing's Source spreadsheet URL; Pacing sends {@code ""} when none is
 *                    connected (never null on its side, but treated as optional here anyway)
 * @param links       the campaign's reference links (§16), verbatim from
 *                    {@code config_json.campaign_links} minus the source-URL duplicate
 * @param netMode     net cost mode's pacing-level switch (Pacing spec 2026-09-07), read through
 *                    Pacing's own {@code safeNetEnabled}: while true, each client-cost figure the
 *                    engine computes is already net (gross × the line item's {@code netRatio})
 * @param periodScope    period scope's saved switch ({@code config.period_scope}): while true the
 *                       dashboard shows one period of the containers, as Pacing's Overview row and
 *                       Slack summary already do
 * @param periodScopeKey the saved period ({@code config.period_scope_key}, {@code start|end}), or
 *                       null; a hint the client re-resolves against the current containers
 * @param rateLocked     true when {@code rate} was set by hand, so NetSuite refreshes keep it
 *                       ({@code config.rate_locked}); null when Pacing omits it, read as false
 * @param nsRate         the NetSuite-detected rate "Reset to NS" restores, or null when unknown
 */
public record PacingDashboardCampaign(
		String id,
		String pacingId,
		String name,
		String startDate,
		String endDate,
		String currency,
		Double rate,
		String status,
		String orderNumber,
		String sourceUrl,
		List<PacingCampaignLink> links,
		Boolean netMode,
		Boolean periodScope,
		String periodScopeKey,
		Boolean rateLocked,
		Double nsRate) {
}
