package com.aidigital.operationalhub.externalservices.pacing.model;

/**
 * One campaign reference link (§16 of the migration plan, US-140/141), exactly as Pacing stores it
 * in {@code config_json.campaign_links} and returns it under {@code campaign.links}: a free-text
 * label and the URL it opens. Already camelCase-free on the wire ({@code name}/{@code url}), so no
 * {@code @JsonProperty} translation is needed in either direction - the same record deserializes
 * the dashboard payload and serializes the settings save.
 *
 * <p>Pure bookmark: Pacing never follows the URL and no calculation reads it. The label doubles as
 * the link's meaning - the four preset names ({@code Asana}, {@code IO}, {@code Media Plan},
 * {@code Slack}) fill labelled editor slots, a name recognised as a DSP is surfaced first in the
 * Hub's header, anything else is a custom link.
 *
 * @param name the link's label
 * @param url  where the link points
 */
public record PacingCampaignLink(
		String name,
		String url) {
}
