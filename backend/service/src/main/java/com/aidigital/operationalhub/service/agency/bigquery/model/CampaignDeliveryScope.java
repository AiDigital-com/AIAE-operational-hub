package com.aidigital.operationalhub.service.agency.bigquery.model;

import com.aidigital.operationalhub.service.agency.model.CampaignModel;

/**
 * BigQuery scope that connects a Hub campaign from NetSuite IO lines to the delivery marts.
 *
 * <p>The Hub campaign id is not stored on the delivery marts directly. The stable bridge is:
 * NetSuite {@code line_item_id} -> mart {@code CNB_unique_line_item_id} -> mart
 * {@code constructed_name}. Reporting spreadsheets then read by the constructed-name list, so the Hub
 * does the same.
 *
 * @param campaign         the visible Hub campaign
 * @param lineItems        subquery selecting {@code campaign_id} and {@code line_item_id}
 * @param constructedNames subquery selecting {@code constructed_name}
 */
public record CampaignDeliveryScope(CampaignModel campaign, BqRequest lineItems, BqRequest constructedNames) {

}
