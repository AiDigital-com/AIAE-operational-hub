package com.aidigital.operationalhub.service.entity.impl;

import com.aidigital.operationalhub.cachemanagement.event.CacheInvalidationEventService;
import com.aidigital.operationalhub.domain.entity.HubDashboard;
import com.aidigital.operationalhub.domain.enums.DashboardStatus;
import com.aidigital.operationalhub.domain.enums.DashboardType;
import com.aidigital.operationalhub.domain.repository.HubDashboardRepository;
import com.aidigital.operationalhub.service.dashboard.model.DashboardSource;
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

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.instancio.Select.field;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Pure Mockito unit tests for {@link HubDashboardServiceImpl}.
 */
@ExtendWith(MockitoExtension.class)
class HubDashboardServiceImplTest {

	private static final long CAMPAIGN_ID = 42L;
	private static final long DASHBOARD_ID = 7L;

	@Mock
	private HubDashboardRepository dashboardRepository;

	@Mock
	private CacheInvalidationEventService cacheInvalidationEventService;

	@InjectMocks
	private HubDashboardServiceImpl service;

	@Test
	void shouldListCampaignDashboardsAsPageTest() {
		// Given:
		HubDashboard first = Instancio.create(HubDashboard.class);
		PageRequest pageRequest = PageRequest.of(1, 25);
		Page<HubDashboard> page = new PageImpl<>(List.of(first), pageRequest, 42);
		when(dashboardRepository.findByCampaignIdOrderByCreatedAtAsc(CAMPAIGN_ID, pageRequest)).thenReturn(page);

		// When:
		Page<HubDashboard> result = service.listByCampaign(CAMPAIGN_ID, 2, 25);

		// Then:
		assertThat(result).isEqualTo(page);
	}

	@Test
	void shouldGetDashboardScopedToCampaignTest() {
		// Given:
		HubDashboard existing = Instancio.create(HubDashboard.class);
		when(dashboardRepository.findByIdAndCampaignId(DASHBOARD_ID, CAMPAIGN_ID)).thenReturn(Optional.of(existing));

		// When:
		HubDashboard result = service.getByCampaignAndId(CAMPAIGN_ID, DASHBOARD_ID);

		// Then:
		assertThat(result).isEqualTo(existing);
	}

	@Test
	void shouldThrowOph034WhenDashboardMissingTest() {
		// Given:
		when(dashboardRepository.findByIdAndCampaignId(DASHBOARD_ID, CAMPAIGN_ID)).thenReturn(Optional.empty());

		// When-Then:
		assertThatThrownBy(() -> service.getByCampaignAndId(CAMPAIGN_ID, DASHBOARD_ID))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", "OPH_034")
				.hasMessageContaining("Unknown dashboard");
	}

	@Test
	void shouldCreateDashboardAsDraftWithoutSourceTest() {
		// Given: a request that claims to be live and already sourced, as a stale or hostile client might send
		HubDashboard input = Instancio.of(HubDashboard.class)
				.set(field(HubDashboard::getName), "Client dashboard")
				.set(field(HubDashboard::getType), DashboardType.BASIC.getCode())
				.set(field(HubDashboard::getStatus), DashboardStatus.LIVE.getCode())
				.set(field(HubDashboard::getSourceTable), "project.gs_templates.someone_elses_table")
				.set(field(HubDashboard::getSourceRowCount), 999L)
				.create();
		when(dashboardRepository.existsByCampaignIdAndNameIgnoreCase(CAMPAIGN_ID, "Client dashboard")).thenReturn(false);
		when(dashboardRepository.save(input)).thenReturn(input);

		// When:
		HubDashboard result = service.create(CAMPAIGN_ID, input);

		// Then: a new dashboard is a draft pointing at nothing, whatever the caller asked for
		ArgumentCaptor<HubDashboard> captor = ArgumentCaptor.forClass(HubDashboard.class);
		verify(dashboardRepository).save(captor.capture());
		assertThat(captor.getValue().getCampaignId()).isEqualTo(CAMPAIGN_ID);
		assertThat(result.getStatus()).isEqualTo(DashboardStatus.DRAFT.getCode());
		assertThat(result.getSourceTable()).isNull();
		assertThat(result.getSourceRowCount()).isNull();
		assertThat(result.getSourceCreatedAt()).isNull();
		verify(cacheInvalidationEventService).publishUpdateEvent(HubDashboard.class);
	}

	@Test
	void shouldRejectCreateWhenNameBlankTest() {
		// Given:
		HubDashboard input = Instancio.of(HubDashboard.class)
				.set(field(HubDashboard::getName), "  ")
				.set(field(HubDashboard::getType), DashboardType.BASIC.getCode())
				.create();

		// When-Then:
		assertThatThrownBy(() -> service.create(CAMPAIGN_ID, input))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", "OPH_036")
				.hasMessageContaining("must not be blank");
	}

	@Test
	void shouldRejectCreateWhenNameTooLongTest() {
		// Given:
		HubDashboard input = Instancio.of(HubDashboard.class)
				.set(field(HubDashboard::getName), "x".repeat(51))
				.set(field(HubDashboard::getType), DashboardType.BASIC.getCode())
				.create();

		// When-Then:
		assertThatThrownBy(() -> service.create(CAMPAIGN_ID, input))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", "OPH_037")
				.hasMessageContaining("50 characters");
	}

	@Test
	void shouldRejectCreateWhenTypeIsNotAvailableYetTest() {
		// Given: one of the types the UI lists as coming soon
		HubDashboard input = Instancio.of(HubDashboard.class)
				.set(field(HubDashboard::getName), "Geo dashboard")
				.set(field(HubDashboard::getType), "geo")
				.create();

		// When-Then:
		assertThatThrownBy(() -> service.create(CAMPAIGN_ID, input))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", "OPH_038")
				.hasMessageContaining("geo");
	}

	@Test
	void shouldRejectCreateWhenNameDuplicateTest() {
		// Given:
		HubDashboard input = Instancio.of(HubDashboard.class)
				.set(field(HubDashboard::getName), "Client dashboard")
				.set(field(HubDashboard::getType), DashboardType.BASIC.getCode())
				.create();
		when(dashboardRepository.existsByCampaignIdAndNameIgnoreCase(CAMPAIGN_ID, "Client dashboard")).thenReturn(true);

		// When-Then:
		assertThatThrownBy(() -> service.create(CAMPAIGN_ID, input))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", "OPH_035")
				.hasMessageContaining("already exists");
	}

	@Test
	void shouldUpdateEditableFieldsOnlyTest() {
		// Given:
		HubDashboard existing = Instancio.of(HubDashboard.class)
				.set(field(HubDashboard::getId), DASHBOARD_ID)
				.set(field(HubDashboard::getName), "Old name")
				.set(field(HubDashboard::getType), DashboardType.BASIC.getCode())
				.set(field(HubDashboard::getStatus), DashboardStatus.LIVE.getCode())
				.set(field(HubDashboard::getSourceTable), "project.gs_templates.client_dashboard")
				.create();
		HubDashboard changes = Instancio.of(HubDashboard.class)
				.set(field(HubDashboard::getName), "Old name")
				.set(field(HubDashboard::getType), "geo")
				.set(field(HubDashboard::getStatus), DashboardStatus.DRAFT.getCode())
				.set(field(HubDashboard::getOptionalColumns), "creative,cpa")
				.set(field(HubDashboard::getDisplayCampaignName), "Acme - Summer")
				.set(field(HubDashboard::getSourceTable), "project.gs_templates.somewhere_else")
				.create();
		when(dashboardRepository.findByIdAndCampaignId(DASHBOARD_ID, CAMPAIGN_ID)).thenReturn(Optional.of(existing));
		when(dashboardRepository.existsByCampaignIdAndNameIgnoreCaseAndIdNot(CAMPAIGN_ID, "Old name", DASHBOARD_ID))
				.thenReturn(false);

		// When:
		HubDashboard result = service.update(CAMPAIGN_ID, DASHBOARD_ID, changes);

		// Then: the editable fields move, and the old source is kept but marked stale until it is updated
		assertThat(result.getName()).isEqualTo("Old name");
		assertThat(result.getOptionalColumns()).isEqualTo("creative,cpa");
		assertThat(result.getDisplayCampaignName()).isEqualTo("Acme - Summer");
		assertThat(result.getType()).isEqualTo(DashboardType.BASIC.getCode());
		assertThat(result.getStatus()).isEqualTo(DashboardStatus.DRAFT.getCode());
		assertThat(result.getSourceTable()).isEqualTo("project.gs_templates.client_dashboard");
		verify(cacheInvalidationEventService).publishUpdateEvent(HubDashboard.class);
	}

	@Test
	void shouldThrowOph034WhenUpdatingMissingDashboardTest() {
		// Given:
		HubDashboard changes = Instancio.of(HubDashboard.class)
				.set(field(HubDashboard::getName), "New name")
				.create();
		when(dashboardRepository.findByIdAndCampaignId(DASHBOARD_ID, CAMPAIGN_ID)).thenReturn(Optional.empty());

		// When-Then:
		assertThatThrownBy(() -> service.update(CAMPAIGN_ID, DASHBOARD_ID, changes))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", "OPH_034");
	}

	@Test
	void shouldRejectUpdateWhenNameDuplicateOfAnotherDashboardTest() {
		// Given: a draft, since a live dashboard cannot be renamed at all
		HubDashboard existing = Instancio.of(HubDashboard.class)
				.set(field(HubDashboard::getId), DASHBOARD_ID)
				.set(field(HubDashboard::getSourceTable), null)
				.create();
		HubDashboard changes = Instancio.of(HubDashboard.class)
				.set(field(HubDashboard::getName), "Client dashboard")
				.create();
		when(dashboardRepository.findByIdAndCampaignId(DASHBOARD_ID, CAMPAIGN_ID)).thenReturn(Optional.of(existing));
		when(dashboardRepository.existsByCampaignIdAndNameIgnoreCaseAndIdNot(CAMPAIGN_ID, "Client dashboard", DASHBOARD_ID))
				.thenReturn(true);

		// When-Then:
		assertThatThrownBy(() -> service.update(CAMPAIGN_ID, DASHBOARD_ID, changes))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", "OPH_035");
	}

	@Test
	void shouldDuplicateDashboardAsDraftWithoutSourceTest() {
		// Given:
		HubDashboard source = Instancio.of(HubDashboard.class)
				.set(field(HubDashboard::getName), "Client dashboard")
				.set(field(HubDashboard::getType), DashboardType.BASIC.getCode())
				.set(field(HubDashboard::getStatus), DashboardStatus.LIVE.getCode())
				.set(field(HubDashboard::getOptionalColumns), "creative,cpa")
				.set(field(HubDashboard::getSourceTable), "project.gs_templates.client_dashboard")
				.set(field(HubDashboard::getSourceRowCount), 123L)
				.set(field(HubDashboard::getSourceCreatedAt), LocalDateTime.now())
				.set(field(HubDashboard::getDisplayCampaignName), "Client-facing name")
				.create();
		when(dashboardRepository.findByIdAndCampaignId(DASHBOARD_ID, CAMPAIGN_ID)).thenReturn(Optional.of(source));
		when(dashboardRepository.existsByCampaignIdAndNameIgnoreCase(CAMPAIGN_ID, "Client dashboard (copy)"))
				.thenReturn(false);
		when(dashboardRepository.save(any(HubDashboard.class))).thenAnswer(invocation -> invocation.getArgument(0));

		// When:
		HubDashboard result = service.duplicate(CAMPAIGN_ID, DASHBOARD_ID);

		// Then: source table ownership starts over for the copy
		assertThat(result.getName()).isEqualTo("Client dashboard (copy)");
		assertThat(result.getType()).isEqualTo(DashboardType.BASIC.getCode());
		assertThat(result.getOptionalColumns()).isEqualTo("creative,cpa");
		assertThat(result.getDisplayCampaignName()).isEqualTo("Client-facing name");
		assertThat(result.getStatus()).isEqualTo(DashboardStatus.DRAFT.getCode());
		assertThat(result.getSourceTable()).isNull();
		assertThat(result.getSourceRowCount()).isNull();
		assertThat(result.getSourceCreatedAt()).isNull();
		verify(cacheInvalidationEventService).publishUpdateEvent(HubDashboard.class);
	}

	@Test
	void shouldTrimLongDashboardCopyNameTest() {
		// Given:
		String sourceName = "x".repeat(50);
		when(dashboardRepository.existsByCampaignIdAndNameIgnoreCase(CAMPAIGN_ID, "x".repeat(43) + " (copy)"))
				.thenReturn(false);

		// When:
		String copyName = service.copyName(CAMPAIGN_ID, sourceName);

		// Then:
		assertThat(copyName).isEqualTo("x".repeat(43) + " (copy)");
	}

	@Test
	void shouldPickNextFreeDashboardCopyNameTest() {
		// Given:
		when(dashboardRepository.existsByCampaignIdAndNameIgnoreCase(CAMPAIGN_ID, "Client dashboard (copy)"))
				.thenReturn(true);
		when(dashboardRepository.existsByCampaignIdAndNameIgnoreCase(CAMPAIGN_ID, "Client dashboard (copy 1)"))
				.thenReturn(false);

		// When:
		String copyName = service.copyName(CAMPAIGN_ID, "Client dashboard");

		// Then:
		assertThat(copyName).isEqualTo("Client dashboard (copy 1)");
	}

	@Test
	void shouldDeleteExistingDashboardTest() {
		// Given:
		HubDashboard existing = Instancio.create(HubDashboard.class);
		when(dashboardRepository.findByIdAndCampaignId(DASHBOARD_ID, CAMPAIGN_ID)).thenReturn(Optional.of(existing));

		// When:
		service.delete(CAMPAIGN_ID, DASHBOARD_ID);

		// Then:
		verify(dashboardRepository).delete(existing);
		verify(cacheInvalidationEventService).publishUpdateEvent(HubDashboard.class);
	}

	@Test
	void shouldThrowOph034WhenDeletingMissingDashboardTest() {
		// Given:
		when(dashboardRepository.findByIdAndCampaignId(DASHBOARD_ID, CAMPAIGN_ID)).thenReturn(Optional.empty());

		// When-Then:
		assertThatThrownBy(() -> service.delete(CAMPAIGN_ID, DASHBOARD_ID))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", "OPH_034");
	}

	@Test
	void shouldAttachSourceAndTurnDashboardLiveTest() {
		// Given:
		HubDashboard existing = Instancio.of(HubDashboard.class)
				.set(field(HubDashboard::getStatus), DashboardStatus.DRAFT.getCode())
				.set(field(HubDashboard::getSourceTable), null)
				.create();
		LocalDateTime writtenAt = LocalDateTime.of(2026, 8, 11, 9, 30);
		DashboardSource source = new DashboardSource(
				"silken-quasar-376417.gs_templates.acme_summer", 12_345L, writtenAt);
		when(dashboardRepository.findByIdAndCampaignId(DASHBOARD_ID, CAMPAIGN_ID)).thenReturn(Optional.of(existing));

		// When:
		HubDashboard result = service.attachSource(CAMPAIGN_ID, DASHBOARD_ID, source, "Acme - Summer");

		// Then: the table and the status it implies move together
		assertThat(result.getSourceTable()).isEqualTo("silken-quasar-376417.gs_templates.acme_summer");
		assertThat(result.getSourceRowCount()).isEqualTo(12_345L);
		assertThat(result.getSourceCreatedAt()).isEqualTo(writtenAt);
		assertThat(result.getStatus()).isEqualTo(DashboardStatus.LIVE.getCode());
		assertThat(result.getDisplayCampaignName()).isEqualTo("Acme - Summer");
		verify(cacheInvalidationEventService).publishUpdateEvent(HubDashboard.class);
	}

	@Test
	void shouldKeepTheDisplayedNameWhenTheConfirmDialogLeftItAloneTest() {
		// Given: nothing typed into the dialog's name field, which is not the same as clearing it
		HubDashboard existing = Instancio.of(HubDashboard.class)
				.set(field(HubDashboard::getDisplayCampaignName), "Acme - Summer")
				.create();
		DashboardSource source = new DashboardSource("p.gs_templates.acme", 1L, LocalDateTime.of(2026, 8, 11, 9, 30));
		when(dashboardRepository.findByIdAndCampaignId(DASHBOARD_ID, CAMPAIGN_ID)).thenReturn(Optional.of(existing));

		// When:
		HubDashboard result = service.attachSource(CAMPAIGN_ID, DASHBOARD_ID, source, null);

		// Then:
		assertThat(result.getDisplayCampaignName()).isEqualTo("Acme - Summer");
	}

	@Test
	void shouldDetachSourceAndReturnDashboardToDraftTest() {
		// Given:
		HubDashboard existing = Instancio.of(HubDashboard.class)
				.set(field(HubDashboard::getStatus), DashboardStatus.LIVE.getCode())
				.set(field(HubDashboard::getSourceTable), "silken-quasar-376417.gs_templates.acme_summer")
				.set(field(HubDashboard::getSourceRowCount), 12_345L)
				.create();
		when(dashboardRepository.findByIdAndCampaignId(DASHBOARD_ID, CAMPAIGN_ID)).thenReturn(Optional.of(existing));

		// When:
		HubDashboard result = service.detachSource(CAMPAIGN_ID, DASHBOARD_ID);

		// Then:
		assertThat(result.getSourceTable()).isNull();
		assertThat(result.getSourceRowCount()).isNull();
		assertThat(result.getSourceCreatedAt()).isNull();
		assertThat(result.getStatus()).isEqualTo(DashboardStatus.DRAFT.getCode());
		verify(cacheInvalidationEventService).publishUpdateEvent(HubDashboard.class);
	}

	@Test
	void shouldRefuseToRenameADashboardThatAlreadyHasADataSourceTest() {
		// Given: a live dashboard, whose name is half of the BigQuery table name ClicData was pointed at
		HubDashboard existing = Instancio.of(HubDashboard.class)
				.set(field(HubDashboard::getId), DASHBOARD_ID)
				.set(field(HubDashboard::getName), "Client dashboard")
				.set(field(HubDashboard::getSourceTable), "silken-quasar-376417.gs_templates.acme_report_basic_dash_client_dashboard")
				.create();
		HubDashboard changes = Instancio.of(HubDashboard.class)
				.set(field(HubDashboard::getName), "Client dashboard v2")
				.create();
		when(dashboardRepository.findByIdAndCampaignId(DASHBOARD_ID, CAMPAIGN_ID)).thenReturn(Optional.of(existing));

		// When-Then: renaming would write a second table and leave ClicData on the first one
		assertThatThrownBy(() -> service.update(CAMPAIGN_ID, DASHBOARD_ID, changes))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", "OPH_042")
				.hasMessageContaining("Remove the data source before renaming");
	}

	@Test
	void shouldStillAcceptOtherEditsToALiveDashboardTest() {
		// Given: the same live dashboard, edited without touching its name
		HubDashboard existing = Instancio.of(HubDashboard.class)
				.set(field(HubDashboard::getId), DASHBOARD_ID)
				.set(field(HubDashboard::getName), "Client dashboard")
				.set(field(HubDashboard::getSourceTable), "silken-quasar-376417.gs_templates.acme_report_basic_dash_client_dashboard")
				.create();
		HubDashboard changes = Instancio.of(HubDashboard.class)
				.set(field(HubDashboard::getName), "Client dashboard")
				.set(field(HubDashboard::getOptionalColumns), "creative")
				.create();
		when(dashboardRepository.findByIdAndCampaignId(DASHBOARD_ID, CAMPAIGN_ID)).thenReturn(Optional.of(existing));
		when(dashboardRepository.existsByCampaignIdAndNameIgnoreCaseAndIdNot(CAMPAIGN_ID, "Client dashboard", DASHBOARD_ID))
				.thenReturn(false);

		// When:
		HubDashboard result = service.update(CAMPAIGN_ID, DASHBOARD_ID, changes);

		// Then: only the name is frozen - the schema choice is what "Update data source" exists to rewrite
		assertThat(result.getOptionalColumns()).isEqualTo("creative");
	}
}
