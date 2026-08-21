package com.aidigital.operationalhub.service.entity.impl;

import com.aidigital.operationalhub.cachemanagement.event.CacheInvalidationEventService;
import com.aidigital.operationalhub.domain.entity.HubReportView;
import com.aidigital.operationalhub.domain.enums.ReportViewStatus;
import com.aidigital.operationalhub.domain.repository.HubReportViewRepository;
import com.aidigital.operationalhub.service.entity.HubReportViewService;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * Default {@link HubReportViewService} delegating to {@link HubReportViewRepository}.
 */
@Service
@RequiredArgsConstructor
public class HubReportViewServiceImpl implements HubReportViewService {

	private static final String COPY_SUFFIX = " (copy)";
	private static final int MAX_NAME_LENGTH = 50;

	private final HubReportViewRepository reportViewRepository;
	private final CacheInvalidationEventService cacheInvalidationEventService;

	@Override
	@Transactional(readOnly = true)
	public List<HubReportView> listByCampaign(long campaignId) {
		return reportViewRepository.findByCampaignIdOrderByCreatedAtAsc(campaignId);
	}

	@Override
	@Transactional(readOnly = true)
	public Page<HubReportView> listByCampaign(long campaignId, int pageNumber, int pageSize) {
		return reportViewRepository.findByCampaignIdOrderByCreatedAtAsc(
				campaignId, PageRequest.of(Math.max(pageNumber - 1, 0), pageSize));
	}

	@Override
	@Transactional(readOnly = true)
	public HubReportView getByCampaignAndId(long campaignId, long viewId) {
		return reportViewRepository
				.findByIdAndCampaignId(viewId, campaignId)
				.orElseThrow(() -> new BusinessException(OperationalHubErrorReason.OPH_028, String.valueOf(viewId)));
	}

	@Override
	@Transactional
	public HubReportView create(long campaignId, HubReportView view) {
		requireName(view.getName());
		requireUniqueName(campaignId, view.getName(), null);
		view.setCampaignId(campaignId);
		HubReportView saved = reportViewRepository.save(view);
		cacheInvalidationEventService.publishUpdateEvent(HubReportView.class);
		return saved;
	}

	@Override
	@Transactional
	public HubReportView update(long campaignId, long viewId, HubReportView changes) {
		requireName(changes.getName());
		HubReportView existing = getByCampaignAndId(campaignId, viewId);
		requireUniqueName(campaignId, changes.getName(), existing.getId());
		existing.setName(changes.getName());
		existing.setStatus(changes.getStatus());
		existing.setNote(changes.getNote());
		existing.setDimensions(changes.getDimensions());
		existing.setMetrics(changes.getMetrics());
		existing.setColumnOrder(changes.getColumnOrder());
		existing.setFilters(changes.getFilters());
		cacheInvalidationEventService.publishUpdateEvent(HubReportView.class);
		return existing;
	}

	@Override
	@Transactional
	public void delete(long campaignId, long viewId) {
		HubReportView existing = getByCampaignAndId(campaignId, viewId);
		reportViewRepository.delete(existing);
		cacheInvalidationEventService.publishUpdateEvent(HubReportView.class);
	}

	@Override
	@Transactional
	public HubReportView duplicate(long campaignId, long viewId) {
		HubReportView source = getByCampaignAndId(campaignId, viewId);
		HubReportView copy = new HubReportView();
		copy.setName(copyName(source.getName()));
		copy.setType(source.getType());
		copy.setStatus(ReportViewStatus.DRAFT.getCode());
		copy.setNote(source.getNote());
		copy.setDimensions(source.getDimensions());
		copy.setMetrics(source.getMetrics());
		copy.setColumnOrder(source.getColumnOrder());
		copy.setFilters(source.getFilters());
		return create(campaignId, copy);
	}

	/**
	 * Validates that the report name is present.
	 *
	 * @param name the name to validate
	 */
	void requireName(String name) {
		if (name == null || name.isBlank()) {
			throw new BusinessException(OperationalHubErrorReason.OPH_030);
		}
		if (name.length() > MAX_NAME_LENGTH) {
			throw new BusinessException(OperationalHubErrorReason.OPH_031);
		}
	}

	/**
	 * Builds a copy name that preserves the suffix while respecting the report-name length limit.
	 *
	 * @param sourceName the source report name
	 * @return the copy name
	 */
	String copyName(String sourceName) {
		int baseLimit = MAX_NAME_LENGTH - COPY_SUFFIX.length();
		String base = sourceName.length() > baseLimit ? sourceName.substring(0, baseLimit).stripTrailing() : sourceName;
		return base + COPY_SUFFIX;
	}

	/**
	 * Validates that no other report view in the campaign already has this name (case-insensitively).
	 *
	 * @param campaignId the campaign id
	 * @param name       the candidate name
	 * @param excludeId  the report id to exclude from the check (the one being renamed), or {@code null} on create
	 */
	void requireUniqueName(long campaignId, String name, Long excludeId) {
		boolean exists = excludeId == null
				? reportViewRepository.existsByCampaignIdAndNameIgnoreCase(campaignId, name)
				: reportViewRepository.existsByCampaignIdAndNameIgnoreCaseAndIdNot(campaignId, name, excludeId);
		if (exists) {
			throw new BusinessException(OperationalHubErrorReason.OPH_029, name);
		}
	}
}
