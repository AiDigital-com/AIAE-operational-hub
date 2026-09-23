package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * One changed field inside a {@link PacingNsDiffLineItemFields} entry (§13 of the migration plan,
 * US-136), shared by both the {@code field_diff} and {@code plan_diff} classes of
 * {@link PacingNsDiffReport}.
 *
 * <p>{@code pacing}/{@code netsuite} are genuinely polymorphic on the wire — a string for
 * {@code channel}/{@code rate_type}/{@code flight_start}/{@code flight_end}, a number for
 * {@code native_budget}/{@code target_impressions}/{@code target_spend} — so {@link Object} is the
 * honest type here, not a guess at whichever one {@link #field()} happens to name this time.
 *
 * @param field          the changed field's name, e.g. {@code channel}, {@code flight_start},
 *                       {@code target_impressions}
 * @param pacing         the value as stored on the Pacing side; string or number depending on
 *                       {@link #field()}
 * @param netsuite       the value as read from NetSuite; string or number depending on
 *                       {@link #field()}
 * @param source         present only on {@code flight_start}/{@code flight_end} entries: {@code
 *                       override} means a person moved the date on purpose, {@code plan} means it
 *                       came from the plain field. Neither implies the value is wrong — it only
 *                       changes how the difference should read on screen. Null on every other field.
 * @param pacingNative   serialized as {@code pacing_native}; present only on the {@code target_spend}
 *                       entry (never on {@code target_impressions}), the native-currency figure
 *                       alongside the USD value already in {@link #pacing()} — for a
 *                       currency-converted pacing both must be shown, never just one. Null everywhere
 *                       else.
 * @param netsuiteNative serialized as {@code netsuite_native}; the NetSuite-side counterpart of
 *                       {@link #pacingNative()}, same presence rule.
 */
public record PacingNsDiffFieldChange(
		String field,
		Object pacing,
		Object netsuite,
		String source,
		@JsonProperty("pacing_native") Object pacingNative,
		@JsonProperty("netsuite_native") Object netsuiteNative) {
}
