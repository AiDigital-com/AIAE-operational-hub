package com.aidigital.operationalhub.externalservices.pacing.model;

import java.util.List;
import java.util.Map;

/**
 * A pacing's {@code config.data} namespace as the Hub writes it: where its delivery is read from in
 * BigQuery, and which optional extras are fetched with it. The editable counterpart of the {@code data}
 * object {@link PacingDashboardData} carries back. Carried from the generated
 * {@code PacingDataSettingsUpdateV1} request DTO into the external-services layer unchanged, same
 * reason {@link PacingLineItemPlanUpdate} exists: so {@link com.aidigital.operationalhub
 * .externalservices.pacing.PacingClient}'s interface does not depend on the generated API model.
 *
 * <p>{@code null} means ABSENT, never "set it to the default". Pacing merges this namespace key by key
 * (its {@code saveSettings} gates each one on the key's presence), so a null field leaves whatever is
 * stored alone - which is what lets a Hub that knows about three settings save without resetting a
 * fourth it has never heard of. The wire record that carries this omits nulls rather than sending
 * them, because an explicit JSON null would pass Pacing's presence check and be written.
 *
 * <p>None of these settings changes a figure already on screen. {@code source} is interpolated into
 * the delivery query, so it takes effect the next time that query runs - the nightly build, or a
 * manual refresh.
 *
 * @param source           which BigQuery table delivery is read from: {@code platform_mart} (the raw
 *                         platform feed) or {@code platform_mart_adjustments_view} (the same feed with
 *                         the team's manual delivery corrections applied). Validated against the same
 *                         allowlist on both sides; Pacing silently substitutes {@code platform_mart}
 *                         for anything it does not recognise, so an unrecognised value must not get
 *                         this far
 * @param fetchCreatives   whether DSP creative assets are fetched alongside delivery, which is what
 *                         puts Creative (asset) in the breakdowns
 * @param fetchConversions whether conversions are fetched, which is what puts Conversion Action in the
 *                         breakdowns. Read from the conversions table paired with {@code source}
 * @param dimSources       the WHOLE dimension-source list to store, opaque - forwarded byte-for-byte
 *                         and validated by Pacing, which refuses a malformed entry rather than
 *                         dropping it. Whole-array replace: a caller that rebuilds this from its own
 *                         built-in toggles alone deletes every sheet-backed source the pacing has, so
 *                         it must carry through the entries it does not own. Null leaves the stored
 *                         list untouched
 */
public record PacingDataSettings(
		String source,
		Boolean fetchCreatives,
		Boolean fetchConversions,
		List<Map<String, Object>> dimSources) {
}
