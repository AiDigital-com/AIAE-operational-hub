package com.aidigital.operationalhub.service.campaignshare.model;

/**
 * One campaign a pacing covers, as the removal confirmation lists them - so the person removing
 * somebody sees that a pacing spans more than the campaign they are on.
 *
 * @param id   the NetSuite campaign id, as text
 * @param name the campaign name, or {@code null} when Pacing only knows the id
 */
public record CampaignSharePacingCampaignModel(String id, String name) {

}
