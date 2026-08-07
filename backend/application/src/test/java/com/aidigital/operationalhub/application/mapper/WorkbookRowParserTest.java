package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.service.agency.model.WorkbookAdjustmentRow;
import org.apache.poi.ss.usermodel.CellStyle;
import org.apache.poi.ss.usermodel.CreationHelper;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.time.LocalDate;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link WorkbookRowParser}, the shared reader every bulk-adjustment upload goes through.
 */
class WorkbookRowParserTest {

	private final WorkbookRowParser parser = new WorkbookRowParser();

	private byte[] workbook(WorkbookContent content) {
		try (XSSFWorkbook workbook = new XSSFWorkbook(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
			Sheet sheet = workbook.createSheet("Sheet1");
			content.fill(workbook, sheet);
			workbook.write(out);
			return out.toByteArray();
		} catch (IOException e) {
			throw new IllegalStateException("Failed to build the test workbook", e);
		}
	}

	/** Fills a freshly created test workbook. */
	private interface WorkbookContent {
		void fill(XSSFWorkbook workbook, Sheet sheet);
	}

	@Test
	void shouldReadADecimalWithADotWhateverTheHostLocaleWritesTest() {
		// Given: a numeric cell holding 12.5, and a host locale whose decimal mark is a comma
		byte[] bytes = workbook((workbook, sheet) -> {
			sheet.createRow(0).createCell(0).setCellValue("conversions");
			sheet.createRow(1).createCell(0).setCellValue(12.5);
		});
		Locale original = Locale.getDefault();

		// When:
		List<WorkbookAdjustmentRow> parsed;
		try {
			Locale.setDefault(Locale.GERMANY);
			parsed = parser.parse(bytes);
		} finally {
			Locale.setDefault(original);
		}

		// Then: "12,5" would reach the metric parser, which strips grouping commas, and be read as 125 -
		// a tenfold error in a figure a cost-per-action is computed from
		assertThat(parsed.get(0).cells()).containsEntry("conversions", "12.5");
	}

	@Test
	void shouldKeepEveryDecimalPlaceTheCellHoldsTest() {
		// Given: more decimals than a cell's display format would show
		byte[] bytes = workbook((workbook, sheet) -> {
			sheet.createRow(0).createCell(0).setCellValue("conversions");
			sheet.createRow(1).createCell(0).setCellValue(12.3456789012345);
		});

		// When:
		List<WorkbookAdjustmentRow> parsed = parser.parse(bytes);

		// Then: a rounded read-back would differ from the stored figure, and an untouched row would be
		// written as an adjustment its owner never made
		assertThat(parsed.get(0).cells()).containsEntry("conversions", "12.3456789012345");
	}

	@Test
	void shouldReadAWholeNumberWithoutATrailingZeroTest() {
		// Given:
		byte[] bytes = workbook((workbook, sheet) -> {
			sheet.createRow(0).createCell(0).setCellValue("impressions");
			sheet.createRow(1).createCell(0).setCellValue(5000d);
		});

		// When:
		List<WorkbookAdjustmentRow> parsed = parser.parse(bytes);

		// Then: "5000", not "5000.0" - it is an impression count, and the text is what a user sees in an error
		assertThat(parsed.get(0).cells()).containsEntry("impressions", "5000");
	}

	@Test
	void shouldReadADateFormattedCellAsIsoTest() {
		// Given: a real date cell - what Excel leaves behind when a user retypes the template's date text
		byte[] bytes = workbook((workbook, sheet) -> {
			CreationHelper helper = workbook.getCreationHelper();
			CellStyle dateStyle = workbook.createCellStyle();
			dateStyle.setDataFormat(helper.createDataFormat().getFormat("m/d/yy"));
			sheet.createRow(0).createCell(0).setCellValue("date");
			Row data = sheet.createRow(1);
			data.createCell(0).setCellValue(LocalDate.of(2026, 3, 10));
			data.getCell(0).setCellStyle(dateStyle);
		});

		// When:
		List<WorkbookAdjustmentRow> parsed = parser.parse(bytes);

		// Then: the cell's display text ("3/10/26") would match no row; ISO is what the column held when
		// the template was handed out
		assertThat(parsed.get(0).cells()).containsEntry("date", "2026-03-10");
	}

	@Test
	void shouldReadAFormulaCellByItsCachedNumericResultTest() {
		// Given: a user who computed the new figure in the sheet instead of typing it
		byte[] bytes = workbook((workbook, sheet) -> {
			sheet.createRow(0).createCell(0).setCellValue("conversions");
			Row data = sheet.createRow(1);
			data.createCell(0).setCellFormula("6*2.5");
			// POI does not evaluate on write; the cached result is what a spreadsheet application leaves.
			data.getCell(0).setCellValue(15d);
		});

		// When:
		List<WorkbookAdjustmentRow> parsed = parser.parse(bytes);

		// Then:
		assertThat(parsed.get(0).cells()).containsEntry("conversions", "15");
	}

	@Test
	void shouldOmitABlankCellRatherThanMapItToAnEmptyStringTest() {
		// Given: a row whose second column was cleared
		byte[] bytes = workbook((workbook, sheet) -> {
			Row header = sheet.createRow(0);
			header.createCell(0).setCellValue("date");
			header.createCell(1).setCellValue("creative_id");
			Row data = sheet.createRow(1);
			data.createCell(0).setCellValue("2026-03-10");
			data.createCell(1).setCellValue("   ");
		});

		// When:
		List<WorkbookAdjustmentRow> parsed = parser.parse(bytes);

		// Then: absent, so the service's key normalization sees the same null it would for a missing cell
		assertThat(parsed.get(0).cells()).containsEntry("date", "2026-03-10");
		assertThat(parsed.get(0).cells()).doesNotContainKey("creative_id");
	}

	@Test
	void shouldCanonicaliseDisplayHeadersThroughAliasesTest() {
		// Given: the header a user sees in a downloaded workbook
		byte[] bytes = workbook((workbook, sheet) -> {
			Row header = sheet.createRow(0);
			header.createCell(0).setCellValue("Creative id");
			header.createCell(1).setCellValue("Cost");
			Row data = sheet.createRow(1);
			data.createCell(0).setCellValue("CR-1");
			data.createCell(1).setCellValue(12.5);
		});

		// When:
		List<WorkbookAdjustmentRow> parsed = parser.parse(bytes, Map.of(
				"creative id", "campaign_constructed_id",
				"cost", "spend"));

		// Then: the service sees the same canonical keys it used before display labels were introduced.
		assertThat(parsed.get(0).cells()).containsEntry("campaign_constructed_id", "CR-1");
		assertThat(parsed.get(0).cells()).containsEntry("spend", "12.5");
	}

	@Test
	void shouldNumberTheRowsAsTheSpreadsheetDoesTest() {
		// Given: two data rows under a header
		byte[] bytes = workbook((workbook, sheet) -> {
			sheet.createRow(0).createCell(0).setCellValue("date");
			sheet.createRow(1).createCell(0).setCellValue("2026-03-10");
			sheet.createRow(2).createCell(0).setCellValue("2026-03-11");
		});

		// When:
		List<WorkbookAdjustmentRow> parsed = parser.parse(bytes);

		// Then: one-based and header-inclusive, so an error message names the row the user is looking at
		assertThat(parsed).hasSize(2);
		assertThat(parsed.get(0).sourceRowNumber()).isEqualTo(2);
		assertThat(parsed.get(1).sourceRowNumber()).isEqualTo(3);
	}
}
