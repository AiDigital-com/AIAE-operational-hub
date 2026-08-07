package com.aidigital.operationalhub.domain.repository;

import com.aidigital.operationalhub.domain.entity.HubReportView;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

/**
 * Spring Data repository for {@link HubReportView} ({@code hub_report_views}).
 */
public interface HubReportViewRepository extends JpaRepository<HubReportView, Long> {

	/**
	 * Lists a campaign's report views oldest-first (stable list order for the picker).
	 *
	 * @param campaignId the campaign id
	 * @return the campaign's report views, ordered by creation time ascending
	 */
	List<HubReportView> findByCampaignIdOrderByCreatedAtAsc(Long campaignId);

	/**
	 * Lists a campaign's report views oldest-first, paginated.
	 *
	 * @param campaignId the campaign id
	 * @param pageable   the page request
	 * @return a page of the campaign's report views, ordered by creation time ascending
	 */
	Page<HubReportView> findByCampaignIdOrderByCreatedAtAsc(Long campaignId, Pageable pageable);

	/**
	 * Finds one report view scoped to a campaign, so a view id from another campaign never resolves.
	 *
	 * @param id         the report view id
	 * @param campaignId the campaign id
	 * @return the matching report view, or empty
	 */
	Optional<HubReportView> findByIdAndCampaignId(Long id, Long campaignId);

	/**
	 * Tells whether the campaign already has a report with the given name (case-insensitively).
	 *
	 * @param campaignId the campaign id
	 * @param name       the candidate name
	 * @return {@code true} if a same-name report exists in the campaign
	 */
	boolean existsByCampaignIdAndNameIgnoreCase(Long campaignId, String name);

	/**
	 * Like {@link #existsByCampaignIdAndNameIgnoreCase}, excluding one report id (for rename checks).
	 *
	 * @param campaignId the campaign id
	 * @param name       the candidate name
	 * @param id         the report id to exclude (the one being renamed)
	 * @return {@code true} if a different report with that name exists in the campaign
	 */
	boolean existsByCampaignIdAndNameIgnoreCaseAndIdNot(Long campaignId, String name, Long id);
}
