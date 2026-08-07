package com.aidigital.operationalhub.service.entity.impl;

import com.aidigital.operationalhub.cachemanagement.event.CacheInvalidationEventService;
import com.aidigital.operationalhub.domain.entity.HubDashboard;
import com.aidigital.operationalhub.domain.enums.DashboardStatus;
import com.aidigital.operationalhub.domain.enums.DashboardType;
import com.aidigital.operationalhub.domain.repository.HubDashboardRepository;
import com.aidigital.operationalhub.service.dashboard.model.DashboardSource;
import com.aidigital.operationalhub.service.entity.HubDashboardService;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import com.aidigital.operationalhub.usagelogging.LogUsage;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Arrays;
import java.util.Objects;

/**
 * Default {@link HubDashboardService} delegating to {@link HubDashboardRepository}.
 */
@Service
@RequiredArgsConstructor
public class HubDashboardServiceImpl implements HubDashboardService {

	private static final int MAX_NAME_LENGTH = 50;
	private static final String COPY_SUFFIX = " (copy)";
	private static final int MAX_COPY_ATTEMPTS = 1_000;

	private final HubDashboardRepository dashboardRepository;
	private final CacheInvalidationEventService cacheInvalidationEventService;

	@Override
	@Transactional(readOnly = true)
	public Page<HubDashboard> listByCampaign(long campaignId, int pageNumber, int pageSize) {
		return dashboardRepository.findByCampaignIdOrderByCreatedAtAsc(
				campaignId, PageRequest.of(Math.max(pageNumber - 1, 0), pageSize));
	}

	@Override
	@Transactional(readOnly = true)
	public HubDashboard getByCampaignAndId(long campaignId, long dashboardId) {
		return dashboardRepository
				.findByIdAndCampaignId(dashboardId, campaignId)
				.orElseThrow(() -> new BusinessException(
						OperationalHubErrorReason.OPH_034, String.valueOf(dashboardId)));
	}

	@Override
	@Transactional
	@LogUsage(action = "dashboard.create")
	public HubDashboard create(long campaignId, HubDashboard dashboard) {
		requireName(dashboard.getName());
		requireSupportedType(dashboard.getType());
		requireUniqueName(campaignId, dashboard.getName(), null);
		dashboard.setCampaignId(campaignId);
		dashboard.setStatus(DashboardStatus.DRAFT.getCode());
		dashboard.setSourceTable(null);
		dashboard.setSourceRowCount(null);
		dashboard.setSourceCreatedAt(null);
		HubDashboard saved = dashboardRepository.save(dashboard);
		cacheInvalidationEventService.publishUpdateEvent(HubDashboard.class);
		return saved;
	}

	@Override
	@Transactional
	public HubDashboard update(long campaignId, long dashboardId, HubDashboard changes) {
		requireName(changes.getName());
		HubDashboard existing = getByCampaignAndId(campaignId, dashboardId);
		requireRenamableName(existing, changes.getName());
		requireUniqueName(campaignId, changes.getName(), existing.getId());
		boolean sourceStale = sourceAffectingChange(existing, changes);
		existing.setName(changes.getName());
		existing.setOptionalColumns(changes.getOptionalColumns());
		existing.setFilters(changes.getFilters());
		existing.setDateFrom(changes.getDateFrom());
		existing.setDateTo(changes.getDateTo());
		existing.setDisplayCampaignName(changes.getDisplayCampaignName());
		// Deliberately not part of `sourceAffectingChange`: the written table always carries the type's own
		// column order, so rearranging the preview cannot make a live data source stale.
		existing.setColumnOrder(changes.getColumnOrder());
		if (sourceStale && existing.getSourceTable() != null) {
			existing.setStatus(DashboardStatus.DRAFT.getCode());
		}
		cacheInvalidationEventService.publishUpdateEvent(HubDashboard.class);
		return existing;
	}

	@Override
	@Transactional
	// A duplicate is a new dashboard, so it counts as one - and the create() call below is self-invoked, which
	// Spring's proxy does not intercept, so this records exactly one event rather than two.
	@LogUsage(action = "dashboard.create")
	public HubDashboard duplicate(long campaignId, long dashboardId) {
		HubDashboard source = getByCampaignAndId(campaignId, dashboardId);
		HubDashboard copy = new HubDashboard();
		copy.setName(copyName(campaignId, source.getName()));
		copy.setType(source.getType());
		copy.setOptionalColumns(source.getOptionalColumns());
		copy.setColumnOrder(source.getColumnOrder());
		copy.setFilters(source.getFilters());
		copy.setDateFrom(source.getDateFrom());
		copy.setDateTo(source.getDateTo());
		copy.setDisplayCampaignName(source.getDisplayCampaignName());
		return create(campaignId, copy);
	}

	@Override
	@Transactional
	public void delete(long campaignId, long dashboardId) {
		HubDashboard existing = getByCampaignAndId(campaignId, dashboardId);
		dashboardRepository.delete(existing);
		cacheInvalidationEventService.publishUpdateEvent(HubDashboard.class);
	}

	@Override
	@Transactional
	public HubDashboard attachSource(
			long campaignId, long dashboardId, DashboardSource source, String displayCampaignName) {
		HubDashboard existing = getByCampaignAndId(campaignId, dashboardId);
		if (displayCampaignName != null && !displayCampaignName.isBlank()) {
			existing.setDisplayCampaignName(displayCampaignName.trim());
		}
		existing.setSourceTable(source.table());
		existing.setSourceRowCount(source.rowCount());
		existing.setSourceCreatedAt(source.writtenAt());
		existing.setStatus(DashboardStatus.LIVE.getCode());
		cacheInvalidationEventService.publishUpdateEvent(HubDashboard.class);
		return existing;
	}

	@Override
	@Transactional
	public HubDashboard detachSource(long campaignId, long dashboardId) {
		HubDashboard existing = getByCampaignAndId(campaignId, dashboardId);
		existing.setSourceTable(null);
		existing.setSourceRowCount(null);
		existing.setSourceCreatedAt(null);
		existing.setStatus(DashboardStatus.DRAFT.getCode());
		cacheInvalidationEventService.publishUpdateEvent(HubDashboard.class);
		return existing;
	}

	/**
	 * Validates that the dashboard name is present and short enough to read in a list.
	 *
	 * @param name the name to validate
	 */
	void requireName(String name) {
		if (name == null || name.isBlank()) {
			throw new BusinessException(OperationalHubErrorReason.OPH_036);
		}
		if (name.length() > MAX_NAME_LENGTH) {
			throw new BusinessException(OperationalHubErrorReason.OPH_037);
		}
	}

	/**
	 * Validates that the requested type is one this build can actually write a data source for.
	 *
	 * <p>The UI offers several types as coming soon; accepting one of those here would persist a dashboard
	 * that no writer understands, and its data source would fail rather than be missing.
	 *
	 * @param type the dashboard type code
	 */
	void requireSupportedType(String type) {
		boolean supported = Arrays.stream(DashboardType.values())
				.anyMatch(candidate -> candidate.getCode().equals(type));
		if (!supported) {
			throw new BusinessException(OperationalHubErrorReason.OPH_038, String.valueOf(type));
		}
	}

	/**
	 * Refuses to rename a dashboard whose data source already exists.
	 *
	 * <p>The name is not a label: the dashboard's slug is half of the BigQuery table name, so renaming produces
	 * a different table. The next write would create it and leave ClicData reading the one it was pointed at,
	 * with no error anywhere and stale numbers on a client-facing dashboard. Renaming the BigQuery table
	 * instead would be worse - it would blank the live dashboard the moment it happened. So the rename waits
	 * for "Remove data source", which makes re-pointing ClicData a deliberate act rather than a surprise.
	 *
	 * @param existing    the stored dashboard
	 * @param newName     the requested name
	 */
	void requireRenamableName(HubDashboard existing, String newName) {
		if (existing.getSourceTable() != null && !existing.getName().equals(newName)) {
			throw new BusinessException(OperationalHubErrorReason.OPH_042, existing.getName());
		}
	}

	/**
	 * Validates that no other dashboard in the campaign already has this name (case-insensitively).
	 *
	 * @param campaignId the campaign id
	 * @param name       the candidate name
	 * @param excludeId  the dashboard id to exclude from the check (the one being renamed), or {@code null} on
	 *                   create
	 */
	void requireUniqueName(long campaignId, String name, Long excludeId) {
		boolean exists = excludeId == null
				? dashboardRepository.existsByCampaignIdAndNameIgnoreCase(campaignId, name)
				: dashboardRepository.existsByCampaignIdAndNameIgnoreCaseAndIdNot(campaignId, name, excludeId);
		if (exists) {
			throw new BusinessException(OperationalHubErrorReason.OPH_035, name);
		}
	}

	/**
	 * Builds the dashboard copy name while respecting the same list-name limit as create and rename.
	 *
	 * @param campaignId the campaign id
	 * @param sourceName the original dashboard name
	 * @return the copy name
	 */
	String copyName(long campaignId, String sourceName) {
		String base = sourceName == null ? "" : sourceName.trim();
		for (int index = 0; index < MAX_COPY_ATTEMPTS; index++) {
			String suffix = index == 0 ? COPY_SUFFIX : " (copy " + index + ")";
			int maxBaseLength = MAX_NAME_LENGTH - suffix.length();
			String candidate = base.substring(0, Math.min(base.length(), maxBaseLength)) + suffix;
			if (!dashboardRepository.existsByCampaignIdAndNameIgnoreCase(campaignId, candidate)) {
				return candidate;
			}
		}
		throw new BusinessException(OperationalHubErrorReason.OPH_035, base);
	}

	/**
	 * Checks whether an edit changes the BigQuery table that should be written for this dashboard.
	 *
	 * @param existing the persisted dashboard
	 * @param changes  editable fields from the update request
	 * @return {@code true} when the existing source should be treated as stale
	 */
	boolean sourceAffectingChange(HubDashboard existing, HubDashboard changes) {
		return !Objects.equals(existing.getName(), changes.getName())
				|| !Objects.equals(existing.getOptionalColumns(), changes.getOptionalColumns())
				|| !Objects.equals(existing.getFilters(), changes.getFilters())
				|| !Objects.equals(existing.getDateFrom(), changes.getDateFrom())
				|| !Objects.equals(existing.getDateTo(), changes.getDateTo());
	}
}
