package com.aidigital.operationalhub.externalservices.pacing.model;

/**
 * One alert badge for a pacing (US-110), as Pacing returns it on a row's {@code health.alerts}
 * array. Raised by Pacing's shared alert detectors ({@code shared/alerts-core.js}) against that
 * pacing's own per-pacing alert configuration — the Hub does not evaluate any threshold itself.
 *
 * <p>{@code value} and {@code label} are Pacing's own split of the same alert into a number and a
 * short description, from its {@code displayParts}. They exist because {@code text} is a whole
 * sentence, and a 180-line-item pacing raises well over a hundred of those: a list of a hundred
 * sentences is a wall in which the one alert that matters is indistinguishable from the ninety that
 * repeat. A screen showing more than one alert should lead with {@code value} and keep {@code text}
 * for the single-alert case.
 *
 * @param type     detector key, e.g. {@code pacing_off_pace}, {@code margin_below_target}
 * @param severity {@code critical} | {@code warning} | {@code info}
 * @param text     the whole sentence, right for a tooltip and wrong for a list
 * @param value    the alert's number alone — {@code -88.8pp}, {@code 94d} — or null for the few
 *                 detector types that have no meaningful figure
 * @param label    the description without the number, the severity adverb or the line item name
 * @param liId     the line item this alert is about, or null when it concerns the whole pacing.
 *                 Worth showing next to {@code name}: two line items can share a description, and
 *                 without the id they read as one row alerting twice
 * @param name     that line item's own description, when the alert has one
 */
public record PacingAlert(
		String type,
		String severity,
		String text,
		String value,
		String label,
		@com.fasterxml.jackson.annotation.JsonProperty("li_id") String liId,
		String name) {
}
