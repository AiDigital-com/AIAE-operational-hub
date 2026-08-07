package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.service.agency.model.ReportRowModel;
import com.aidigital.operationalhub.service.agency.model.WorkbookAdjustmentRow;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.streaming.SXSSFWorkbook;
import org.springframework.stereotype.Component;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Renders and reads the "Bulk manual adjustment" round-trip spreadsheet: a curated, editable subset of a
 * campaign's report rows the user downloads, edits offline in Excel, and re-uploads. Excludes the derived
 * cpm/ctr/avcr ratios (never stored, never writable) and the server-owned audit stamps/campaign identity -
 * mirrors {@link com.aidigital.operationalhub.service.agency.model.AdjustmentRowModel}'s non-derived,
 * non-stamped field set.
 */
@Component
public class ReportRowXlsxAssembler {

	private final WorkbookRowParser workbookRowParser;
	private final ReportRowXlsxExportAssembler labelResolver;

	/**
	 * Creates the assembler.
	 *
	 * @param workbookRowParser the shared uploaded-workbook reader
	 * @param labelResolver     the report-column label resolver shared with read-only exports
	 */
	public ReportRowXlsxAssembler(WorkbookRowParser workbookRowParser, ReportRowXlsxExportAssembler labelResolver) {
		this.workbookRowParser = workbookRowParser;
		this.labelResolver = labelResolver;
	}

	// SXSSF keeps only this many rows in memory per sheet, flushing older rows to a temp file as new
	// ones are created - the fix for the whole-workbook-DOM memory cost of the plain XSSF writer.
	private static final int ROW_ACCESS_WINDOW_SIZE = 100;

	// rate_type, dynamic_rate, avg_dynamic_rate_by_date_tactic and line_item_description are
	// deliberately excluded: they exist only on the read view, not on the write table, so a round-trip
	// edit could never actually be saved for them - see AdjustmentRowModel.
	private static final String[] TEMPLATE_COLUMNS = {
			"date", "platform", "account", "account_id", "line_item_name", "line_item_id",
			"insertion_order_name", "insertion_order_id", "campaign_constructed_name",
			"campaign_constructed_id", "agency_id", "industry_code", "channel", "tactic",
			"buying_model", "audience", "unique_line_item_id", "other", "geo", "creative_tag",
			"message", "keyword_group", "flight_identifier", "language",
			"impressions", "clicks", "spend", "starts", "first_quartiles", "midpoints",
			// The three conversion columns are absent: a report's conversions come from the conversions
			// mart, not this one, so a value written here would never be shown - see
			// BigQueryReportRowService.joinedRows. They are edited through the conversions pair instead.
			"third_quartiles", "completes", "dynamic_cost", "link_clicks",
	};

	private static final Set<String> NUMERIC_COLUMNS = Set.of(
			"impressions", "clicks", "spend", "starts", "first_quartiles", "midpoints", "third_quartiles",
			"completes", "dynamic_cost", "link_clicks");

	/**
	 * Renders the rows as an .xlsx workbook: a header row of {@link #TEMPLATE_COLUMNS} followed by one
	 * data row per {@link ReportRowModel}, identity columns as text and editable metric columns as
	 * numbers (blank when the metric is {@code null}).
	 *
	 * @param rows the rows to render, in the order given
	 * @return the workbook's bytes
	 */
	public byte[] toWorkbook(List<ReportRowModel> rows) {
		ByteArrayOutputStream out = new ByteArrayOutputStream();
		writeWorkbook(out, rows);
		return out.toByteArray();
	}

	/**
	 * Streams the rows as an .xlsx workbook directly into {@code out}. Uses a windowed
	 * {@link SXSSFWorkbook} so memory use stays bounded by {@link #ROW_ACCESS_WINDOW_SIZE} rows
	 * regardless of how many rows are rendered, rather than holding the whole workbook's cell graph in
	 * memory at once.
	 *
	 * @param out  the stream to write the workbook into; not closed by this method
	 * @param rows the rows to render, in the order given
	 */
	public void writeWorkbook(OutputStream out, List<ReportRowModel> rows) {
		try (SXSSFWorkbook workbook = new SXSSFWorkbook(ROW_ACCESS_WINDOW_SIZE)) {
			Sheet sheet = workbook.createSheet("Bulk adjustment");
			writeHeader(sheet, labelResolver.resolveLevelTerms(rows));
			int rowNum = 1;
			for (ReportRowModel row : rows) {
				writeRow(sheet, rowNum++, row);
			}
			workbook.write(out);
		} catch (IOException e) {
			throw new UncheckedIOException("Failed to render the bulk adjustment workbook", e);
		}
	}

	/**
	 * Writes the bold-ish header row of {@link #TEMPLATE_COLUMNS} column names.
	 *
	 * @param sheet the sheet to write into
	 */
	void writeHeader(Sheet sheet) {
		writeHeader(sheet, null);
	}

	/**
	 * Writes the bold-ish header row of display labels matching the Reporting table.
	 *
	 * @param sheet      the sheet to write into
	 * @param levelTerms resolved constructed-level terms, or {@code null} when ambiguous
	 */
	void writeHeader(Sheet sheet, List<String> levelTerms) {
		Row header = sheet.createRow(0);
		for (int i = 0; i < TEMPLATE_COLUMNS.length; i++) {
			header.createCell(i).setCellValue(labelResolver.displayHeader(TEMPLATE_COLUMNS[i], levelTerms));
		}
	}

	/**
	 * Writes one data row: each {@link #TEMPLATE_COLUMNS} cell resolved from the given report row, text
	 * for identity columns, numeric (or blank) for metric columns.
	 *
	 * @param sheet  the sheet to write into
	 * @param rowNum the 0-based row index to create
	 * @param row    the report row to render
	 */
	void writeRow(Sheet sheet, int rowNum, ReportRowModel row) {
		Row sheetRow = sheet.createRow(rowNum);
		for (int i = 0; i < TEMPLATE_COLUMNS.length; i++) {
			String column = TEMPLATE_COLUMNS[i];
			Object value = valueFor(column, row);
			if (value == null) {
				continue;
			}
			Cell cell = sheetRow.createCell(i);
			if (NUMERIC_COLUMNS.contains(column)) {
				cell.setCellValue(((Number) value).doubleValue());
			} else {
				cell.setCellValue(String.valueOf(value));
			}
		}
	}

	/**
	 * Resolves one template column's value from a report row.
	 *
	 * @param column the template column id
	 * @param row    the report row
	 * @return the raw value, or {@code null} when absent
	 */
	Object valueFor(String column, ReportRowModel row) {
		return switch (column) {
			case "date" -> row.date();
			case "platform" -> row.platform();
			case "account" -> row.account();
			case "account_id" -> row.accountId();
			case "line_item_name" -> row.lineItemName();
			case "line_item_id" -> row.lineItemId();
			case "insertion_order_name" -> row.insertionOrderName();
			case "insertion_order_id" -> row.insertionOrderId();
			case "campaign_constructed_name" -> row.campaignConstructedName();
			case "campaign_constructed_id" -> row.campaignConstructedId();
			case "agency_id" -> row.agencyId();
			case "industry_code" -> row.industryCode();
			case "channel" -> row.channel();
			case "tactic" -> row.tactic();
			case "buying_model" -> row.buyingModel();
			case "audience" -> row.audience();
			case "unique_line_item_id" -> row.uniqueLineItemId();
			case "other" -> row.other();
			case "geo" -> row.geo();
			case "creative_tag" -> row.creativeTag();
			case "message" -> row.message();
			case "keyword_group" -> row.keywordGroup();
			case "flight_identifier" -> row.flightIdentifier();
			case "language" -> row.language();
			case "impressions" -> row.impressions();
			case "clicks" -> row.clicks();
			case "spend" -> row.spend();
			case "starts" -> row.starts();
			case "first_quartiles" -> row.firstQuartiles();
			case "midpoints" -> row.midpoints();
			case "third_quartiles" -> row.thirdQuartiles();
			case "completes" -> row.completes();
			case "dynamic_cost" -> row.dynamicCost();
			case "link_clicks" -> row.linkClicks();
			default -> null;
		};
	}

	/**
	 * Reads an uploaded bulk-adjustment workbook through the shared {@link WorkbookRowParser}. Kept as a
	 * method of this class so callers still reach the template and its reader through one collaborator, and
	 * so the row cap the parser enforces stays the same number this template is written to.
	 *
	 * @param bytes the uploaded file's bytes
	 * @return the parsed data rows, in sheet order
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException OPH_027 when the bytes are
	 *                           not a readable .xlsx workbook, or the sheet has more than
	 *                           {@link WorkbookRowParser#MAX_UPLOAD_ROWS} rows
	 */
	public List<WorkbookAdjustmentRow> parse(byte[] bytes) {
		return workbookRowParser.parse(bytes, headerAliases());
	}

	/**
	 * Builds accepted header aliases for uploads. New templates use UI labels; older downloaded templates
	 * and hand-built files may still use the raw snake_case ids, which continue to pass through unchanged.
	 *
	 * @return lower-case upload header aliases to canonical column ids
	 */
	Map<String, String> headerAliases() {
		Map<String, String> aliases = new LinkedHashMap<>();
		for (String column : TEMPLATE_COLUMNS) {
			aliases.put(column, column);
			aliases.put(normalizeHeader(labelResolver.displayHeader(column, null)), column);
		}
		for (List<String> terms : ReportRowXlsxExportAssembler.PLATFORM_LEVEL_TERMS.values()) {
			for (String column : TEMPLATE_COLUMNS) {
				aliases.put(normalizeHeader(labelResolver.displayHeader(column, terms)), column);
			}
		}
		return Map.copyOf(aliases);
	}

	/**
	 * Normalizes one workbook header to the parser's alias-key format.
	 *
	 * @param header the workbook header label
	 * @return a lower-case alias key
	 */
	String normalizeHeader(String header) {
		return header.trim().toLowerCase(Locale.ROOT);
	}
}
