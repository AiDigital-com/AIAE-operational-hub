package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import com.aidigital.operationalhub.service.agency.AdjustmentRoundTripLimits;
import com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryConversionsViewColumns;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRequest;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRow;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqSql;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQuerySearchGateway;
import com.aidigital.operationalhub.service.agency.model.CampaignModel;
import com.aidigital.operationalhub.service.agency.model.ConversionKey;
import com.aidigital.operationalhub.service.agency.model.ConversionRowExportModel;
import com.aidigital.operationalhub.service.agency.model.ConversionRowModel;
import com.aidigital.operationalhub.service.agency.model.ConversionTemplateColumn;
import com.aidigital.operationalhub.service.agency.model.ReportRowDateRangeModel;
import com.aidigital.operationalhub.service.agency.model.WorkbookAdjustmentRow;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryConversionsViewColumns.CONVERSIONS;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryConversionsViewColumns.CONVERSION_ACTION;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryConversionsViewColumns.DATE;

/**
 * Reads a campaign's conversions at the conversions mart's own grain - one row per day, line item and
 * conversion action.
 *
 * <p>Two reads, one shape. The template download wants the campaign's rows within a date window; an upload
 * wants only the rows its own file could refer to, indexed by key. Both come from the same scoped query, so
 * a file cannot be generated from one set of rows and matched against another.
 */
@Component
@RequiredArgsConstructor
public class ConversionRowReader {

	// The shared round-trip ceiling: a file the user can download has to be a file the user can upload back.
	private static final int ROW_CAP = AdjustmentRoundTripLimits.MAX_ROWS;

	private final BigQuerySearchGateway gateway;
	private final BigQueryProperties bigQueryProperties;

	/**
	 * The campaign's conversions rows for a template download, capped, with whether the cap was hit.
	 *
	 * @param campaign  the resolved campaign
	 * @param dateRange the inclusive conversion-date window; never {@code null}, may be empty
	 * @return the rows and the truncation flag
	 */
	ConversionRowExportModel findRows(CampaignModel campaign, ReportRowDateRangeModel dateRange) {
		BqRequest.Builder query = conversionRowsQuery(campaign);
		if (dateRange.isPresent()) {
			query.whereDateBetween(DATE, dateRange.from(), dateRange.to());
		}
		// One row past the cap, so hitting it can be reported rather than inferred from a suspiciously
		// round row count - the same trick the delivery export uses.
		BqRequest request = query
				.orderBy(BqSql.col(DATE))
				.tiebreaker(CONVERSION_ACTION)
				.limitOffset(ROW_CAP + 1, 0)
				.build();
		List<ConversionRowModel> fetched = gateway.fetch(request, this::toConversionRow);
		boolean truncated = fetched.size() > ROW_CAP;
		return new ConversionRowExportModel(
				truncated ? fetched.subList(0, ROW_CAP) : fetched, truncated, campaign.name());
	}

	/**
	 * The conversions rows that add up to one report row's Conversions cell - its per-action breakdown.
	 *
	 * <p>Selected by the report's own join condition, not by something merely similar to it: the same
	 * normalized name comparison ({@link BqRequest.Builder#whereNameEquals}), the same treatment of an
	 * absent level 3, and the same rule that campaign-level channels ignore level 3 altogether. A
	 * breakdown that did not sum to the cell above it would be worse than no breakdown, because the user
	 * would trust it.
	 *
	 * <p>Uncapped by design, unlike the template read: one delivery row on one day has as many conversions
	 * rows as it has conversion actions - a handful, not thousands.
	 *
	 * @param campaign        the resolved campaign
	 * @param date            the report row's date
	 * @param levelOneName    the report row's level-1 constructed name
	 * @param levelThreeName  the report row's level-3 constructed name, may be {@code null}
	 * @param campaignLevel   whether the row's channel reports conversions against the campaign rather
	 *                        than the creative, in which case level 3 does not narrow the breakdown
	 * @return the rows behind that cell, ordered by conversion action
	 */
	List<ConversionRowModel> findRowsBehind(
			CampaignModel campaign,
			String date,
			String levelOneName,
			String levelThreeName,
			boolean campaignLevel) {
		BqRequest.Builder query = conversionRowsQuery(campaign)
				.whereEquals(DATE, date)
				.whereNameEquals(BigQueryConversionsViewColumns.CONSTRUCTED_NAME, levelOneName, null);
		if (!campaignLevel) {
			query.whereNameEquals(
					BigQueryConversionsViewColumns.CONSTRUCTED_NAME_LVL3,
					levelThreeName,
					ReportRowConversionsSql.MISSING_LEVEL_3);
		}
		BqRequest request = query.orderBy(BqSql.col(CONVERSION_ACTION)).build();
		return gateway.fetch(request, this::toConversionRow);
	}

	/**
	 * Reads the campaign's conversions rows covering the uploaded sheet's own dates and line items - not the
	 * whole campaign - and indexes them by {@link ConversionKey}.
	 *
	 * <p>Narrowed by dates <em>and</em> line item ids together, which is a superset of the exact pairs the
	 * upload needs rather than a subset: a row can share a date with one uploaded line and a line item with
	 * another without matching either, and dropping it would be worse than reading it.
	 *
	 * @param campaign     the resolved campaign
	 * @param uploadedRows the uploaded sheet's rows
	 * @return the matching conversions rows, keyed by template key
	 */
	Map<ConversionKey, List<ConversionRowModel>> baselineByKey(
			CampaignModel campaign, List<WorkbookAdjustmentRow> uploadedRows) {
		BqRequest.Builder query = conversionRowsQuery(campaign);
		List<String> dates =
				distinctCellValues(uploadedRows, ConversionTemplateColumn.DATE.getColumnName());
		List<String> lineItemIds =
				distinctCellValues(uploadedRows, ConversionTemplateColumn.LINE_ITEM_ID.getColumnName());
		if (!dates.isEmpty()) {
			query.whereInStrings(DATE, dates);
		}
		if (!lineItemIds.isEmpty()) {
			query.whereInStrings(BigQueryConversionsViewColumns.CONSTRUCTED_ID, lineItemIds);
		}
		BqRequest request = query.limitOffset(ROW_CAP + 1, 0).build();
		List<ConversionRowModel> fetched = gateway.fetch(request, this::toConversionRow);
		if (fetched.size() > ROW_CAP) {
			// Left undetected, the rows past the cap simply are not in the map, and every uploaded row
			// pointing at one reads as "matches no current conversions row" - sending the user to fix a
			// template that is not the problem.
			throw new BusinessException(
					OperationalHubErrorReason.OPH_027,
					"this upload covers more than " + ROW_CAP + " conversions rows, which is more than can be "
							+ "matched at once - split it by date and apply the parts separately");
		}
		Map<ConversionKey, List<ConversionRowModel>> byKey = new LinkedHashMap<>();
		for (ConversionRowModel row : fetched) {
			byKey.computeIfAbsent(ConversionKey.of(row), key -> new ArrayList<>()).add(row);
		}
		return byKey;
	}

	/**
	 * The campaign-scoped conversions read every template and baseline lookup starts from: the identity
	 * columns and the conversions figure, at the view's own per-action grain.
	 *
	 * <p>Today's rows are excluded, as everywhere else a report is read - a day still collecting
	 * conversions would be edited against a figure that changes under the user by evening.
	 *
	 * @param campaign the resolved campaign
	 * @return the conversions-rows builder
	 */
	BqRequest.Builder conversionRowsQuery(CampaignModel campaign) {
		return new BqRequest.Builder()
				.from(gateway.qualify(bigQueryProperties.getConversionsView()))
				.whereEquals(BigQueryConversionsViewColumns.CNB_CAMPAIGN_NAME, campaign.name())
				.whereEquals(BigQueryConversionsViewColumns.CNB_CLIENT, campaign.clientName())
				.whereBeforeCurrentDate(DATE)
				.select(DATE)
				.select(BigQueryConversionsViewColumns.PLATFORM)
				.select(BigQueryConversionsViewColumns.ACCOUNT)
				.select(BigQueryConversionsViewColumns.ACCOUNT_ID)
				.select(CONVERSION_ACTION)
				.select(BigQueryConversionsViewColumns.CONVERSION_CATEGORY)
				.select(BigQueryConversionsViewColumns.CONSTRUCTED_NAME)
				.select(BigQueryConversionsViewColumns.CONSTRUCTED_ID)
				.select(BigQueryConversionsViewColumns.CONSTRUCTED_NAME_LVL2)
				.select(BigQueryConversionsViewColumns.CONSTRUCTED_ID_LVL2)
				.select(BigQueryConversionsViewColumns.CONSTRUCTED_NAME_LVL3)
				.select(BigQueryConversionsViewColumns.CONSTRUCTED_ID_LVL3)
				.select(CONVERSIONS);
	}

	/**
	 * Maps one BigQuery row to a {@link ConversionRowModel}.
	 *
	 * @param row the BigQuery row
	 * @return the mapped model
	 */
	ConversionRowModel toConversionRow(BqRow row) {
		return new ConversionRowModel(
				row.getString(DATE),
				row.getString(BigQueryConversionsViewColumns.PLATFORM),
				row.getString(BigQueryConversionsViewColumns.ACCOUNT),
				row.getString(BigQueryConversionsViewColumns.ACCOUNT_ID),
				row.getString(CONVERSION_ACTION),
				row.getString(BigQueryConversionsViewColumns.CONVERSION_CATEGORY),
				row.getString(BigQueryConversionsViewColumns.CONSTRUCTED_NAME),
				row.getString(BigQueryConversionsViewColumns.CONSTRUCTED_ID),
				row.getString(BigQueryConversionsViewColumns.CONSTRUCTED_NAME_LVL2),
				row.getString(BigQueryConversionsViewColumns.CONSTRUCTED_ID_LVL2),
				row.getString(BigQueryConversionsViewColumns.CONSTRUCTED_NAME_LVL3),
				row.getString(BigQueryConversionsViewColumns.CONSTRUCTED_ID_LVL3),
				row.getDouble(CONVERSIONS));
	}

	/**
	 * Collects one cell column's distinct, non-blank values across every uploaded row.
	 *
	 * @param uploadedRows the uploaded sheet's rows
	 * @param column       the cell column id to collect
	 * @return the distinct non-blank values, in no particular order
	 */
	List<String> distinctCellValues(List<WorkbookAdjustmentRow> uploadedRows, String column) {
		return uploadedRows.stream()
				.map(row -> row.cells().get(column))
				.filter(value -> value != null && !value.isBlank())
				.distinct()
				.toList();
	}
}
