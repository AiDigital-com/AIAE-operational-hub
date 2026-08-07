package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.service.agency.CampaignService;
import com.aidigital.operationalhub.service.agency.InsertionOrderService;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRequest;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRow;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqSql;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQuerySearchGateway;
import com.aidigital.operationalhub.service.agency.model.InsertionOrderModel;
import com.aidigital.operationalhub.service.agency.model.LineItemModel;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryIoLinesColumns.CAMPAIGN_ID;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryIoLinesColumns.DESCRIPTION;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryIoLinesColumns.END_DATE;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryIoLinesColumns.LINE_ITEM_ID;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryIoLinesColumns.MEDIA_TACTIC;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryIoLinesColumns.ORDER_BUDGET;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryIoLinesColumns.ORDER_END_DATE;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryIoLinesColumns.ORDER_ID;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryIoLinesColumns.ORDER_NUMBER;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryIoLinesColumns.ORDER_START_DATE;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryIoLinesColumns.ORDER_STATUS;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryIoLinesColumns.RATE_TYPE;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryIoLinesColumns.START_DATE;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryIoLinesColumns.TACTIC_BUDGET;

/**
 * BigQuery-backed implementation of {@link InsertionOrderService}.
 *
 * <p>Reads one flat, line-item-grained {@code SELECT} over the IO Lines table (ordered by
 * {@code order_id} then {@code line_item_id}) and groups the rows into insertion orders in Java - the
 * builder has no multi-column {@code GROUP BY}, and a single campaign's line-item count is small
 * enough (tens, worst case low hundreds) that grouping client-side is the simpler correct choice.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class BigQueryInsertionOrderService implements InsertionOrderService {

	/**
	 * Guards a pathological campaign from an unbounded in-memory row list; rows past this cap are
	 * dropped with a warning, never silently truncated without a trace.
	 */
	private static final int LINE_ITEM_CAP = 5_000;

	private final BigQuerySearchGateway gateway;
	private final CampaignService campaignService;

	@Override
	public List<InsertionOrderModel> findCampaignInsertionOrders(CurrentUserModel user, long campaignId) {
		campaignService.getVisibleCampaign(user, campaignId);
		List<BqRow> rows = gateway.fetchCached(lineItemQuery(campaignId).build(), row -> row);
		if (rows.size() > LINE_ITEM_CAP) {
			log.warn("Campaign {} has more than {} IO Lines rows; dropping the remainder", campaignId, LINE_ITEM_CAP);
			rows = rows.subList(0, LINE_ITEM_CAP);
		}
		return groupIntoInsertionOrders(rows);
	}

	/**
	 * Builds the flat, line-item-grained query for one campaign's IO Lines rows.
	 *
	 * @param campaignId the campaign id
	 * @return the query builder
	 */
	BqRequest.Builder lineItemQuery(long campaignId) {
		return new BqRequest.Builder()
				.from(gateway.table())
				.select(ORDER_ID)
				.select(ORDER_NUMBER)
				.select(ORDER_STATUS)
				.select(ORDER_START_DATE)
				.select(ORDER_END_DATE)
				.select(ORDER_BUDGET)
				.select(LINE_ITEM_ID)
				.select(DESCRIPTION)
				.select(MEDIA_TACTIC)
				.select(RATE_TYPE)
				.select(TACTIC_BUDGET)
				.select(START_DATE)
				.select(END_DATE)
				.whereIn(CAMPAIGN_ID, List.of(campaignId))
				.whereNotNull(ORDER_ID)
				.orderBy(BqSql.col(ORDER_ID))
				.tiebreaker(LINE_ITEM_ID)
				.limitOffset(LINE_ITEM_CAP + 1, 0);
	}

	/**
	 * Groups flat IO Lines rows into insertion orders, keyed by {@code order_id}, preserving the SQL's
	 * own row order (first-seen order).
	 *
	 * @param rows the flat query result rows
	 * @return the grouped insertion orders
	 */
	List<InsertionOrderModel> groupIntoInsertionOrders(List<BqRow> rows) {
		Map<Long, List<BqRow>> byOrderId = new LinkedHashMap<>();
		for (BqRow row : rows) {
			byOrderId.computeIfAbsent(row.getLong(ORDER_ID), key -> new ArrayList<>()).add(row);
		}
		return byOrderId.entrySet().stream()
				.map(entry -> toInsertionOrder(entry.getKey(), entry.getValue()))
				.toList();
	}

	/**
	 * Maps one order's rows into an {@link InsertionOrderModel}: order-level fields read once from the
	 * first row, line items mapped one per row.
	 *
	 * @param orderId   the order id
	 * @param orderRows the order's rows, in {@code line_item_id} order
	 * @return the insertion order model
	 */
	InsertionOrderModel toInsertionOrder(Long orderId, List<BqRow> orderRows) {
		BqRow first = orderRows.get(0);
		Set<String> mediaTactics = new LinkedHashSet<>();
		for (BqRow row : orderRows) {
			String tactic = row.getTrimmedString(MEDIA_TACTIC);
			if (tactic != null) {
				mediaTactics.add(tactic);
			}
		}
		return new InsertionOrderModel(
				orderId,
				first.getTrimmedString(ORDER_NUMBER),
				first.getTrimmedString(ORDER_STATUS),
				first.getString(ORDER_START_DATE),
				first.getString(ORDER_END_DATE),
				first.getDouble(ORDER_BUDGET),
				List.copyOf(mediaTactics),
				orderRows.stream().map(this::toLineItem).toList());
	}

	/**
	 * Maps one row into a {@link LineItemModel}.
	 *
	 * @param row the source row
	 * @return the line item model
	 */
	LineItemModel toLineItem(BqRow row) {
		return new LineItemModel(
				row.getLong(LINE_ITEM_ID),
				row.getTrimmedString(DESCRIPTION),
				row.getTrimmedString(MEDIA_TACTIC),
				row.getTrimmedString(RATE_TYPE),
				row.getDouble(TACTIC_BUDGET),
				row.getString(START_DATE),
				row.getString(END_DATE));
	}
}
