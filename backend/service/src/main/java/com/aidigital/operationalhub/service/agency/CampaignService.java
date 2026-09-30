package com.aidigital.operationalhub.service.agency;

import com.aidigital.operationalhub.service.agency.model.CampaignModel;
import com.aidigital.operationalhub.service.agency.search.CampaignField;
import com.aidigital.operationalhub.service.common.search.SearchCriteria;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import org.springframework.data.domain.Page;

import java.util.List;

/**
 * Reads campaigns from BigQuery, optionally filtered by client or agency.
 *
 * <p>Implementations query the {@code netsuite_campaigns_with_ids_fresh_data} BigQuery table for
 * distinct campaigns, apply the search criteria, and map the rows into campaign models.
 */
public interface CampaignService {

	/**
	 * Returns a page of campaigns visible to the given user, applying the search criteria.
	 *
	 * @param user     the current user
	 * @param criteria the filter, sort, and paging criteria
	 * @return the page of visible campaigns
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException if the BigQuery read fails
	 */
	Page<CampaignModel> searchCampaigns(CurrentUserModel user, SearchCriteria<CampaignField> criteria);

	/**
	 * Resolves a campaign by id, enforcing the current user's agency visibility. A campaign outside the
	 * user's visibility resolves the same as an unknown one.
	 *
	 * @param user       the current user
	 * @param campaignId the campaign id
	 * @return the resolved, visible campaign
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException OPH_025 when no visible campaign matches
	 */
	CampaignModel getVisibleCampaign(CurrentUserModel user, long campaignId);

	/**
	 * Resolves who a campaign is, enforcing the same visibility as {@link #getVisibleCampaign}, without
	 * computing what it has delivered.
	 *
	 * <p>This is the one to call when a campaign is being resolved in order to do something else - read its
	 * report rows, build a dashboard's data source, list its insertion orders. Those paths need the campaign's
	 * id, name and client, and pay for a budget sum over every line item, a flight-date window, a tactic
	 * array, a line-item count, an ordering, a total-count window and a second query resolving the delivery
	 * mart's own name for the client - before their real query starts.
	 *
	 * <p>The fields it does not read come back null: the budget, flight dates, status, channels, industry
	 * vertical and line-item count. A screen that displays any of those wants {@link #getVisibleCampaign}.
	 *
	 * @param user       the current user
	 * @param campaignId the campaign id
	 * @return the resolved, visible campaign's identity
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException OPH_025 when no visible campaign matches
	 */
	CampaignModel getVisibleCampaignIdentity(CurrentUserModel user, long campaignId);

	/**
	 * Resolves who several campaigns are — the bulk counterpart of
	 * {@link #getVisibleCampaignIdentity}, in ONE BigQuery round trip for the whole set. Built for
	 * the pacing Overview, which needs the agency/client of every campaign across every pacing row
	 * and must never pay one query per pacing.
	 *
	 * <p>Same visibility rule, different absence contract: an id that is unknown, or outside the
	 * caller's agency visibility, is simply missing from the result rather than failing the whole
	 * batch — one foreign campaign on one pacing must not blank the entire Overview. Callers treat a
	 * missing id as "unresolved".
	 *
	 * <p>Identity fields only ({@code id}, {@code name}, client and agency); the unread fields come
	 * back null, exactly like the single-id identity lookup.
	 *
	 * @param user        the current user
	 * @param campaignIds the campaign ids to resolve; an empty list resolves to an empty result
	 *                    without touching BigQuery
	 * @return the visible campaigns' identities, in no particular order; never {@code null}
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException if the BigQuery read fails
	 */
	List<CampaignModel> getVisibleCampaignIdentities(CurrentUserModel user, List<Long> campaignIds);
}
