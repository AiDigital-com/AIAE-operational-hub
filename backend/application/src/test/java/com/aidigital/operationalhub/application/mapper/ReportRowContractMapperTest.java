package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.DirectionEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportRowAdjustmentV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportRowFilterFieldEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportRowFilterV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportRowSearchRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportRowSortFieldEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportRowTotalsV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportRowV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ReportRowsPageResponseV1;
import com.aidigital.operationalhub.service.agency.model.AdjustmentRowModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowFilterModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowPageModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowTotalsModel;
import com.aidigital.operationalhub.service.agency.search.ReportRowSortField;
import com.aidigital.operationalhub.service.common.search.SortDirection;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDate;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link ReportRowContractMapper}.
 */
@ExtendWith(MockitoExtension.class)
class ReportRowContractMapperTest {

	@InjectMocks
	private ReportRowContractMapper mapper;

	@Test
	void shouldMapEveryFieldTest() {
		// Given:
		ReportRowModel model = Instancio.create(ReportRowModel.class);

		// When:
		ReportRowV1 v1 = mapper.toV1(model);

		// Then:
		assertThat(v1.getDate()).isEqualTo(model.date());
		assertThat(v1.getPlatform()).isEqualTo(model.platform());
		assertThat(v1.getAccount()).isEqualTo(model.account());
		assertThat(v1.getAccountId()).isEqualTo(model.accountId());
		assertThat(v1.getLineItemName()).isEqualTo(model.lineItemName());
		assertThat(v1.getLineItemId()).isEqualTo(model.lineItemId());
		assertThat(v1.getInsertionOrderName()).isEqualTo(model.insertionOrderName());
		assertThat(v1.getInsertionOrderId()).isEqualTo(model.insertionOrderId());
		assertThat(v1.getCampaignConstructedName()).isEqualTo(model.campaignConstructedName());
		assertThat(v1.getCampaignConstructedId()).isEqualTo(model.campaignConstructedId());
		assertThat(v1.getAgencyId()).isEqualTo(model.agencyId());
		assertThat(v1.getClient()).isEqualTo(model.client());
		assertThat(v1.getIndustryCode()).isEqualTo(model.industryCode());
		assertThat(v1.getCampaignName()).isEqualTo(model.campaignName());
		assertThat(v1.getChannel()).isEqualTo(model.channel());
		assertThat(v1.getTactic()).isEqualTo(model.tactic());
		assertThat(v1.getBuyingModel()).isEqualTo(model.buyingModel());
		assertThat(v1.getAudience()).isEqualTo(model.audience());
		assertThat(v1.getUniqueLineItemId()).isEqualTo(model.uniqueLineItemId());
		assertThat(v1.getOther()).isEqualTo(model.other());
		assertThat(v1.getGeo()).isEqualTo(model.geo());
		assertThat(v1.getCreativeTag()).isEqualTo(model.creativeTag());
		assertThat(v1.getMessage()).isEqualTo(model.message());
		assertThat(v1.getKeywordGroup()).isEqualTo(model.keywordGroup());
		assertThat(v1.getFlightIdentifier()).isEqualTo(model.flightIdentifier());
		assertThat(v1.getLanguage()).isEqualTo(model.language());
		assertThat(v1.getImpressions()).isEqualTo(model.impressions());
		assertThat(v1.getClicks()).isEqualTo(model.clicks());
		assertThat(v1.getSpend()).isEqualTo(model.spend());
		assertThat(v1.getStarts()).isEqualTo(model.starts());
		assertThat(v1.getFirstQuartiles()).isEqualTo(model.firstQuartiles());
		assertThat(v1.getMidpoints()).isEqualTo(model.midpoints());
		assertThat(v1.getThirdQuartiles()).isEqualTo(model.thirdQuartiles());
		assertThat(v1.getCompletes()).isEqualTo(model.completes());
		assertThat(v1.getConversions()).isEqualTo(model.conversions());
		assertThat(v1.getPostClickConversions()).isEqualTo(model.postClickConversions());
		assertThat(v1.getPostViewConversions()).isEqualTo(model.postViewConversions());
		assertThat(v1.getDynamicCost()).isEqualTo(model.dynamicCost());
		assertThat(v1.getLinkClicks()).isEqualTo(model.linkClicks());
		assertThat(v1.getAdjustedMetrics()).isEqualTo(model.adjustedMetrics());
		assertThat(v1.getCreatedAt()).isEqualTo(model.createdAt());
		assertThat(v1.getCreatedBy()).isEqualTo(model.createdBy());
		assertThat(v1.getLastModifiedAt()).isEqualTo(model.lastModifiedAt());
		assertThat(v1.getLastModifiedBy()).isEqualTo(model.lastModifiedBy());
		assertThat(v1.getRateType()).isEqualTo(model.rateType());
		assertThat(v1.getDynamicRate()).isEqualTo(model.dynamicRate());
		assertThat(v1.getAvgDynamicRateByDateTactic()).isEqualTo(model.avgDynamicRateByDateTactic());
		assertThat(v1.getLineItemDescription()).isEqualTo(model.lineItemDescription());
	}

	@Test
	void shouldMapTheFilterFieldOntoTheSameSortFieldByNameTest() {
		// When:
		ReportRowSortField field = mapper.toFilterField(ReportRowFilterFieldEnumV1.CHANNEL);

		// Then:
		assertThat(field).isEqualTo(ReportRowSortField.CHANNEL);
	}

	@Test
	void shouldMapAReportRowSearchRequestIntoOneCommandTest() {
		// Given:
		ReportRowFilterV1 filter = new ReportRowFilterV1();
		filter.setField(ReportRowFilterFieldEnumV1.CHANNEL);
		filter.setValues(List.of("Display", "Video"));
		ReportRowSearchRequestV1 request = new ReportRowSearchRequestV1();
		request.setGroupBy(List.of(ReportRowFilterFieldEnumV1.DATE, ReportRowFilterFieldEnumV1.CHANNEL));
		request.setSortField(ReportRowSortFieldEnumV1.CHANNEL);
		request.setSortDirection(DirectionEnumV1.DESC);
		request.setFilters(List.of(filter));
		request.setDateFrom(LocalDate.parse("2026-03-10"));
		request.setDateTo(LocalDate.parse("2026-03-20"));
		request.setDimensions(List.of("date", "line_item_id"));
		request.setMetrics(List.of("impressions", "spend"));
		request.setColumnOrder(List.of("impressions", "date", "line_item_id"));

		// When:
		ReportRowSearchCommand command = mapper.toSearchCommand(request);

		// Then:
		assertThat(command.groupBy()).containsExactly(ReportRowSortField.DATE, ReportRowSortField.CHANNEL);
		assertThat(command.sort().field()).isEqualTo(ReportRowSortField.CHANNEL);
		assertThat(command.sort().direction()).isEqualTo(SortDirection.DESC);
		assertThat(command.filters()).containsExactly(
				new ReportRowFilterModel(ReportRowSortField.CHANNEL, List.of("Display", "Video")));
		assertThat(command.dateRange().from()).isEqualTo("2026-03-10");
		assertThat(command.dateRange().to()).isEqualTo("2026-03-20");
		assertThat(command.columns()).containsExactly("date", "line_item_id", "impressions", "spend");
		assertThat(command.columnOrder()).containsExactly("impressions", "date", "line_item_id");
	}

	@Test
	void shouldMapAnAbsentColumnOrderThroughUnchangedWhenTheRequestCarriesNoneTest() {
		// Given: a request that never set columnOrder at all
		ReportRowSearchRequestV1 request = new ReportRowSearchRequestV1();

		// When:
		ReportRowSearchCommand command = mapper.toSearchCommand(request);

		// Then: passed through untouched - toSearchCommand does not invent a default here
		assertThat(command.columnOrder()).isEmpty();
	}

	@Test
	void shouldMapANullColumnOrderThroughUnchangedWhenTheRequestIsNullTest() {
		// When:
		ReportRowSearchCommand command = mapper.toSearchCommand(null);

		// Then:
		assertThat(command.columnOrder()).isNull();
	}

	@Test
	void shouldMapListOfRowsTest() {
		// Given:
		List<ReportRowModel> models = List.of(Instancio.create(ReportRowModel.class), Instancio.create(ReportRowModel.class));

		// When:
		List<ReportRowV1> result = mapper.toV1(models);

		// Then:
		assertThat(result).hasSize(2);
		assertThat(result.get(0).getLineItemId()).isEqualTo(models.get(0).lineItemId());
		assertThat(result.get(1).getLineItemId()).isEqualTo(models.get(1).lineItemId());
	}

	@Test
	void shouldMapTotalsIncludingDerivedMetricsTest() {
		// Given:
		ReportRowTotalsModel totals = Instancio.create(ReportRowTotalsModel.class);

		// When:
		ReportRowTotalsV1 v1 = mapper.toV1(totals);

		// Then:
		assertThat(v1.getImpressions()).isEqualTo(totals.impressions());
		assertThat(v1.getClicks()).isEqualTo(totals.clicks());
		assertThat(v1.getSpend()).isEqualTo(totals.spend());
		assertThat(v1.getDynamicCost()).isEqualTo(totals.dynamicCost());
		assertThat(v1.getCpm()).isEqualTo(totals.cpm());
		assertThat(v1.getCtr()).isEqualTo(totals.ctr());
		assertThat(v1.getAvcr()).isEqualTo(totals.avcr());
	}

	@Test
	void shouldMapPageResponseTest() {
		// Given:
		ReportRowModel row = Instancio.create(ReportRowModel.class);
		ReportRowTotalsModel totals = Instancio.create(ReportRowTotalsModel.class);
		ReportRowPageModel page = new ReportRowPageModel(
				List.of(row), 2, 25, true, 138L, totals, "2026-01-01", "2026-06-30", 12L);

		// When:
		ReportRowsPageResponseV1 response = mapper.toPageResponse(page);

		// Then:
		assertThat(response.getPageNumber()).isEqualTo(2);
		assertThat(response.getPageSize()).isEqualTo(25);
		assertThat(response.getHasNext()).isTrue();
		assertThat(response.getTotalRows()).isEqualTo(138L);
		assertThat(response.getContent()).hasSize(1);
		assertThat(response.getContent().get(0).getLineItemId()).isEqualTo(row.lineItemId());
		assertThat(response.getTotals().getImpressions()).isEqualTo(totals.impressions());
		assertThat(response.getMinDate()).isEqualTo("2026-01-01");
		assertThat(response.getMaxDate()).isEqualTo("2026-06-30");
		assertThat(response.getDistinctLineItemCount()).isEqualTo(12L);
	}

	@Test
	void shouldMapAnOverrideAdjustmentDtoToItsModelTest() {
		// Given:
		ReportRowAdjustmentV1 v1 = new ReportRowAdjustmentV1();
		v1.setAdded(false);
		v1.setDate("2026-03-10");
		v1.setLineItemId("LI-1");
		v1.setChannel("Display");
		v1.setImpressions(1234L);
		v1.setSpend(56.7);

		// When:
		AdjustmentRowModel model = mapper.toModel(v1);

		// Then:
		assertThat(model.added()).isFalse();
		assertThat(model.date()).isEqualTo("2026-03-10");
		assertThat(model.lineItemId()).isEqualTo("LI-1");
		assertThat(model.channel()).isEqualTo("Display");
		assertThat(model.impressions()).isEqualTo(1234L);
		assertThat(model.spend()).isEqualTo(56.7);
	}

	@Test
	void shouldMapAManuallyAddedAdjustmentDtoTest() {
		// Given:
		ReportRowAdjustmentV1 v1 = new ReportRowAdjustmentV1();
		v1.setAdded(true);
		v1.setDate("2026-03-15");
		v1.setLineItemName("New Line");
		v1.setLineItemId("LI-NEW");

		// When:
		AdjustmentRowModel model = mapper.toModel(v1);

		// Then:
		assertThat(model.added()).isTrue();
		assertThat(model.lineItemName()).isEqualTo("New Line");
		assertThat(model.lineItemId()).isEqualTo("LI-NEW");
	}

	@Test
	void shouldMapAListOfAdjustmentDtosTest() {
		// Given:
		ReportRowAdjustmentV1 first = new ReportRowAdjustmentV1();
		first.setAdded(false);
		first.setImpressions(1L);
		ReportRowAdjustmentV1 second = new ReportRowAdjustmentV1();
		second.setAdded(true);
		second.setLineItemId("LI-NEW");

		// When:
		List<AdjustmentRowModel> models = mapper.toAdjustmentModels(List.of(first, second));

		// Then:
		assertThat(models).hasSize(2);
		assertThat(models.get(0).added()).isFalse();
		assertThat(models.get(1).added()).isTrue();
	}

	@Test
	void shouldReturnAnEmptyListWhenNoAdjustmentsWereRequestedTest() {
		// When:
		List<AdjustmentRowModel> models = mapper.toAdjustmentModels(null);

		// Then:
		assertThat(models).isEmpty();
	}
}
