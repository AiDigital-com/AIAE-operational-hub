package com.aidigital.operationalhub.externalservices.pacing.model;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * The OTHER Live pacing that already carries a {@link PacingNsDiffMissingInPacing} line item
 * (§13 of the migration plan, US-136 follow-up, found live 2026-09-22: a campaign with two
 * pacings reported the same ten line items as "missing" on both, forever, because nothing
 * distinguished "nobody has this" from "the pacing next door already does"). The migration plan
 * explicitly allows several pacings per campaign sharing line items, so this is not a defect to
 * hide - it is shown so the reader can tell the two cases apart, per {@link
 * PacingNsDiffMissingInPacing#coveredBy()}'s own doc comment.
 *
 * @param pacingId   serialized as {@code pacing_id}; the other pacing's id
 * @param pacingName serialized as {@code pacing_name}; the other pacing's display name
 * @param dashSlug   serialized as {@code dash_slug}; the other pacing's dashboard routing key
 * @param status     the other pacing's administrative lifecycle status (never {@code Archive} -
 *                   Pacing's own lookup excludes archived pacings)
 */
public record PacingNsDiffCoveredBy(
		@JsonProperty("pacing_id") String pacingId,
		@JsonProperty("pacing_name") String pacingName,
		@JsonProperty("dash_slug") String dashSlug,
		String status) {
}
