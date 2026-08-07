package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.service.agency.model.ConversionRowModel;
import com.aidigital.operationalhub.service.agency.model.ConversionTemplateColumn;
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

/**
 * Renders and reads the conversions round-trip spreadsheet: the campaign's conversions at the conversions
 * mart's own grain, one row per day, line item and conversion action.
 *
 * <p>A file of its own rather than more columns on the delivery template, and the grain is the whole
 * reason. A delivery row is one line item on one day; a conversions row is that plus an action. Put a
 * conversions cell on a delivery row and an edited figure has no action to belong to - which is exactly
 * why the reporting tool keeps its conversions in a sheet of their own too.
 *
 * <p>Every column but {@code conversions} is identity. They are written so the user can see which row is
 * which, and read back only to find that row again; the values actually stored come from the matched
 * conversions row, never from the file. What those columns are, and in what order, is
 * {@link ConversionTemplateColumn}'s to say - this class only puts them on a sheet.
 */
@Component
public class ConversionAdjustmentXlsxAssembler {

	// SXSSF keeps only this many rows in memory per sheet, flushing older rows to a temp file as new ones
	// are created - the same windowed writer the delivery template uses.
	private static final int ROW_ACCESS_WINDOW_SIZE = 100;
	private static final List<String> DEFAULT_LEVEL_TERMS = List.of("Line item", "Insertion order", "Creative");

	private final WorkbookRowParser workbookRowParser;
	private final ReportRowXlsxExportAssembler labelResolver;

	/**
	 * Creates the assembler.
	 *
	 * @param workbookRowParser the shared uploaded-workbook reader
	 * @param labelResolver     the report-column label resolver shared with read-only exports
	 */
	public ConversionAdjustmentXlsxAssembler(
			WorkbookRowParser workbookRowParser, ReportRowXlsxExportAssembler labelResolver) {
		this.workbookRowParser = workbookRowParser;
		this.labelResolver = labelResolver;
	}

	/**
	 * Renders the rows as an .xlsx workbook.
	 *
	 * @param rows the conversions rows to render, in the order given
	 * @return the workbook's bytes
	 */
	public byte[] toWorkbook(List<ConversionRowModel> rows) {
		ByteArrayOutputStream out = new ByteArrayOutputStream();
		writeWorkbook(out, rows);
		return out.toByteArray();
	}

	/**
	 * Streams the rows as an .xlsx workbook directly into {@code out}, holding at most
	 * {@link #ROW_ACCESS_WINDOW_SIZE} rows in memory however many are rendered.
	 *
	 * @param out  the stream to write the workbook into; not closed by this method
	 * @param rows the conversions rows to render, in the order given
	 */
	public void writeWorkbook(OutputStream out, List<ConversionRowModel> rows) {
		try (SXSSFWorkbook workbook = new SXSSFWorkbook(ROW_ACCESS_WINDOW_SIZE)) {
			Sheet sheet = workbook.createSheet("Conversions adjustment");
			writeHeader(sheet, resolveLevelTerms(rows));
			int rowNum = 1;
			for (ConversionRowModel row : rows) {
				writeRow(sheet, rowNum++, row);
			}
			workbook.write(out);
		} catch (IOException e) {
			throw new UncheckedIOException("Failed to render the conversions adjustment workbook", e);
		}
	}

	/**
	 * Writes the header row, taking both the names and their order from
	 * {@link ConversionTemplateColumn#header()}.
	 *
	 * @param sheet the sheet to write into
	 */
	void writeHeader(Sheet sheet) {
		writeHeader(sheet, null);
	}

	/**
	 * Writes the header row, taking both the names and their order from
	 * {@link ConversionTemplateColumn#header()}.
	 *
	 * @param sheet      the sheet to write into
	 * @param levelTerms resolved constructed-level terms, or {@code null} when ambiguous
	 */
	void writeHeader(Sheet sheet, List<String> levelTerms) {
		Row header = sheet.createRow(0);
		List<String> columns = ConversionTemplateColumn.header();
		for (int i = 0; i < columns.size(); i++) {
			header.createCell(i).setCellValue(displayHeader(columns.get(i), levelTerms));
		}
	}

	/**
	 * Writes one data row: identity columns as text, {@code conversions} as a number.
	 *
	 * <p>A null conversions figure is written as {@code 0} rather than left blank, because the view has no
	 * null to report - every metric in it is coalesced to zero. A blank cell would read as "not edited" on
	 * the way back, so writing one here would make a row impossible to set to zero deliberately.
	 *
	 * @param sheet  the sheet to write into
	 * @param rowNum the 0-based row index to create
	 * @param row    the conversions row to render
	 */
	void writeRow(Sheet sheet, int rowNum, ConversionRowModel row) {
		Row sheetRow = sheet.createRow(rowNum);
		ConversionTemplateColumn[] identityColumns = ConversionTemplateColumn.values();
		for (int i = 0; i < identityColumns.length; i++) {
			String value = identityColumns[i].getValue().apply(row);
			if (value != null) {
				Cell cell = sheetRow.createCell(i);
				cell.setCellValue(value);
			}
		}
		// Last, and numeric: the editable column is the one the upload reads back.
		sheetRow.createCell(identityColumns.length)
				.setCellValue(row.conversions() == null ? 0d : row.conversions());
	}

	/**
	 * Reads an uploaded conversions workbook through the shared {@link WorkbookRowParser}.
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
	 * Resolves one conversions-template column id to its display label.
	 *
	 * @param column the canonical column id
	 * @return the workbook header label
	 */
	String displayHeader(String column) {
		return displayHeader(column, null);
	}

	/**
	 * Resolves one conversions-template column id to its display label.
	 *
	 * @param column     the canonical column id
	 * @param levelTerms resolved constructed-level terms, or {@code null} when ambiguous
	 * @return the workbook header label
	 */
	String displayHeader(String column, List<String> levelTerms) {
		return switch (column) {
			case "date" -> "Date";
			case "line_item_id" -> labelResolver.levelLabel(resolvedOrDefault(levelTerms), 0, true, "Line item id");
			case "insertion_order_id" ->
					labelResolver.levelLabel(resolvedOrDefault(levelTerms), 1, true, "Insertion order id");
			case "creative_id" -> labelResolver.levelLabel(resolvedOrDefault(levelTerms), 2, true, "Creative id");
			case "conversion_action" -> "Conversion action";
			case "conversion_category" -> "Conversion category";
			case "platform" -> "Platform";
			case "account" -> "Account";
			case "account_id" -> "Account id";
			case "line_item_name" ->
					labelResolver.levelLabel(resolvedOrDefault(levelTerms), 0, false, "Line item name");
			case "insertion_order_name" ->
					labelResolver.levelLabel(resolvedOrDefault(levelTerms), 1, false, "Insertion order name");
			case "creative_name" -> labelResolver.levelLabel(resolvedOrDefault(levelTerms), 2, false, "Creative name");
			case "conversions" -> "Conversions";
			default -> column;
		};
	}

	/**
	 * Chooses platform-specific constructed-level labels when known, or the conversions template's readable
	 * default labels when the exported rows are empty or ambiguous.
	 *
	 * @param levelTerms resolved constructed-level terms, or {@code null}
	 * @return the terms to use for the conversion identity columns
	 */
	List<String> resolvedOrDefault(List<String> levelTerms) {
		return levelTerms == null ? DEFAULT_LEVEL_TERMS : levelTerms;
	}

	/**
	 * Resolves constructed-level terms from the platforms present in the exported conversion rows. If the
	 * rows span platforms that disagree, labels stay neutral, exactly as the Reporting table does.
	 *
	 * @param rows exported rows
	 * @return resolved level terms, or {@code null}
	 */
	List<String> resolveLevelTerms(List<ConversionRowModel> rows) {
		List<String> resolved = null;
		for (ConversionRowModel row : rows) {
			if (row.platform() == null) {
				return null;
			}
			List<String> terms = ReportRowXlsxExportAssembler.PLATFORM_LEVEL_TERMS.get(row.platform());
			if (terms == null) {
				return null;
			}
			if (resolved != null && !resolved.equals(terms)) {
				return null;
			}
			resolved = terms;
		}
		return resolved;
	}

	/**
	 * Builds accepted header aliases for uploads, preserving compatibility with older snake_case templates.
	 *
	 * @return lower-case upload header aliases to canonical column ids
	 */
	Map<String, String> headerAliases() {
		Map<String, String> aliases = new LinkedHashMap<>();
		for (String column : ConversionTemplateColumn.header()) {
			aliases.put(column, column);
			aliases.put(displayHeader(column).trim().toLowerCase(Locale.ROOT), column);
		}
		for (List<String> terms : ReportRowXlsxExportAssembler.PLATFORM_LEVEL_TERMS.values()) {
			for (String column : ConversionTemplateColumn.header()) {
				aliases.put(displayHeader(column, terms).trim().toLowerCase(Locale.ROOT), column);
			}
		}
		return Map.copyOf(aliases);
	}

}
