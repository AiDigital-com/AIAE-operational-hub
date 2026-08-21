package com.aidigital.operationalhub.service.entity.impl;

import com.aidigital.operationalhub.cachemanagement.event.CacheInvalidationEventService;
import com.aidigital.operationalhub.domain.entity.HubReportView;
import com.aidigital.operationalhub.domain.repository.HubReportViewRepository;
import com.aidigital.operationalhub.service.exception.BusinessException;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.instancio.Select.field;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Pure Mockito unit tests for {@link HubReportViewServiceImpl}.
 */
@ExtendWith(MockitoExtension.class)
class HubReportViewServiceImplTest {

	private static final long CAMPAIGN_ID = 42L;
	private static final long VIEW_ID = 7L;

	@Mock
	private HubReportViewRepository reportViewRepository;

	@Mock
	private CacheInvalidationEventService cacheInvalidationEventService;

	@InjectMocks
	private HubReportViewServiceImpl service;

	private HubReportView view(String name) {
		HubReportView view = new HubReportView();
		view.setName(name);
		view.setType("basic");
		view.setStatus("draft");
		view.setDimensions("date");
		view.setMetrics("impressions");
		return view;
	}

	@Test
	void shouldListCampaignViewsTest() {
		// Given:
		HubReportView first = view("All data");
		HubReportView second = view("Weekly reporting");
		when(reportViewRepository.findByCampaignIdOrderByCreatedAtAsc(CAMPAIGN_ID)).thenReturn(List.of(first, second));

		// When:
		List<HubReportView> result = service.listByCampaign(CAMPAIGN_ID);

		// Then:
		assertThat(result).containsExactly(first, second);
	}

	@Test
	void shouldListCampaignViewsAsPageTest() {
		// Given:
		HubReportView first = view("All data");
		PageRequest pageRequest = PageRequest.of(1, 25);
		Page<HubReportView> page = new PageImpl<>(List.of(first), pageRequest, 42);
		when(reportViewRepository.findByCampaignIdOrderByCreatedAtAsc(CAMPAIGN_ID, pageRequest)).thenReturn(page);

		// When:
		Page<HubReportView> result = service.listByCampaign(CAMPAIGN_ID, 2, 25);

		// Then:
		assertThat(result).isEqualTo(page);
	}

	@Test
	void shouldGetViewScopedToCampaignTest() {
		// Given:
		HubReportView existing = view("All data");
		when(reportViewRepository.findByIdAndCampaignId(VIEW_ID, CAMPAIGN_ID)).thenReturn(Optional.of(existing));

		// When:
		HubReportView result = service.getByCampaignAndId(CAMPAIGN_ID, VIEW_ID);

		// Then:
		assertThat(result).isEqualTo(existing);
	}

	@Test
	void shouldThrowOph028WhenViewMissingTest() {
		// Given:
		when(reportViewRepository.findByIdAndCampaignId(VIEW_ID, CAMPAIGN_ID)).thenReturn(Optional.empty());

		// When/Then:
		assertThatThrownBy(() -> service.getByCampaignAndId(CAMPAIGN_ID, VIEW_ID))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", "OPH_028")
				.hasMessageContaining("Unknown report view");
	}

	@Test
	void shouldCreateViewWithUniqueNameTest() {
		// Given:
		HubReportView input = view("New report");
		HubReportView saved = view("New report");
		when(reportViewRepository.existsByCampaignIdAndNameIgnoreCase(CAMPAIGN_ID, "New report")).thenReturn(false);
		when(reportViewRepository.save(input)).thenReturn(saved);

		// When:
		HubReportView result = service.create(CAMPAIGN_ID, input);

		// Then:
		assertThat(result).isEqualTo(saved);
		ArgumentCaptor<HubReportView> captor = ArgumentCaptor.forClass(HubReportView.class);
		verify(reportViewRepository).save(captor.capture());
		assertThat(captor.getValue().getCampaignId()).isEqualTo(CAMPAIGN_ID);
		verify(cacheInvalidationEventService).publishUpdateEvent(HubReportView.class);
	}

	@Test
	void shouldRejectCreateWhenNameBlankTest() {
		// Given:
		HubReportView input = view("  ");

		// When/Then:
		assertThatThrownBy(() -> service.create(CAMPAIGN_ID, input))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", "OPH_030")
				.hasMessageContaining("must not be blank");
	}

	@Test
	void shouldRejectCreateWhenNameTooLongTest() {
		// Given:
		HubReportView input = view("x".repeat(51));

		// When/Then:
		assertThatThrownBy(() -> service.create(CAMPAIGN_ID, input))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", "OPH_031")
				.hasMessageContaining("50 characters");
	}

	@Test
	void shouldRejectCreateWhenNameDuplicateTest() {
		// Given:
		HubReportView input = view("Weekly reporting");
		when(reportViewRepository.existsByCampaignIdAndNameIgnoreCase(CAMPAIGN_ID, "Weekly reporting")).thenReturn(true);

		// When/Then:
		assertThatThrownBy(() -> service.create(CAMPAIGN_ID, input))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", "OPH_029")
				.hasMessageContaining("already exists");
	}

	@Test
	void shouldUpdateViewFieldsTest() {
		// Given:
		HubReportView existing = view("Old name");
		existing.setId(VIEW_ID);
		HubReportView changes = view("New name");
		changes.setStatus("saved");
		changes.setNote("a note");
		changes.setDimensions("date,line_item_id");
		changes.setMetrics("spend,clicks");
		changes.setColumnOrder("line_item_id,spend,date,clicks");
		changes.setFilters("[{\"field\":\"DATE\",\"values\":[\"2026-03-10\"]}]");
		when(reportViewRepository.findByIdAndCampaignId(VIEW_ID, CAMPAIGN_ID)).thenReturn(Optional.of(existing));
		when(reportViewRepository.existsByCampaignIdAndNameIgnoreCaseAndIdNot(CAMPAIGN_ID, "New name", existing.getId()))
				.thenReturn(false);

		// When:
		HubReportView result = service.update(CAMPAIGN_ID, VIEW_ID, changes);

		// Then:
		assertThat(result.getName()).isEqualTo("New name");
		assertThat(result.getStatus()).isEqualTo("saved");
		assertThat(result.getNote()).isEqualTo("a note");
		assertThat(result.getDimensions()).isEqualTo("date,line_item_id");
		assertThat(result.getMetrics()).isEqualTo("spend,clicks");
		assertThat(result.getColumnOrder()).isEqualTo("line_item_id,spend,date,clicks");
		assertThat(result.getFilters()).isEqualTo("[{\"field\":\"DATE\",\"values\":[\"2026-03-10\"]}]");
		verify(cacheInvalidationEventService).publishUpdateEvent(HubReportView.class);
	}

	@Test
	void shouldCarryEveryPersistedColumnFieldOntoTheExistingViewOnUpdateTest() {
		// Given: update copies the changed view field by field onto the loaded row, so a field added to
		// the entity and not added here is written by the mapper, accepted by the endpoint, and then
		// silently dropped - the report saves, reports success, and comes back in its old shape. That is
		// exactly how `columnOrder` shipped broken: its mapper round-tripped, so every mapper test
		// passed, and this copy was the one place nobody had a test for.
		HubReportView existing = Instancio.create(HubReportView.class);
		existing.setId(VIEW_ID);
		HubReportView changes = Instancio.of(HubReportView.class).set(field(HubReportView::getName), "New name").create();
		when(reportViewRepository.findByIdAndCampaignId(VIEW_ID, CAMPAIGN_ID)).thenReturn(Optional.of(existing));
		when(reportViewRepository.existsByCampaignIdAndNameIgnoreCaseAndIdNot(CAMPAIGN_ID, "New name", existing.getId()))
				.thenReturn(false);

		// When:
		HubReportView result = service.update(CAMPAIGN_ID, VIEW_ID, changes);

		// Then: every user-owned column carries over; id, campaign and audit stamps are server-owned and
		// deliberately left on the existing row
		assertThat(result.getName()).isEqualTo(changes.getName());
		assertThat(result.getStatus()).isEqualTo(changes.getStatus());
		assertThat(result.getNote()).isEqualTo(changes.getNote());
		assertThat(result.getDimensions()).isEqualTo(changes.getDimensions());
		assertThat(result.getMetrics()).isEqualTo(changes.getMetrics());
		assertThat(result.getColumnOrder()).isEqualTo(changes.getColumnOrder());
		assertThat(result.getFilters()).isEqualTo(changes.getFilters());
	}

	@Test
	void shouldThrowOph028WhenUpdatingMissingViewTest() {
		// Given:
		HubReportView changes = view("New name");
		when(reportViewRepository.findByIdAndCampaignId(VIEW_ID, CAMPAIGN_ID)).thenReturn(Optional.empty());

		// When/Then:
		assertThatThrownBy(() -> service.update(CAMPAIGN_ID, VIEW_ID, changes))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", "OPH_028");
	}

	@Test
	void shouldRejectUpdateWhenNameDuplicateOfAnotherViewTest() {
		// Given:
		HubReportView existing = view("Old name");
		existing.setId(VIEW_ID);
		HubReportView changes = view("Weekly reporting");
		when(reportViewRepository.findByIdAndCampaignId(VIEW_ID, CAMPAIGN_ID)).thenReturn(Optional.of(existing));
		when(reportViewRepository.existsByCampaignIdAndNameIgnoreCaseAndIdNot(CAMPAIGN_ID, "Weekly reporting", existing.getId()))
				.thenReturn(true);

		// When/Then:
		assertThatThrownBy(() -> service.update(CAMPAIGN_ID, VIEW_ID, changes))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", "OPH_029");
	}

	@Test
	void shouldDeleteExistingViewTest() {
		// Given:
		HubReportView existing = view("All data");
		when(reportViewRepository.findByIdAndCampaignId(VIEW_ID, CAMPAIGN_ID)).thenReturn(Optional.of(existing));

		// When:
		service.delete(CAMPAIGN_ID, VIEW_ID);

		// Then:
		verify(reportViewRepository).delete(existing);
		verify(cacheInvalidationEventService).publishUpdateEvent(HubReportView.class);
	}

	@Test
	void shouldThrowOph028WhenDeletingMissingViewTest() {
		// Given:
		when(reportViewRepository.findByIdAndCampaignId(VIEW_ID, CAMPAIGN_ID)).thenReturn(Optional.empty());

		// When/Then:
		assertThatThrownBy(() -> service.delete(CAMPAIGN_ID, VIEW_ID))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", "OPH_028");
	}

	@Test
	void shouldDuplicateViewWithCopySuffixTest() {
		// Given:
		HubReportView source = view("Weekly reporting");
		source.setStatus("saved");
		source.setColumnOrder("line_item_id,spend,date");
		source.setFilters("[{\"field\":\"LINE_ITEM_ID\",\"values\":[\"LI-1\"]}]");
		when(reportViewRepository.findByIdAndCampaignId(VIEW_ID, CAMPAIGN_ID)).thenReturn(Optional.of(source));
		when(reportViewRepository.existsByCampaignIdAndNameIgnoreCase(CAMPAIGN_ID, "Weekly reporting (copy)")).thenReturn(false);
		when(reportViewRepository.save(any(HubReportView.class)))
				.thenAnswer(invocation -> invocation.getArgument(0));

		// When:
		HubReportView result = service.duplicate(CAMPAIGN_ID, VIEW_ID);

		// Then: the copy starts as a fresh draft, not carrying the source's saved status
		assertThat(result.getName()).isEqualTo("Weekly reporting (copy)");
		assertThat(result.getStatus()).isEqualTo("draft");
		assertThat(result.getDimensions()).isEqualTo(source.getDimensions());
		assertThat(result.getMetrics()).isEqualTo(source.getMetrics());
		// The copy is the same report under a new name, so it opens arranged the way the source was -
		// a duplicate that reverted to the default layout would look like the drag had been lost.
		assertThat(result.getColumnOrder()).isEqualTo("line_item_id,spend,date");
		assertThat(result.getFilters()).isEqualTo(source.getFilters());
	}

	@Test
	void shouldTruncateDuplicateNameToFitLimitTest() {
		// Given:
		String sourceName = "x".repeat(50);
		String expectedCopyName = "x".repeat(43) + " (copy)";
		HubReportView source = view(sourceName);
		when(reportViewRepository.findByIdAndCampaignId(VIEW_ID, CAMPAIGN_ID)).thenReturn(Optional.of(source));
		when(reportViewRepository.existsByCampaignIdAndNameIgnoreCase(CAMPAIGN_ID, expectedCopyName)).thenReturn(false);
		when(reportViewRepository.save(any(HubReportView.class)))
				.thenAnswer(invocation -> invocation.getArgument(0));

		// When:
		HubReportView result = service.duplicate(CAMPAIGN_ID, VIEW_ID);

		// Then:
		assertThat(result.getName()).isEqualTo(expectedCopyName);
		assertThat(result.getName()).hasSize(50);
	}

	@Test
	void shouldRejectDuplicateWhenCopyNameCollidesTest() {
		// Given: an earlier duplicate already claimed the "(copy)" name
		HubReportView source = view("Weekly reporting");
		when(reportViewRepository.findByIdAndCampaignId(VIEW_ID, CAMPAIGN_ID)).thenReturn(Optional.of(source));
		when(reportViewRepository.existsByCampaignIdAndNameIgnoreCase(CAMPAIGN_ID, "Weekly reporting (copy)")).thenReturn(true);

		// When/Then:
		assertThatThrownBy(() -> service.duplicate(CAMPAIGN_ID, VIEW_ID))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", "OPH_029");
	}
}
