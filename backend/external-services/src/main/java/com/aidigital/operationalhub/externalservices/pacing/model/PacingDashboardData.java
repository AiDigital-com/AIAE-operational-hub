package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;

/**
 * A pacing's full dashboard payload, as {@code GET /api/dashboards/:slug/data} returns it (§6 of the
 * migration plan, US-114/115). Restricted to the fields the Pacing Dashboard screen needs; Pacing's
 * real response also carries {@code types}, {@code availableSplits}, {@code notify},
 * {@code third_party}, {@code mappings_v3}, {@code deliveryStats}, {@code creatives},
 * {@code conversions}, {@code dimSources} and {@code sourceFacts} - none of those are read here
 * because §6 does not use them yet. {@code data} WAS on that list until the Data panel: a pacing
 * whose source setting the Hub cannot show is a pacing whose delivery silently comes from the raw
 * mart because nobody could see, let alone change, which table it reads.
 *
 * <p>{@code display}/{@code aggregate}/{@code libraryEntries}/{@code metrics} are kept fully opaque:
 * their internal grammar belongs entirely to Pacing's own widget-spec engine, which this migration
 * explicitly does not reimplement (service logic: "None" for §6).
 *
 * @param campaign       the pacing's campaign summary
 * @param planByLineItem line item id (as text) to its plan
 * @param factsDaily     raw daily delivery facts, passed through byte-for-byte
 * @param asOf           the as-of date Pacing computed the facts against; null if unresolved
 * @param display        this pacing's opaque widget/layout selection object
 * @param aggregate      opaque per-pacing aggregate configuration
 * @param capabilities   what this Pacing build accepts on a settings save; echo it back as the
 *                       save's display_writer or a v2 widget change is refused
 * @param metrics        the figures every widget binds to - delivery, spend, margin, pace, the
 *                       impressions/clicks/views splits and the rate-type bid tables - computed by
 *                       Pacing from this same payload and passed through untouched. The Hub must not
 *                       recompute or adjust anything in here: margin in particular is applied
 *                       server-side in Pacing and nowhere else, and applying it twice inflates money
 *                       (a named decision in the migration plan). Null when Pacing could not derive
 *                       them, which is what a pacing with no delivery data looks like.
 * @param libraryEntries shared library entries a linked widget refers to, keyed by entry id; null when
 *                       no widget links to one
 * @param data           this pacing's {@code config.data} namespace - the BigQuery source its delivery
 *                       is read from and the optional extras fetched with it. Opaque here for
 *                       {@code display}'s reason inverted: the Hub edits four of its keys and must not
 *                       disturb the rest (a sheet binding, a mapping), so it reads the object rather
 *                       than a narrowed projection of it. Null on a pacing that predates the
 *                       BigQuery-direct migration and has never had these settings written
 * @param notifySettings this pacing's alert configuration (§14 of the migration plan) - unlike
 *                       {@code data}/{@code display}, modeled in full rather than kept opaque,
 *                       because the Alerts screen owns and rewrites the whole namespace, never a
 *                       narrowed slice of it. Null on a pacing whose {@code config.notify} has never
 *                       been written - a client then shows Pacing's own detector defaults. Named
 *                       {@code notifySettings} rather than the wire key {@code notify}: a record
 *                       component named {@code notify} is illegal - its generated accessor would
 *                       override the final {@code Object.notify()} - so {@link JsonProperty} carries
 *                       the translation instead
 * @param journal        free-text notes on this pacing
 */
public record PacingDashboardData(
		PacingDashboardCampaign campaign,
		Map<String, PacingLineItemPlan> planByLineItem,
		List<Map<String, Object>> factsDaily,
		String asOf,
		Map<String, Object> display,
		Map<String, Object> aggregate,
		Map<String, Object> capabilities,
		Map<String, Object> metrics,
		Map<String, Object> libraryEntries,
		Map<String, Object> data,
		@JsonProperty("notify") PacingNotifySettings notifySettings,
		List<PacingJournalEntry> journal) {
}
