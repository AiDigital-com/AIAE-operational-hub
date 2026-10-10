package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;

/**
 * A pacing's full dashboard payload, as {@code GET /api/dashboards/:slug/data} returns it (§6 of the
 * migration plan, US-114/115). Restricted to the fields the Pacing Dashboard screen needs; Pacing's
 * real response also carries {@code third_party}, {@code mappings_v3}, {@code deliveryStats} and
 * {@code sourceFacts} - none of those are read here yet; the first two belong to the CM360 lane,
 * which is being rewritten. {@code types}, {@code availableSplits}, {@code availableMetrics} and
 * {@code conversionTags} WERE on that list until Pacing's own widget renderer moved into this app:
 * it reads all four, and dropping them here is what made a channel row read {@code Unknown}, a
 * dimension control offer nothing, and the Conversion Action cut unable to say why. {@code data}
 * WAS on that list until the
 * Data panel: a pacing whose source setting the Hub cannot show is a pacing whose delivery silently
 * comes from the raw mart because nobody could see, let alone change, which table it reads.
 * {@code creatives}, {@code conversions} and {@code dimSources} left it for the Breakdown panel,
 * which offers a cut per dimension and cannot offer the ones fed by those files without them.
 *
 * <p>{@code display}/{@code aggregate}/{@code libraryEntries}/{@code metrics} are kept fully opaque:
 * their internal grammar belongs entirely to Pacing's own widget-spec engine, which this migration
 * explicitly does not reimplement (service logic: "None" for §6).
 *
 * @param campaign       the pacing's campaign summary
 * @param planByLineItem line item id (as text) to its plan
 * @param factsDaily     raw daily delivery facts, passed through byte-for-byte
 * @param asOf           the as-of date Pacing computed the facts against; null if unresolved
 * @param creatives      DSP-native creative rows from Pacing's {@code <slug>.creatives.json} aux
 *                       cache, passed through byte-for-byte. Null when the pacing has
 *                       {@code data.fetch_creatives} off, or when that file does not match the
 *                       current refresh - Pacing omits the key entirely in both cases, and the
 *                       Breakdown's "Creative (asset)" cut is then not offered. Null rather than an
 *                       empty list on purpose: "this pacing does not collect creatives" and "it
 *                       collects them and none delivered" are different answers, and only the
 *                       second one should show an empty cut
 * @param conversions    conversion-mart rows from {@code <slug>.conversions.json}, under the same
 *                       presence rule as {@code creatives} (gated on {@code data.fetch_conversions})
 *                       and feeding the "Conversion Action" cut the same way
 * @param dimSources     the per-pacing dimension sources that were actually loaded, keyed by source
 * @param thirdParty  the configured CM360 blocks, serialized as {@code third_party}; empty means
 *                    nothing is set up, which is the normal state
 * @param mappingsV3  the v3 mapping entities, serialized as {@code mappings_v3}; NULL means the
 *                    pacing predates the model, which is not the same as an empty list
 *                       id - Devices and any sheet-backed source, each carrying its rows and the
 *                       bookkeeping of the read that produced them. Kept opaque for
 *                       {@code display}'s reason: the shape belongs to Pacing's own loader, and the
 *                       Hub reads it rather than reinterpreting it. Null when this pacing has no
 *                       source configured or none of their files matched - the Breakdown then
 *                       offers no source cut, which is the correct outcome rather than an empty one
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
 * @param types           one entry per line item naming its channel ({@code {line_item_id, type}}).
 *                        The widget renderer labels a channel-grained row and answers a channel
 *                        filter from this; without it every line item reads as {@code Unknown}
 * @param availableSplits the dimension inventory the last build measured - which breakdown
 *                        dimensions this pacing's delivery carries and what values each holds. A
 *                        widget's dimension control offers exactly what is in here
 * @param availableMetrics what the last build measured the delivery rows able to report, as
 *                        {@code {delivery: [...]}}. SPARSE: null means the file predates the
 *                        inventory and reads as "not built yet", which is a different answer from
 *                        an empty list ("nothing available")
 * @param conversionTags  the conversions file's tag state, {@code own} or {@code dropped}. Null
 *                        means its rows were never tagged - which the Conversion Action cut has to
 *                        tell apart from {@code dropped}, where they were and got shed for size
 * @param journal        free-text notes on this pacing
 */
public record PacingDashboardData(
		PacingDashboardCampaign campaign,
		Map<String, PacingLineItemPlan> planByLineItem,
		List<Map<String, Object>> factsDaily,
		String asOf,
		List<Map<String, Object>> types,
		Map<String, Object> availableSplits,
		Map<String, Object> availableMetrics,
		String conversionTags,
		List<Map<String, Object>> creatives,
		List<Map<String, Object>> conversions,
		Map<String, Object> dimSources,
		@JsonProperty("third_party") List<Map<String, Object>> thirdParty,
		@JsonProperty("mappings_v3") List<Map<String, Object>> mappingsV3,
		Map<String, Object> display,
		Map<String, Object> aggregate,
		Map<String, Object> capabilities,
		Map<String, Object> metrics,
		Map<String, Object> libraryEntries,
		Map<String, Object> data,
		@JsonProperty("notify") PacingNotifySettings notifySettings,
		List<PacingJournalEntry> journal) {
}
