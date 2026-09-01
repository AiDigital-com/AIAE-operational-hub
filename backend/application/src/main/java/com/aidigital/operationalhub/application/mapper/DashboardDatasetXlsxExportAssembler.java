package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.service.dashboard.model.DashboardColumnChoice;
import com.aidigital.operationalhub.service.dashboard.model.DashboardDatasetRow;
import lombok.RequiredArgsConstructor;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.streaming.SXSSFWorkbook;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.util.List;

/**
 * Renders a Basic dashboard's dataset as an .xlsx workbook for the dataset preview's "Download" action.
 *
 * <p>Column set, labels and order mirror the preview table on the Dashboards tab, not the raw ~50-column
 * BigQuery output the data source itself writes - a download is a copy of what is on screen, the same way
 * {@link ReportRowXlsxExportAssembler} matches the Reporting table rather than the report-rows read schema.
 * CPA is the one column carried from the screen rather than the row: it has no BigQuery output alias of its
 * own and is derived here exactly as the preview table derives it, from {@code CPA_Cost} and
 * {@code CPA_Conversions}.
 */
@Component
@RequiredArgsConstructor
public class DashboardDatasetXlsxExportAssembler {

	private final ColumnOrderArranger columnOrderArranger;

	// SXSSF keeps only this many rows in memory per sheet, flushing older rows to a temp file as new ones
	// are created - see ReportRowXlsxExportAssembler for the same choice and the memory cost it avoids.
	private static final int ROW_ACCESS_WINDOW_SIZE = 100;

	private static final String DATA_SHEET = "Dataset";

	/** Output alias CPA's cost half is read from; blank on rows the campaign's plan does not price by CPA. */
	private static final String CPA_COST = "CPA_Cost";

	/** Output alias CPA's conversions half is read from. */
	private static final String CPA_CONVERSIONS = "CPA_Conversions";

	/** Id of the one column with no BigQuery output alias of its own - derived, not read, in {@link #valueFor}. */
	static final String CPA_ID = "cpa";

	/**
	 * The Basic dashboard's dimension and metric columns, fixed and ordered exactly as the Dashboards tab's
	 * own {@code BASIC_DIMENSIONS}/{@code BASIC_METRICS} lists. A second declaration rather than a shared
	 * one because one renders a workbook in Java and the other renders a table in TypeScript, and the two
	 * cannot share a source file across that boundary - keep them in step by hand.
	 */
	static final List<DashboardExportColumn> COLUMNS = List.of(
			new DashboardExportColumn("date", "Date", "Date", false),
			new DashboardExportColumn("line_item", "Line item", "Line_Item_Description", false),
			new DashboardExportColumn("week", "Week (Mon start)", "week_start_date_monday", false),
			new DashboardExportColumn("quarter", "Quarter", "Quarter", false),
			new DashboardExportColumn("tactic", "Tactic", "Tactic", false),
			new DashboardExportColumn("channel", "Channel", "Channel", false),
			new DashboardExportColumn("channel_short", "Channel (short)", "Channel_Short_Name", false),
			new DashboardExportColumn("level1", "Level 1 naming", "lvl1", false),
			new DashboardExportColumn("creative", "Creative", "Creative", true),
			new DashboardExportColumn("audience", "Audience", "CNB_audience", false),
			new DashboardExportColumn("geo", "Geo", "CNB_geo", false),
			new DashboardExportColumn("language", "Language", "CNB_language", false),
			new DashboardExportColumn("message", "Message", "CNB_message", false),
			new DashboardExportColumn("creative_tag", "Creative tag", "CNB_creative_tag", false),
			new DashboardExportColumn("keyword_group", "Keyword group", "CNB_keyword_group", false),
			new DashboardExportColumn("flight", "Flight identifier", "CNB_flight_identifier", false),
			new DashboardExportColumn("other", "Other", "CNB_other", false),
			new DashboardExportColumn("impressions", "Impressions", "Impressions", false),
			new DashboardExportColumn("clicks", "Clicks", "Clicks", false),
			new DashboardExportColumn("cost", "Cost", "Cost", false),
			new DashboardExportColumn("completions", "Completions", "Completions", false),
			new DashboardExportColumn("conversions", "Conversions", "Conversions", false),
			new DashboardExportColumn("ivt", "IVT", "IVT", false),
			new DashboardExportColumn("cpc", "CPC", "CPC", false),
			new DashboardExportColumn("cpm", "CPM", "CPM", false),
			new DashboardExportColumn("cpv", "CPV", "CPV", false),
			new DashboardExportColumn("avcr", "AVCR", "AVCR", false),
			new DashboardExportColumn("ctr", "CTR", "CTR", false),
			new DashboardExportColumn(CPA_ID, "CPA", null, true));

	/**
	 * Streams the dashboard's dataset rows as an .xlsx workbook, restricted to the columns the dashboard
	 * currently keeps and arranged by the requested column order when one is given.
	 *
	 * @param out          the stream to write the workbook into; not closed by this method
	 * @param rows         the dataset rows to render, in the order given
	 * @param columnChoice which optional columns (creative, CPA) the dashboard currently keeps
	 * @param columnOrder  the dashboard's saved on-screen column arrangement, or {@code null}/empty for the
	 *                     template's default order
	 */
	public void writeWorkbook(
			OutputStream out, List<DashboardDatasetRow> rows, DashboardColumnChoice columnChoice,
			List<String> columnOrder) {
		List<String> arranged = columnOrderArranger.arrange(keptColumnIds(columnChoice), columnOrder);
		try (SXSSFWorkbook workbook = new SXSSFWorkbook(ROW_ACCESS_WINDOW_SIZE)) {
			Sheet sheet = workbook.createSheet(DATA_SHEET);
			writeHeader(sheet, arranged);
			int rowNum = 1;
			for (DashboardDatasetRow row : rows) {
				writeRow(sheet, rowNum++, row, arranged);
			}
			workbook.write(out);
		} catch (IOException e) {
			throw new UncheckedIOException("Failed to render the dashboard export workbook", e);
		}
	}

	/**
	 * The column ids the dashboard currently keeps, in the template's own fixed order - every mandatory
	 * column plus whichever of creative/CPA the dashboard's own selection has switched on.
	 *
	 * @param columnChoice which optional columns are kept
	 * @return kept column ids, in template order
	 */
	List<String> keptColumnIds(DashboardColumnChoice columnChoice) {
		return COLUMNS.stream()
				.filter(column -> !column.optional() || isKept(column, columnChoice))
				.map(DashboardExportColumn::id)
				.toList();
	}

	/**
	 * Whether one optional column is switched on.
	 *
	 * @param column       the optional column
	 * @param columnChoice which optional columns are kept
	 * @return {@code true} when the dashboard keeps this column
	 */
	boolean isKept(DashboardExportColumn column, DashboardColumnChoice columnChoice) {
		return CPA_ID.equals(column.id()) ? columnChoice.cpa() : columnChoice.creative();
	}

	/**
	 * Writes the header row of the arranged column labels.
	 *
	 * @param sheet     the sheet to write into
	 * @param columnIds the column ids to render, in order
	 */
	void writeHeader(Sheet sheet, List<String> columnIds) {
		Row header = sheet.createRow(0);
		for (int i = 0; i < columnIds.size(); i++) {
			header.createCell(i).setCellValue(labelFor(columnIds.get(i)));
		}
	}

	/**
	 * Writes one dataset row: numeric for a column whose resolved value is a number, text otherwise, blank
	 * when the value is null.
	 *
	 * @param sheet     the sheet to write into
	 * @param rowNum    the 0-based row index to create
	 * @param row       the dataset row to render
	 * @param columnIds the column ids to render, in order
	 */
	void writeRow(Sheet sheet, int rowNum, DashboardDatasetRow row, List<String> columnIds) {
		Row sheetRow = sheet.createRow(rowNum);
		for (int i = 0; i < columnIds.size(); i++) {
			Object value = valueFor(columnIds.get(i), row);
			if (value == null) {
				continue;
			}
			Cell cell = sheetRow.createCell(i);
			if (value instanceof Number number) {
				cell.setCellValue(number.doubleValue());
			} else {
				cell.setCellValue(String.valueOf(value));
			}
		}
	}

	/**
	 * Resolves the Excel label for one column id.
	 *
	 * @param columnId the column id
	 * @return the label, matching the preview table's own header; the id itself for an unknown one
	 */
	String labelFor(String columnId) {
		return COLUMNS.stream()
				.filter(column -> column.id().equals(columnId))
				.map(DashboardExportColumn::label)
				.findFirst()
				.orElse(columnId);
	}

	/**
	 * Resolves one cell's value, computing CPA from its two halves exactly as the preview table does - see
	 * the class Javadoc.
	 *
	 * @param columnId the column id
	 * @param row      the dataset row
	 * @return the value to render, or {@code null} for a blank cell
	 */
	Object valueFor(String columnId, DashboardDatasetRow row) {
		if (CPA_ID.equals(columnId)) {
			return cpa(row);
		}
		String field = fieldFor(columnId);
		return field == null ? null : row.values().get(field);
	}

	/**
	 * The BigQuery output alias behind one column id.
	 *
	 * @param columnId the column id
	 * @return the output alias, or {@code null} for the derived CPA column or an unknown id
	 */
	String fieldFor(String columnId) {
		return COLUMNS.stream()
				.filter(column -> column.id().equals(columnId))
				.map(DashboardExportColumn::field)
				.findFirst()
				.orElse(null);
	}

	/**
	 * CPA, derived from its two halves exactly as the preview table's own value resolution does: cost over
	 * conversions, blank unless both are present and conversions is positive.
	 *
	 * @param row the dataset row
	 * @return the computed CPA, or {@code null}
	 */
	Double cpa(DashboardDatasetRow row) {
		Double cost = numberValue(row.values().get(CPA_COST));
		Double conversions = numberValue(row.values().get(CPA_CONVERSIONS));
		return cost != null && conversions != null && conversions > 0 ? cost / conversions : null;
	}

	/**
	 * Widens a BigQuery cell value to a number, accepting both a numeric type and a numeric string - the
	 * same leniency the preview table's own parsing uses, since either may come back from the driver.
	 *
	 * @param value the raw cell value
	 * @return the numeric value, or {@code null} when it is absent or not numeric
	 */
	Double numberValue(Object value) {
		if (value instanceof Number number) {
			return number.doubleValue();
		}
		if (value instanceof String text && !text.isBlank()) {
			try {
				return Double.parseDouble(text);
			} catch (NumberFormatException e) {
				return null;
			}
		}
		return null;
	}
}
