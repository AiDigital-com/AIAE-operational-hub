package com.aidigital.operationalhub.service.entity;

import com.aidigital.operationalhub.domain.entity.HubDashboard;
import com.aidigital.operationalhub.service.dashboard.model.DashboardSource;
import org.springframework.data.domain.Page;

/**
 * Single gateway to the {@code hub_dashboards} entity and its repository.
 *
 * <p>Per the "one entity, one repository, one service" rule, this is the only collaborator that touches
 * {@code HubDashboardRepository}; other services depend on this contract instead of the repository.
 *
 * <p>Note what is deliberately missing: nothing here can change a dashboard's type or set its status
 * directly. The type is the data source's schema, so it is fixed at creation; the status is only a reading of
 * whether a source exists, so it moves solely through {@link #attachSource} and {@link #detachSource}.
 */
public interface HubDashboardService {

	/**
	 * Lists a campaign's dashboards, oldest first, as a page.
	 *
	 * @param campaignId the campaign id
	 * @param pageNumber one-based page number
	 * @param pageSize   maximum rows to return
	 * @return a page of the campaign's dashboards, ordered by creation time ascending
	 */
	Page<HubDashboard> listByCampaign(long campaignId, int pageNumber, int pageSize);

	/**
	 * Gets one dashboard scoped to a campaign.
	 *
	 * @param campaignId  the campaign id
	 * @param dashboardId the dashboard id
	 * @return the matching dashboard
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException OPH_034 if it does not exist in
	 *                                                                          the campaign
	 */
	HubDashboard getByCampaignAndId(long campaignId, long dashboardId);

	/**
	 * Creates a dashboard in a campaign as a draft with no data source.
	 *
	 * @param campaignId the campaign id
	 * @param dashboard  the dashboard to persist; its campaign id, status, and source fields are set by this
	 *                   method, so a caller cannot present a dashboard as live before anything was written
	 * @return the persisted dashboard
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException OPH_036 if the name is blank,
	 *                                                                          OPH_037 if it is too long,
	 *                                                                          OPH_035 if it collides with an
	 *                                                                          existing name in the campaign,
	 *                                                                          OPH_038 if the type has no
	 *                                                                          schema behind it
	 */
	HubDashboard create(long campaignId, HubDashboard dashboard);

	/**
	 * Replaces a dashboard's name, optional-column selection, and displayed campaign name.
	 *
	 * @param campaignId  the campaign id
	 * @param dashboardId the dashboard id
	 * @param changes     the replacement data; its type, status, and source fields are ignored
	 * @return the updated dashboard
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException OPH_034 if it does not exist in
	 *                                                                          the campaign, OPH_036 if the
	 *                                                                          new name is blank, OPH_037 if
	 *                                                                          it is too long, OPH_035 if it
	 *                                                                          collides with a different
	 *                                                                          dashboard's name
	 */
	HubDashboard update(long campaignId, long dashboardId, HubDashboard changes);

	/**
	 * Duplicates a dashboard as a fresh draft in the same campaign.
	 *
	 * <p>The source fields are deliberately not copied: a duplicate has not written its own BigQuery table,
	 * and pointing two dashboard definitions at the same source would make "refresh this source" ambiguous.
	 *
	 * @param campaignId  the campaign id
	 * @param dashboardId the dashboard id to duplicate
	 * @return the newly created duplicate
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException OPH_034 if it does not exist in
	 *                                                                          the campaign, OPH_035 if the
	 *                                                                          generated copy name collides
	 */
	HubDashboard duplicate(long campaignId, long dashboardId);

	/**
	 * Permanently deletes a dashboard.
	 *
	 * <p>The BigQuery table it points at is not dropped here: the Hub row is a pointer, and a dashboard that
	 * ClicData is still reading should not lose its data because someone tidied the list.
	 *
	 * @param campaignId  the campaign id
	 * @param dashboardId the dashboard id
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException OPH_034 if it does not exist in
	 *                                                                          the campaign
	 */
	void delete(long campaignId, long dashboardId);

	/**
	 * Records the data source a write produced and turns the dashboard live.
	 *
	 * <p>Both facts move together on purpose: the status exists only as a cached reading of whether a source
	 * is present, so nothing else may set one without the other.
	 *
	 * @param campaignId          the campaign id
	 * @param dashboardId         the dashboard id
	 * @param source              the table the write produced, its row count, and when it completed
	 * @param displayCampaignName the campaign name to show on the dashboard, or {@code null} to keep the one
	 *                            it already carries - the confirm dialog offers it for editing at exactly the
	 *                            moment the source is created (US-020), so the two travel together
	 * @return the updated dashboard
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException OPH_034 if it does not exist in
	 *                                                                          the campaign
	 */
	HubDashboard attachSource(
			long campaignId, long dashboardId, DashboardSource source, String displayCampaignName);

	/**
	 * Forgets a dashboard's data source and returns it to draft (US-021).
	 *
	 * @param campaignId  the campaign id
	 * @param dashboardId the dashboard id
	 * @return the updated dashboard
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException OPH_034 if it does not exist in
	 *                                                                          the campaign
	 */
	HubDashboard detachSource(long campaignId, long dashboardId);
}
