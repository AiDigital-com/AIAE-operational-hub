package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.ConversionAdjustmentRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ConversionAdjustmentRowV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ConversionBreakdownRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ConversionBreakdownRowV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ConversionBreakdownV1;
import com.aidigital.operationalhub.service.agency.model.ConversionBreakdownQuery;
import com.aidigital.operationalhub.service.agency.model.ConversionRowModel;
import com.aidigital.operationalhub.service.agency.model.ConversionTemplateColumn;
import com.aidigital.operationalhub.service.agency.model.WorkbookAdjustmentRow;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.IntStream;

/**
 * Maps between the conversions-breakdown contract and the service's own models.
 *
 * <p>The direction that matters is the write. An edited row arrives as a typed DTO and leaves as the same
 * cell map an uploaded spreadsheet row produces, keyed by {@link ConversionTemplateColumn}'s own column
 * names - so the row goes through the matching, validation and replace-not-append write that the upload
 * already uses, rather than a second implementation of them that would have to be kept in step.
 */
@Component
public class ConversionBreakdownContractMapper {

	/**
	 * Reads the report row's identity out of the request.
	 *
	 * @param request the breakdown request
	 * @return the service query
	 */
	public ConversionBreakdownQuery toQuery(ConversionBreakdownRequestV1 request) {
		return new ConversionBreakdownQuery(
				request.getDate() == null ? null : request.getDate().toString(),
				request.getLevelOneName(),
				request.getLevelThreeName(),
				request.getChannel());
	}

	/**
	 * Renders the rows behind one Conversions cell.
	 *
	 * @param rows the conversions rows, in service order
	 * @return the breakdown response
	 */
	public ConversionBreakdownV1 toBreakdown(List<ConversionRowModel> rows) {
		return new ConversionBreakdownV1().rows(rows.stream().map(this::toBreakdownRow).toList());
	}

	/**
	 * Maps one conversions row into its contract form.
	 *
	 * @param row the conversions row
	 * @return the contract row
	 */
	ConversionBreakdownRowV1 toBreakdownRow(ConversionRowModel row) {
		return new ConversionBreakdownRowV1()
				.date(row.date())
				.lineItemId(row.lineItemId())
				.insertionOrderId(row.insertionOrderId())
				.creativeId(row.creativeId())
				.conversionAction(row.conversionAction())
				.conversionCategory(row.conversionCategory())
				.lineItemName(row.lineItemName())
				.creativeName(row.creativeName())
				.platform(row.platform())
				.conversions(row.conversions());
	}

	/**
	 * Turns the edited rows into the cell maps the shared adjustment path reads.
	 *
	 * @param request the adjustment request, may be {@code null}
	 * @return the submitted rows, numbered from 1 in request order for diagnostics
	 */
	public List<WorkbookAdjustmentRow> toSubmittedRows(ConversionAdjustmentRequestV1 request) {
		List<ConversionAdjustmentRowV1> rows = request == null || request.getRows() == null
				? List.of()
				: request.getRows();
		return IntStream.range(0, rows.size())
				.mapToObj(index -> new WorkbookAdjustmentRow(index + 1, toCells(rows.get(index))))
				.toList();
	}

	/**
	 * Maps one edited row to its cells, keyed exactly as the spreadsheet's headers are.
	 *
	 * <p>Only the key columns and the figure: the names are read-only in the breakdown too, and the values
	 * actually stored come from the matched mart row.
	 *
	 * @param row the edited row
	 * @return the row's cells
	 */
	Map<String, String> toCells(ConversionAdjustmentRowV1 row) {
		Map<String, String> cells = new LinkedHashMap<>();
		cells.put(ConversionTemplateColumn.DATE.getColumnName(), row.getDate());
		cells.put(ConversionTemplateColumn.LINE_ITEM_ID.getColumnName(), row.getLineItemId());
		cells.put(ConversionTemplateColumn.INSERTION_ORDER_ID.getColumnName(), row.getInsertionOrderId());
		cells.put(ConversionTemplateColumn.CREATIVE_ID.getColumnName(), row.getCreativeId());
		cells.put(ConversionTemplateColumn.CONVERSION_ACTION.getColumnName(), row.getConversionAction());
		cells.put(ConversionTemplateColumn.CONVERSION_CATEGORY.getColumnName(), row.getConversionCategory());
		cells.put(
				ConversionTemplateColumn.CONVERSIONS,
				row.getConversions() == null ? null : String.valueOf(row.getConversions()));
		return cells;
	}
}
