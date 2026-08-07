package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.service.agency.AdjustmentRoundTripLimits;
import com.aidigital.operationalhub.service.agency.model.WorkbookAdjustmentRow;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import org.apache.poi.ooxml.POIXMLException;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.ss.usermodel.DataFormatter;
import org.apache.poi.ss.usermodel.DateUtil;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.util.RecordFormatException;
import org.apache.poi.xssf.usermodel.XSSFSheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.stereotype.Component;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Reads an uploaded round-trip spreadsheet into header-keyed rows.
 *
 * <p>Shared by every bulk-adjustment template rather than written per template, because nothing about
 * reading one is specific to what it holds: row 1 names the columns, every later row is values under
 * those names. What the columns mean, which are required, and what a value has to parse as are the
 * service's to decide - this only refuses a file it cannot open at all, or one large enough that parsing
 * it would be its own problem.
 */
@Component
public class WorkbookRowParser {

	/**
	 * The most data rows any upload may carry - the shared round-trip ceiling, so this cannot drift from the
	 * exports these templates are generated from. See {@link AdjustmentRoundTripLimits}.
	 */
	public static final int MAX_UPLOAD_ROWS = AdjustmentRoundTripLimits.MAX_ROWS;

	/**
	 * Reads the workbook's first sheet: row 1 is the header (lower-cased column names), every later
	 * non-empty row becomes a {@link WorkbookAdjustmentRow} keyed by header.
	 *
	 * @param bytes the uploaded file's bytes
	 * @return the parsed data rows, in sheet order
	 * @throws BusinessException OPH_027 when the bytes are not a readable .xlsx workbook, or the sheet has
	 *                           more than {@link #MAX_UPLOAD_ROWS} rows
	 */
	public List<WorkbookAdjustmentRow> parse(byte[] bytes) {
		return parse(bytes, Map.of());
	}

	/**
	 * Reads the workbook's first sheet, canonicalising accepted display headers to the service-facing
	 * column ids before data rows are keyed by them.
	 *
	 * @param bytes         the uploaded file's bytes
	 * @param headerAliases lower-case display header to canonical column id aliases
	 * @return the parsed data rows, in sheet order
	 * @throws BusinessException OPH_027 when the bytes are not a readable .xlsx workbook, or the sheet has
	 *                           more than {@link #MAX_UPLOAD_ROWS} rows
	 */
	public List<WorkbookAdjustmentRow> parse(byte[] bytes, Map<String, String> headerAliases) {
		try (XSSFWorkbook workbook = new XSSFWorkbook(new ByteArrayInputStream(bytes))) {
			XSSFSheet sheet = workbook.getSheetAt(0);
			if (sheet.getLastRowNum() > MAX_UPLOAD_ROWS) {
				throw new BusinessException(
						OperationalHubErrorReason.OPH_027,
						"the uploaded file has more than " + MAX_UPLOAD_ROWS + " rows");
			}
			List<String> headers = readHeaders(sheet.getRow(0), headerAliases);
			List<WorkbookAdjustmentRow> rows = new ArrayList<>();
			for (int rowNum = 1; rowNum <= sheet.getLastRowNum(); rowNum++) {
				Row sheetRow = sheet.getRow(rowNum);
				if (sheetRow == null) {
					continue;
				}
				rows.add(new WorkbookAdjustmentRow(rowNum + 1, readCells(sheetRow, headers)));
			}
			return rows;
		} catch (IOException | POIXMLException | IllegalArgumentException | RecordFormatException e) {
			throw new BusinessException(OperationalHubErrorReason.OPH_027, "the uploaded file is not a valid .xlsx");
		}
	}

	/**
	 * Reads a header row's cell values, lower-cased.
	 *
	 * @param headerRow the header row
	 * @return the column names, in column order
	 */
	List<String> readHeaders(Row headerRow) {
		return readHeaders(headerRow, Map.of());
	}

	/**
	 * Reads a header row's cell values, lower-cased and canonicalised through aliases.
	 *
	 * @param headerRow     the header row
	 * @param headerAliases lower-case display header to canonical column id aliases
	 * @return the canonical column names, in column order
	 */
	List<String> readHeaders(Row headerRow, Map<String, String> headerAliases) {
		DataFormatter formatter = new DataFormatter(Locale.ROOT);
		List<String> headers = new ArrayList<>();
		for (Cell cell : headerRow) {
			String header = formatter.formatCellValue(cell).trim().toLowerCase();
			headers.add(headerAliases.getOrDefault(header, header));
		}
		return headers;
	}

	/**
	 * Reads one data row's cells keyed by the given headers, in column order. A cell past the header's own
	 * width, or blank, is omitted rather than mapped to an empty string.
	 *
	 * @param sheetRow the data row
	 * @param headers  the header column names, in column order
	 * @return the row's cell values keyed by header
	 */
	Map<String, String> readCells(Row sheetRow, List<String> headers) {
		DataFormatter formatter = new DataFormatter(Locale.ROOT);
		Map<String, String> cells = new LinkedHashMap<>();
		for (int col = 0; col < headers.size(); col++) {
			Cell cell = sheetRow.getCell(col);
			if (cell == null) {
				continue;
			}
			String value = readCell(cell, formatter);
			if (!value.isEmpty()) {
				cells.put(headers.get(col), value);
			}
		}
		return cells;
	}

	/**
	 * Reads one cell as text the service layer can parse without knowing anything about spreadsheets.
	 *
	 * <p>A number is taken from the cell rather than from its display text, and that is the whole point of
	 * this method. {@code DataFormatter} renders what the user sees: it applies the cell's format, so a long
	 * decimal comes back rounded, and it applies a locale's decimal mark, so on a host whose locale writes
	 * {@code 12,5} the metric parser downstream - which strips grouping commas - would read 125. A tenfold
	 * error in a figure someone computes a cost-per-action from, with nothing on screen to suggest it.
	 *
	 * <p>A date-formatted cell is rendered ISO instead. Our templates write dates as text, but a user who
	 * retypes one lets Excel turn it into a real date, and its display text ("3/10/26", or worse, something
	 * locale-shaped) would match no row. ISO is what the column held when it was handed out.
	 *
	 * @param cell      the cell to read
	 * @param formatter the formatter used for everything that is not a number
	 * @return the cell's value as text, trimmed; empty when the cell holds nothing
	 */
	String readCell(Cell cell, DataFormatter formatter) {
		CellType type = cell.getCellType() == CellType.FORMULA
				? cell.getCachedFormulaResultType()
				: cell.getCellType();
		if (type != CellType.NUMERIC) {
			return formatter.formatCellValue(cell).trim();
		}
		if (DateUtil.isCellDateFormatted(cell)) {
			return cell.getLocalDateTimeCellValue().toLocalDate().toString();
		}
		return BigDecimal.valueOf(cell.getNumericCellValue()).stripTrailingZeros().toPlainString();
	}
}
