package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.service.agency.AdjustmentRollbackLimits;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqDelete;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRequest;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRow;
import com.aidigital.operationalhub.service.agency.bigquery.model.CampaignDeliveryScope;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQuerySearchGateway;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQueryWriteGateway;
import com.aidigital.operationalhub.service.agency.model.AdjustmentRollbackResultModel;
import com.aidigital.operationalhub.service.agency.model.CampaignModel;
import com.aidigital.operationalhub.service.entity.HubSyncLockService;
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
import java.util.function.Function;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.atLeast;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for {@link AdjustmentRollbackWriter}. Its two collaborating gateways are mocked at the
 * boundary: {@link BigQuerySearchGateway#fetch} is stubbed per query by matching a distinguishing
 * substring of the rendered SQL, and {@link BigQueryWriteGateway#delete} is captured to assert the exact
 * {@code DELETE} statements the writer builds - the evidence this task asks for in place of a live
 * BigQuery run.
 */
@ExtendWith(MockitoExtension.class)
class AdjustmentRollbackWriterTest {

	private static final String DELIVERY_TABLE = "test-project.operational_hub.platform_mart_operational_hub_adjustements";
	private static final String CONVERSIONS_TABLE = "test-project.operational_hub.conversions_mart_operational_hub_adjustments";

	@Mock
	private BigQuerySearchGateway gateway;

	@Mock
	private BigQueryWriteGateway writeGateway;

	@Mock
	private HubSyncLockService syncLockService;

	private AdjustmentRollbackWriter writer;

	@BeforeEach
	void setUp() {
		writer = new AdjustmentRollbackWriter(gateway, writeGateway, syncLockService);
	}

	private CampaignDeliveryScope scope() {
		CampaignModel campaign = new CampaignModel(
				42L, "Ourisman Ford 2026", null, null, null, null, null, null, null, null, List.of(), null, null);
		return new CampaignDeliveryScope(
				campaign,
				new BqRequest("SELECT 42 AS `campaign_id`, 'uli-1' AS `line_item_id`"),
				new BqRequest("SELECT 'Retargeting' AS `constructed_name`"));
	}

	private void givenScopeAllows(String... constructedNames) {
		// Matched by the fixed FROM-subquery text scope() always embeds ("FROM (SELECT 'Retargeting' ...")
		// rather than by "constructed_name" alone, which also appears in the delivery/conversions key
		// queries' WHERE clause (always lower-cased there, so it never collides with this exact literal).
		List<Map<String, Object>> rows = new ArrayList<>();
		for (String name : constructedNames) {
			rows.add(Map.of("constructed_name", name));
		}
		stubFetch("FROM (SELECT 'Retargeting'", rows);
	}

	private Map<String, Object> deliveryKeyRow(String date, String accountId, String constructedId,
			String constructedIdLvl2, String constructedIdLvl3) {
		Map<String, Object> row = new HashMap<>();
		row.put("date", date);
		row.put("account_id", accountId);
		row.put("constructed_id", constructedId);
		row.put("constructed_id_lvl2", constructedIdLvl2);
		row.put("constructed_id_lvl3", constructedIdLvl3);
		return row;
	}

	private Map<String, Object> conversionKeyRow(String date, String accountId, String constructedId,
			String constructedIdLvl2, String constructedIdLvl3, String conversionAction, String conversionCategory) {
		Map<String, Object> row = deliveryKeyRow(date, accountId, constructedId, constructedIdLvl2, constructedIdLvl3);
		row.put("conversion_action", conversionAction);
		row.put("conversion_category", conversionCategory);
		return row;
	}

	private void givenDeliveryKeys(List<Map<String, Object>> rows) {
		stubFetch(DELIVERY_TABLE, rows);
	}

	private void givenConversionKeys(List<Map<String, Object>> rows) {
		stubFetch(CONVERSIONS_TABLE, rows);
	}

	@SuppressWarnings("unchecked")
	private void stubFetch(String sqlContains, List<Map<String, Object>> rawRows) {
		when(gateway.fetch(argThat(request -> request != null && request.sql().contains(sqlContains)), any()))
				.thenAnswer(invocation -> {
					Function<BqRow, Object> mapper = invocation.getArgument(1);
					List<Object> mapped = new ArrayList<>();
					for (Map<String, Object> row : rawRows) {
						mapped.add(mapper.apply(new BqRow(row)));
					}
					return mapped;
				});
	}

	private void givenTables() {
		when(writeGateway.writeTable()).thenReturn(DELIVERY_TABLE);
		when(writeGateway.conversionsWriteTable()).thenReturn(CONVERSIONS_TABLE);
	}

	@Test
	void shouldRejectARequestedNameOutsideTheResolvedScopeTest() {
		// Given: the campaign's own scope only ever produced "Retargeting"
		givenScopeAllows("Retargeting");

		// When/Then:
		assertThatThrownBy(() -> writer.preview(scope(), List.of("Prospecting"), "2026-01-01", "2026-01-31"))
				.isInstanceOf(BusinessException.class)
				.extracting(ex -> ((BusinessException) ex).getCode())
				.isEqualTo(OperationalHubErrorReason.OPH_050.getCode());
	}

	@Test
	void shouldMatchAScopedNameCaseInsensitivelyTest() {
		// Given: the MDA tool matches with LOWER(...), so casing differences must not fail validation
		givenScopeAllows("Retargeting");
		givenTables();
		givenDeliveryKeys(List.of());
		givenConversionKeys(List.of());

		// When:
		AdjustmentRollbackResultModel result =
				writer.preview(scope(), List.of("RETARGETING"), "2026-01-01", "2026-01-31");

		// Then:
		assertThat(result).isEqualTo(new AdjustmentRollbackResultModel(0, 0));
	}

	@Test
	void shouldRejectAnEmptySelectionTest() {
		// When/Then:
		assertThatThrownBy(() -> writer.preview(scope(), List.of(), "2026-01-01", "2026-01-31"))
				.isInstanceOf(BusinessException.class)
				.extracting(ex -> ((BusinessException) ex).getCode())
				.isEqualTo(OperationalHubErrorReason.OPH_027.getCode());
	}

	@Test
	void shouldRejectABlankNameInTheSelectionTest() {
		// When/Then:
		assertThatThrownBy(() -> writer.preview(scope(), List.of(" "), "2026-01-01", "2026-01-31"))
				.isInstanceOf(BusinessException.class)
				.extracting(ex -> ((BusinessException) ex).getCode())
				.isEqualTo(OperationalHubErrorReason.OPH_027.getCode());
	}

	@Test
	void shouldRejectASelectionOverTheMaxCampaignNamesLimitTest() {
		// Given: one more name than AdjustmentRollbackLimits.MAX_CAMPAIGN_NAMES allows - enforced here
		// server-side, not left to the generated request's own maxItems validation alone
		List<String> tooMany = new ArrayList<>();
		for (int i = 0; i <= AdjustmentRollbackLimits.MAX_CAMPAIGN_NAMES; i++) {
			tooMany.add("Campaign " + i);
		}

		// When/Then:
		assertThatThrownBy(() -> writer.preview(scope(), tooMany, "2026-01-01", "2026-01-31"))
				.isInstanceOf(BusinessException.class)
				.extracting(ex -> ((BusinessException) ex).getCode())
				.isEqualTo(OperationalHubErrorReason.OPH_027.getCode());
	}

	@Test
	void shouldDeleteNothingDuringPreviewTest() {
		// Given:
		givenScopeAllows("Retargeting");
		givenTables();
		givenDeliveryKeys(List.of(deliveryKeyRow("2026-01-05", "acct-1", "cid-1", "cid2-1", "cid3-1")));
		givenConversionKeys(List.of(
				conversionKeyRow("2026-01-05", "acct-1", "cid-1", "cid2-1", "cid3-1", "Purchase", "Sale")));

		// When:
		AdjustmentRollbackResultModel result =
				writer.preview(scope(), List.of("Retargeting"), "2026-01-01", "2026-01-31");

		// Then: the key-set sizes are reported, but nothing is deleted and no lock is touched
		assertThat(result).isEqualTo(new AdjustmentRollbackResultModel(1, 1));
		verify(writeGateway, never()).delete(any());
		verify(syncLockService, never()).tryAcquire(any());
	}

	@Test
	void shouldRejectWhenAnotherRollbackHoldsTheLockTest() {
		// Given:
		givenScopeAllows("Retargeting");
		when(syncLockService.tryAcquire(any())).thenReturn(false);

		// When/Then:
		assertThatThrownBy(() -> writer.rollback(scope(), List.of("Retargeting"), "2026-01-01", "2026-01-31"))
				.isInstanceOf(BusinessException.class)
				.extracting(ex -> ((BusinessException) ex).getCode())
				.isEqualTo(OperationalHubErrorReason.OPH_033.getCode());
		verify(syncLockService, never()).release(any());
		verify(writeGateway, never()).delete(any());
	}

	@Test
	void shouldAcquireAndReleaseTheLockAroundASuccessfulRollbackTest() {
		// Given:
		givenScopeAllows("Retargeting");
		givenTables();
		givenDeliveryKeys(List.of(deliveryKeyRow("2026-01-05", "acct-1", "cid-1", "cid2-1", "cid3-1")));
		givenConversionKeys(List.of());
		when(syncLockService.tryAcquire("adjustment_rollback:campaign:42")).thenReturn(true);
		when(writeGateway.delete(any(BqDelete.class))).thenReturn(1L);

		// When:
		writer.rollback(scope(), List.of("Retargeting"), "2026-01-01", "2026-01-31");

		// Then: acquired before, released after, in that order
		var order = inOrder(syncLockService, writeGateway);
		order.verify(syncLockService).tryAcquire("adjustment_rollback:campaign:42");
		order.verify(writeGateway).delete(any(BqDelete.class));
		order.verify(syncLockService).release("adjustment_rollback:campaign:42");
	}

	@Test
	void shouldReleaseTheLockWhenTheDeleteFailsTest() {
		// Given:
		givenScopeAllows("Retargeting");
		givenTables();
		givenDeliveryKeys(List.of(deliveryKeyRow("2026-01-05", "acct-1", "cid-1", "cid2-1", "cid3-1")));
		givenConversionKeys(List.of());
		when(syncLockService.tryAcquire(any())).thenReturn(true);
		when(writeGateway.delete(any(BqDelete.class)))
				.thenThrow(new BusinessException(OperationalHubErrorReason.OPH_026, "boom"));

		// When/Then:
		assertThatThrownBy(() -> writer.rollback(scope(), List.of("Retargeting"), "2026-01-01", "2026-01-31"))
				.isInstanceOf(BusinessException.class)
				.extracting(ex -> ((BusinessException) ex).getCode())
				.isEqualTo(OperationalHubErrorReason.OPH_026.getCode());
		verify(syncLockService).release("adjustment_rollback:campaign:42");
		verify(gateway, never()).evictSearchCache();
	}

	@Test
	void shouldDeleteFromBothTablesAndSumTheReportedCountsTest() {
		// Given: the delivery table holds two historical rows for the same resolved key (append-only), the
		// conversions table holds one
		givenScopeAllows("Retargeting");
		givenTables();
		givenDeliveryKeys(List.of(deliveryKeyRow("2026-01-05", "acct-1", "cid-1", "cid2-1", "cid3-1")));
		givenConversionKeys(List.of(
				conversionKeyRow("2026-01-05", "acct-1", "cid-1", "cid2-1", "cid3-1", "Purchase", "Sale")));
		when(syncLockService.tryAcquire(any())).thenReturn(true);
		// argThat's predicate must tolerate a null argument - Mockito calls matches(null) while registering
		// a second matcher-based stub for the same method.
		when(writeGateway.delete(argThat(delete -> delete != null && delete.sql().contains(DELIVERY_TABLE))))
				.thenReturn(2L);
		when(writeGateway.delete(argThat(delete -> delete != null && delete.sql().contains(CONVERSIONS_TABLE))))
				.thenReturn(1L);

		// When:
		AdjustmentRollbackResultModel result =
				writer.rollback(scope(), List.of("Retargeting"), "2026-01-01", "2026-01-31");

		// Then: the counts are the sums BigQueryWriteGateway reported, not the number of distinct keys
		assertThat(result).isEqualTo(new AdjustmentRollbackResultModel(2, 1));
		verify(writeGateway, times(2)).delete(any(BqDelete.class));
	}

	@Test
	void shouldEvictTheSearchCacheAfterASuccessfulRollbackTest() {
		// Given:
		givenScopeAllows("Retargeting");
		givenTables();
		givenDeliveryKeys(List.of());
		givenConversionKeys(List.of());
		when(syncLockService.tryAcquire(any())).thenReturn(true);

		// When:
		writer.rollback(scope(), List.of("Retargeting"), "2026-01-01", "2026-01-31");

		// Then:
		verify(gateway).evictSearchCache();
	}

	/**
	 * Builds the exact {@code DELETE} statements the writer produces for one example scope - printed so a
	 * human can run the dev check manually, per the task's "no live BigQuery" constraint.
	 */
	@Test
	void shouldBuildTheExpectedDeleteStatementsForOneExampleScopeTest() {
		// Given: one delivery key (a null level-3 id, rendered as IS NULL) and one conversions key
		givenScopeAllows("Retargeting");
		givenTables();
		givenDeliveryKeys(List.of(deliveryKeyRow("2026-01-05", "acct-1", "cid-1", "cid2-1", null)));
		givenConversionKeys(List.of(
				conversionKeyRow("2026-01-05", "acct-1", "cid-1", "cid2-1", "cid3-1", "Purchase", "Sale")));
		when(syncLockService.tryAcquire(any())).thenReturn(true);
		when(writeGateway.delete(any(BqDelete.class))).thenReturn(1L);
		ArgumentCaptor<BqDelete> captor = ArgumentCaptor.forClass(BqDelete.class);

		// When:
		writer.rollback(scope(), List.of("Retargeting"), "2026-01-01", "2026-01-31");

		// Then:
		verify(writeGateway, times(2)).delete(captor.capture());
		List<BqDelete> deletes = captor.getAllValues();
		String deliveryDelete = deletes.stream().map(BqDelete::sql).filter(sql -> sql.contains(DELIVERY_TABLE))
				.findFirst().orElseThrow();
		String conversionsDelete = deletes.stream().map(BqDelete::sql).filter(sql -> sql.contains(CONVERSIONS_TABLE))
				.findFirst().orElseThrow();
		assertThat(deliveryDelete).isEqualTo(
				"DELETE FROM `" + DELIVERY_TABLE + "` WHERE (`date` = '2026-01-05' AND `account_id` = 'acct-1' "
						+ "AND `constructed_id` = 'cid-1' AND `constructed_id_lvl2` = 'cid2-1' "
						+ "AND `constructed_id_lvl3` IS NULL)");
		assertThat(conversionsDelete).isEqualTo(
				"DELETE FROM `" + CONVERSIONS_TABLE + "` WHERE (`date` = '2026-01-05' AND `account_id` = 'acct-1' "
						+ "AND `constructed_id` = 'cid-1' AND `constructed_id_lvl2` = 'cid2-1' "
						+ "AND `constructed_id_lvl3` = 'cid3-1' AND `conversion_action` = 'Purchase' "
						+ "AND `conversion_category` = 'Sale')");
		System.out.println("[PDI_124] example delivery DELETE: " + deliveryDelete);
		System.out.println("[PDI_124] example conversions DELETE: " + conversionsDelete);
	}

	@Test
	void shouldSplitIntoBatchesWhenTheKeySetExceedsTheStatementLimitTest() {
		// Given: enough distinct delivery keys that the rendered DELETE exceeds BqInsert.MAX_STATEMENT_BYTES
		// (900,000 UTF-16 units) at roughly 150 chars/key, well past 1 batch
		givenScopeAllows("Retargeting");
		givenTables();
		List<Map<String, Object>> manyKeys = new ArrayList<>();
		for (int i = 0; i < 8000; i++) {
			manyKeys.add(deliveryKeyRow("2026-01-01", "acct-" + i, "cid-" + i, "cid2-" + i, "cid3-" + i));
		}
		givenDeliveryKeys(manyKeys);
		givenConversionKeys(List.of());
		when(syncLockService.tryAcquire(any())).thenReturn(true);
		when(writeGateway.delete(any(BqDelete.class))).thenReturn(1L);

		// When:
		writer.rollback(scope(), List.of("Retargeting"), "2026-01-01", "2026-01-31");

		// Then: split across more than one DELETE batch for the delivery table
		ArgumentCaptor<BqDelete> captor = ArgumentCaptor.forClass(BqDelete.class);
		verify(writeGateway, atLeast(2)).delete(captor.capture());
		long deliveryBatches = captor.getAllValues().stream().filter(d -> d.sql().contains(DELIVERY_TABLE)).count();
		assertThat(deliveryBatches).isGreaterThan(1);
	}
}
