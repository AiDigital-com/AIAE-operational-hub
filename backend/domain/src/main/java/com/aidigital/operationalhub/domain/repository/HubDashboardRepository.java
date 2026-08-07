package com.aidigital.operationalhub.domain.repository;

import com.aidigital.operationalhub.domain.entity.HubDashboard;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

/**
 * Spring Data repository for {@link HubDashboard} ({@code hub_dashboards}).
 */
public interface HubDashboardRepository extends JpaRepository<HubDashboard, Long> {

	/**
	 * Lists a campaign's dashboards oldest-first, paginated - the order the Dashboards tab lists them in.
	 *
	 * @param campaignId the campaign id
	 * @param pageable   the page request
	 * @return a page of the campaign's dashboards, ordered by creation time ascending
	 */
	Page<HubDashboard> findByCampaignIdOrderByCreatedAtAsc(Long campaignId, Pageable pageable);

	/**
	 * Finds one dashboard scoped to a campaign, so an id from another campaign never resolves.
	 *
	 * @param id         the dashboard id
	 * @param campaignId the campaign id
	 * @return the matching dashboard, or empty
	 */
	Optional<HubDashboard> findByIdAndCampaignId(Long id, Long campaignId);

	/**
	 * Tells whether the campaign already has a dashboard with the given name (case-insensitively).
	 *
	 * @param campaignId the campaign id
	 * @param name       the candidate name
	 * @return {@code true} if a same-name dashboard exists in the campaign
	 */
	boolean existsByCampaignIdAndNameIgnoreCase(Long campaignId, String name);

	/**
	 * Like {@link #existsByCampaignIdAndNameIgnoreCase}, excluding one dashboard id (for rename checks).
	 *
	 * @param campaignId the campaign id
	 * @param name       the candidate name
	 * @param id         the dashboard id to exclude (the one being renamed)
	 * @return {@code true} if a different dashboard with that name exists in the campaign
	 */
	boolean existsByCampaignIdAndNameIgnoreCaseAndIdNot(Long campaignId, String name, Long id);
}
