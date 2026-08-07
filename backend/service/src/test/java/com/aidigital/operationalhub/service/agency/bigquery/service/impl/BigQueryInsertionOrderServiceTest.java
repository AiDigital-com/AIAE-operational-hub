package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.externalservices.bigquery.BigQueryClient;
import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import com.aidigital.operationalhub.externalservices.bigquery.exception.BigQueryExternalException;
import com.aidigital.operationalhub.service.agency.CampaignService;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQuerySearchGateway;
import com.aidigital.operationalhub.service.agency.bigquery.service.CachedBigQuerySearchExecutor;
import com.aidigital.operationalhub.service.agency.model.CampaignModel;
import com.aidigital.operationalhub.service.agency.model.InsertionOrderModel;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link BigQueryInsertionOrderService}, which reads a flat, line-item-grained query
 * over the IO Lines table via a real {@link BigQuerySearchGateway} (over a mocked client) and groups
 * the rows into insertion orders in Java.
 */
@ExtendWith(MockitoExtension.class)
class BigQueryInsertionOrderServiceTest {

	private static final String DATA_QUERY = "`campaign_id` IN (46252)";

	@Mock
	private BigQueryClient bigQueryClient;

	@Mock
	private BigQueryProperties bigQueryProperties;

	@Mock
	private CampaignService campaignService;

	private BigQueryInsertionOrderService service;

	@BeforeEach
	void setUp() {
		service = new BigQueryInsertionOrderService(
				new BigQuerySearchGateway(
						bigQueryClient, bigQueryProperties, new CachedBigQuerySearchExecutor(bigQueryClient)),
				campaignService);
	}

	private Map<String, Object> lineItemRow(long orderId, String orderNumber, String status,
	                                        String startDate, String endDate, double orderBudget,
	                                        long lineItemId, String description, String mediaTactic,
	                                        String rateType, double tacticBudget, String liStart, String liEnd) {
		Map<String, Object> row = new HashMap<>();
		row.put("order_id", orderId);
		row.put("order_number", orderNumber);
		row.put("order_status", status);
		row.put("order_start_date", startDate);
		row.put("order_end_date", endDate);
		row.put("order_budget", orderBudget);
		row.put("line_item_id", lineItemId);
		row.put("description", description);
		row.put("media_tactic", mediaTactic);
		row.put("rate_type", rateType);
		row.put("tactic_budget", tacticBudget);
		row.put("start_date", liStart);
		row.put("end_date", liEnd);
		return row;
	}

	@Test
	void shouldGroupFourLineItemRowsOfOneOrderIntoOneInsertionOrderTest() {
		// Given: the reference case - one order, four line items, order_budget repeated on every row
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(campaignService.getVisibleCampaign(any(), anyLong())).thenReturn(anyCampaign());
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				lineItemRow(276198L, "SO276198", "Live", "2026-06-17", "2026-09-17", 45000.0,
						1001L, "CTV line", "CTV/OTT", "Flat", 15000.0, "2026-06-17", "2026-09-17"),
				lineItemRow(276198L, "SO276198", "Live", "2026-06-17", "2026-09-17", 45000.0,
						1002L, "YouTube line", "YouTube", "CPM", 10000.0, "2026-06-17", "2026-09-17"),
				lineItemRow(276198L, "SO276198", "Live", "2026-06-17", "2026-09-17", 45000.0,
						1003L, "Native line", "Native", "CPM", 10000.0, "2026-06-17", "2026-09-17"),
				lineItemRow(276198L, "SO276198", "Live", "2026-06-17", "2026-09-17", 45000.0,
						1004L, "Audio line", "Audio", "CPM", 10000.0, "2026-06-17", "2026-09-17")
		));

		// When:
		List<InsertionOrderModel> result = service.findCampaignInsertionOrders(null, 46252L);

		// Then:
		assertThat(result).hasSize(1);
		InsertionOrderModel io = result.get(0);
		assertThat(io.orderId()).isEqualTo(276198L);
		assertThat(io.orderNumber()).isEqualTo("SO276198");
		assertThat(io.budget()).isEqualTo(45000.0);
		assertThat(io.lineItems()).hasSize(4);
		assertThat(io.lineItems()).extracting("lineItemId").containsExactly(1001L, 1002L, 1003L, 1004L);
		assertThat(io.lineItems()).extracting("rateType").containsExactly("Flat", "CPM", "CPM", "CPM");
		assertThat(io.mediaTactics()).containsExactly("CTV/OTT", "YouTube", "Native", "Audio");
	}

	@Test
	void shouldReturnOrdersInQueryOrderWithLineItemsInRowOrderTest() {
		// Given: two orders interleaved by the SQL's own ordering
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(campaignService.getVisibleCampaign(any(), anyLong())).thenReturn(anyCampaign());
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(
				lineItemRow(200L, "SO200", "Live", "2026-01-01", "2026-03-31", 10000.0,
						1L, "First", "Display", "CPM", 10000.0, "2026-01-01", "2026-03-31"),
				lineItemRow(100L, "SO100", "Finished", "2025-10-01", "2025-12-31", 20000.0,
						2L, "Second", "Video", "CPM", 20000.0, "2025-10-01", "2025-12-31")
		));

		// When:
		List<InsertionOrderModel> result = service.findCampaignInsertionOrders(null, 46252L);

		// Then: grouping preserves first-seen order, not a re-sort by order_id
		assertThat(result).extracting(InsertionOrderModel::orderId).containsExactly(200L, 100L);
	}

	@Test
	void shouldFilterByTheRequestedCampaignIdAndOrderByOrderThenLineItemTest() {
		// Given:
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(campaignService.getVisibleCampaign(any(), anyLong())).thenReturn(anyCampaign());
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of());

		// When:
		service.findCampaignInsertionOrders(null, 46252L);

		// Then:
		ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
		verify(bigQueryClient, times(1)).query(sql.capture());
		String query = sql.getValue();
		assertThat(query).contains("`campaign_id` IN (46252)");
		assertThat(query).contains("ORDER BY `order_id` ASC NULLS LAST, `line_item_id` ASC");
		assertThat(query).contains("`order_number`");
		assertThat(query).contains("`order_status`");
		assertThat(query).contains("`order_start_date`");
		assertThat(query).contains("`order_end_date`");
		assertThat(query).contains("`order_budget`");
		assertThat(query).contains("`line_item_id`");
		assertThat(query).contains("`description`");
		assertThat(query).contains("`media_tactic`");
		assertThat(query).contains("`rate_type`");
		assertThat(query).contains("`tactic_budget`");
		assertThat(query).contains("`start_date`");
		assertThat(query).contains("`end_date`");
	}

	@Test
	void shouldPropagateUnknownCampaignAsBusinessExceptionTest() {
		// Given:
		when(campaignService.getVisibleCampaign(any(), anyLong()))
				.thenThrow(new BusinessException(OperationalHubErrorReason.OPH_025, 1L));

		// When/Then:
		assertThatThrownBy(() -> service.findCampaignInsertionOrders(null, 1L))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", "OPH_025");
		verifyNoInteractions(bigQueryClient);
	}

	@Test
	void shouldTranslateBigQueryFailureIntoBusinessExceptionTest() {
		// Given:
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(campaignService.getVisibleCampaign(any(), anyLong())).thenReturn(anyCampaign());
		when(bigQueryClient.query(contains(DATA_QUERY))).thenThrow(new BigQueryExternalException("boom"));

		// When/Then:
		assertThatThrownBy(() -> service.findCampaignInsertionOrders(null, 46252L))
				.isInstanceOf(BusinessException.class)
				.hasFieldOrPropertyWithValue("code", "OPH_018");
	}

	@Test
	void shouldTolerateNullDescriptionTacticBudgetAndDatesTest() {
		// Given: every line-item column is nullable
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(campaignService.getVisibleCampaign(any(), anyLong())).thenReturn(anyCampaign());
		Map<String, Object> row = new HashMap<>();
		row.put("order_id", 1L);
		row.put("line_item_id", 2L);
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(List.of(row));

		// When:
		List<InsertionOrderModel> result = service.findCampaignInsertionOrders(null, 46252L);

		// Then: no exception, nulls pass through
		assertThat(result).hasSize(1);
		InsertionOrderModel io = result.get(0);
		assertThat(io.orderNumber()).isNull();
		assertThat(io.budget()).isNull();
		assertThat(io.mediaTactics()).isEmpty();
		assertThat(io.lineItems().get(0).description()).isNull();
		assertThat(io.lineItems().get(0).rateType()).isNull();
		assertThat(io.lineItems().get(0).budget()).isNull();
	}

	@Test
	void shouldCapLineItemsAtTheConfiguredLimitTest() {
		// Given: more rows than the configured cap
		when(bigQueryProperties.getIoLinesTable()).thenReturn("io_lines");
		when(campaignService.getVisibleCampaign(any(), anyLong())).thenReturn(anyCampaign());
		List<Map<String, Object>> rows = new ArrayList<>();
		for (long i = 0; i < 5001; i++) {
			rows.add(lineItemRow(1L, "SO1", "Live", "2026-01-01", "2026-12-31", 1000.0,
					i, "LI " + i, "Display", "CPM", 1.0, "2026-01-01", "2026-12-31"));
		}
		when(bigQueryClient.query(contains(DATA_QUERY))).thenReturn(rows);

		// When:
		List<InsertionOrderModel> result = service.findCampaignInsertionOrders(null, 46252L);

		// Then: dropped past the cap, not silently kept
		assertThat(result.get(0).lineItems()).hasSize(5000);
	}

	private CampaignModel anyCampaign() {
		return new CampaignModel(46252L, "Financial Partners Credit Union Summer 2026", 1L, "Client",
				2L, "Agency", "Live", "2026-06-17", "2026-09-17", 45000.0, List.of("CTV/OTT"), "Finance", 4L);
	}
}
