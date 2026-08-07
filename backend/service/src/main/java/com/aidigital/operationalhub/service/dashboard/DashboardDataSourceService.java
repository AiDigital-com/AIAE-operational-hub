package com.aidigital.operationalhub.service.dashboard;

import com.aidigital.operationalhub.domain.entity.HubDashboard;
import com.aidigital.operationalhub.service.dashboard.model.DashboardDatasetCriteria;
import com.aidigital.operationalhub.service.dashboard.model.DashboardDatasetPage;
import com.aidigital.operationalhub.service.dashboard.model.DashboardPreview;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;

import java.util.List;

/**
 * Creates, counts and removes the BigQuery table a dashboard hands to ClicData.
 *
 * <p>Separate from {@code HubDashboardService}, which owns the Hub's own row: this one owns what happens in
 * BigQuery. The two meet in {@link #createDataSource}, where a successful write is recorded against the
 * dashboard - in that order, so a dashboard never claims a table that was not written.
 */
public interface DashboardDataSourceService {

	/**
	 * Counts the rows the dashboard's data source would contain if it were created now (US-019).
	 *
	 * @param user        the current user, whose visibility decides whether the campaign resolves
	 * @param campaignId  the campaign id
	 * @param dashboardId the dashboard id
	 * @return the row count and the column choice it was counted under
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException OPH_025 if the campaign is not
	 *                                                                          visible, OPH_034 if the
	 *                                                                          dashboard does not exist,
	 *                                                                          OPH_018 if the BigQuery read
	 *                                                                          fails
	 */
	DashboardPreview preview(CurrentUserModel user, long campaignId, long dashboardId);

	/**
	 * Reads one filtered page of the rows that the dashboard's data source would contain now.
	 *
	 * @param user        the current user, whose visibility decides whether the campaign resolves
	 * @param campaignId  the campaign id
	 * @param dashboardId the dashboard id
	 * @param pageNumber  one-based page number
	 * @param pageSize    requested page size
	 * @param criteria    additive column filters and date range
	 * @return the matching dataset rows
	 */
	DashboardDatasetPage previewRows(
			CurrentUserModel user,
			long campaignId,
			long dashboardId,
			int pageNumber,
			int pageSize,
			DashboardDatasetCriteria criteria);

	/**
	 * Reads the distinct values of one dashboard dataset column for a filter picker.
	 *
	 * @param user        the current user, whose visibility decides whether the campaign resolves
	 * @param campaignId  the campaign id
	 * @param dashboardId the dashboard id
	 * @param field       the dashboard output column alias
	 * @return distinct non-blank values, capped by the implementation
	 */
	List<String> distinctValues(CurrentUserModel user, long campaignId, long dashboardId, String field);

	/**
	 * Writes the dashboard's data source and records it, turning the dashboard live (US-020).
	 *
	 * @param user                the current user, whose visibility decides whether the campaign resolves
	 * @param campaignId          the campaign id
	 * @param dashboardId         the dashboard id
	 * @param displayCampaignName the campaign name to show on the dashboard, or {@code null} to keep whatever
	 *                            the dashboard already carries
	 * @return the updated dashboard, now pointing at its table
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException OPH_025 if the campaign is not
	 *                                                                          visible, OPH_034 if the
	 *                                                                          dashboard does not exist,
	 *                                                                          OPH_026 if the BigQuery write
	 *                                                                          fails
	 */
	HubDashboard createDataSource(
			CurrentUserModel user, long campaignId, long dashboardId, String displayCampaignName);

	/**
	 * Forgets the dashboard's data source, returning it to draft (US-021).
	 *
	 * <p>The BigQuery table is left where it is. Removing the source is how a user stops pointing at a table,
	 * and a ClicData dashboard that is still reading it should not go blank because someone tidied the Hub.
	 *
	 * @param user        the current user, whose visibility decides whether the campaign resolves
	 * @param campaignId  the campaign id
	 * @param dashboardId the dashboard id
	 * @return the updated dashboard, now a draft
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException OPH_025 if the campaign is not
	 *                                                                          visible, OPH_034 if the
	 *                                                                          dashboard does not exist
	 */
	HubDashboard removeDataSource(CurrentUserModel user, long campaignId, long dashboardId);
}
