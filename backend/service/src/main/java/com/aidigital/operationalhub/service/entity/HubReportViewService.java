package com.aidigital.operationalhub.service.entity;

import com.aidigital.operationalhub.domain.entity.HubReportView;
import org.springframework.data.domain.Page;

import java.util.List;

/**
 * Single gateway to the {@code hub_report_views} entity and its repository.
 *
 * <p>Per the "one entity, one repository, one service" rule, this is the only collaborator that
 * touches {@code HubReportViewRepository}; other services depend on this contract instead of the
 * repository.
 */
public interface HubReportViewService {

	/**
	 * Lists a campaign's report views, oldest first.
	 *
	 * @param campaignId the campaign id
	 * @return the campaign's report views, ordered by creation time ascending
	 */
	List<HubReportView> listByCampaign(long campaignId);

	/**
	 * Lists a campaign's report views, oldest first, as a page.
	 *
	 * @param campaignId the campaign id
	 * @param pageNumber one-based page number
	 * @param pageSize   maximum rows to return
	 * @return a page of the campaign's report views, ordered by creation time ascending
	 */
	Page<HubReportView> listByCampaign(long campaignId, int pageNumber, int pageSize);

	/**
	 * Gets one report view scoped to a campaign.
	 *
	 * @param campaignId the campaign id
	 * @param viewId     the report view id
	 * @return the matching report view
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException OPH_028 if it does not exist in
	 *                                                                          the campaign
	 */
	HubReportView getByCampaignAndId(long campaignId, long viewId);

	/**
	 * Creates a report view in a campaign.
	 *
	 * @param campaignId the campaign id
	 * @param view       the report view to persist (its campaign id is set by this method)
	 * @return the persisted report view
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException OPH_030 if the name is blank,
	 *                                                                          OPH_029 if it collides with an
	 *                                                                          existing name in the campaign
	 */
	HubReportView create(long campaignId, HubReportView view);

	/**
	 * Replaces a report view's name, status, note, and dimension/metric selection.
	 *
	 * @param campaignId the campaign id
	 * @param viewId     the report view id
	 * @param changes    the replacement data
	 * @return the updated report view
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException OPH_028 if it does not exist in
	 *                                                                          the campaign, OPH_030 if the new
	 *                                                                          name is blank, OPH_029 if it
	 *                                                                          collides with a different
	 *                                                                          report's name
	 */
	HubReportView update(long campaignId, long viewId, HubReportView changes);

	/**
	 * Permanently deletes a report view.
	 *
	 * @param campaignId the campaign id
	 * @param viewId     the report view id
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException OPH_028 if it does not exist in
	 *                                                                          the campaign
	 */
	void delete(long campaignId, long viewId);

	/**
	 * Duplicates a report view as a new draft named "&lt;source name&gt; (copy)" in the same campaign.
	 *
	 * @param campaignId the campaign id
	 * @param viewId     the report view id to duplicate
	 * @return the newly created duplicate
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException OPH_028 if the source does not
	 *                                                                          exist in the campaign, OPH_029
	 *                                                                          if the copy name collides with
	 *                                                                          an existing report
	 */
	HubReportView duplicate(long campaignId, long viewId);
}
