package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.service.agency.model.ReportRowModel;
import com.aidigital.operationalhub.service.agency.model.WorkbookAdjustmentRow;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.StreamSupport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Unit tests for {@link ReportRowXlsxAssembler}.
 */
class ReportRowXlsxAssemblerTest {

	private final ReportRowXlsxAssembler assembler =
			new ReportRowXlsxAssembler(new WorkbookRowParser(), new ReportRowXlsxExportAssembler());

	private ReportRowModel row(String date, String lineItemId, Long impressions, Long clicks, Double spend) {
		return new ReportRowModel(
				date, "dv_360_dlv", null, null, "New Line", lineItemId, null, null, "Hero creative", "CR-1",
				null, null, null, null, "Display", null, null, null, null, null,
				null, null, null, null, null, null,
				impressions, clicks, spend, null, null, null, null, null, null, null, null, null, null,
				null, null, null, null, null, null, null, null, null, null,
				// The five derived ratios the server now computes and sends: cpm, cpc, cpv, ctr, avcr.
				null, null, null, null, null);
	}

	@Test
	void shouldWriteAHeaderRowOfTheEditableTemplateColumnsTest() throws IOException {
		// Execution:
		byte[] bytes = assembler.toWorkbook(List.of());

		// Verification:
		try (XSSFWorkbook workbook = new XSSFWorkbook(new ByteArrayInputStream(bytes))) {
			Row header = workbook.getSheetAt(0).getRow(0);
			List<String> headerNames = StreamSupport.stream(header.spliterator(), false)
					.map(Cell::getStringCellValue)
					.collect(Collectors.toList());
			assertThat(headerNames).containsExactly(
					"Date", "Platform", "Account", "Account id", "Constructed name L1", "Constructed id L1",
					"Constructed name L2", "Constructed id L2", "Constructed name L3", "Constructed id L3",
					"Agency id", "Industry code", "Channel", "Tactic", "Buying model", "Audience",
					"Unique line item id", "Other", "Geo", "Creative tag", "Message", "Keyword group",
					"Flight identifier", "Language",
					// No conversion columns: a report's conversions come from the conversions mart, so a value
					// written to the delivery table through this template would never be shown
					"Impressions", "Clicks", "Client Cost", "Starts", "First quartiles", "Midpoints",
					"Third quartiles", "Completions", "Dynamic cost", "Link clicks");
			assertThat(headerNames).doesNotContain(
					"cpm", "ctr", "avcr", "created_at", "client", "campaign_name",
					"rate_type", "line_item_description", "dynamic_rate", "avg_dynamic_rate_by_date_tactic",
					"conversions", "post_click_conversions", "post_view_conversions");
		}
	}

	@Test
	void shouldUsePlatformSpecificConstructedLevelNamesInTemplateHeadersTest() throws IOException {
		// Given:
		ReportRowModel model = row("2026-03-10", "LI-1", 5000L, 12L, 90.0);

		// Execution:
		byte[] bytes = assembler.toWorkbook(List.of(model));

		// Verification:
		try (XSSFWorkbook workbook = new XSSFWorkbook(new ByteArrayInputStream(bytes))) {
			Row header = workbook.getSheetAt(0).getRow(0);
			List<String> headerNames = StreamSupport.stream(header.spliterator(), false)
					.map(Cell::getStringCellValue)
					.collect(Collectors.toList());
			assertThat(headerNames).containsSubsequence(
					"Line item name", "Line item id", "Insertion order name", "Insertion order id",
					"Creative name", "Creative id");
		}
	}

	@Test
	void shouldWriteOneNumericMetricCellAndTextIdentityCellPerRowTest() throws IOException {
		// Given:
		ReportRowModel model = row("2026-03-10", "LI-1", 5000L, 12L, 90.0);

		// Execution:
		byte[] bytes = assembler.toWorkbook(List.of(model));

		// Verification:
		try (XSSFWorkbook workbook = new XSSFWorkbook(new ByteArrayInputStream(bytes))) {
			Row header = workbook.getSheetAt(0).getRow(0);
			Row data = workbook.getSheetAt(0).getRow(1);
			int dateCol = columnIndex(header, "Date");
			int lineItemCol = columnIndex(header, "Line item id");
			int spendCol = columnIndex(header, "Client Cost");
			int impressionsCol = columnIndex(header, "Impressions");
			assertThat(data.getCell(dateCol).getCellType()).isEqualTo(CellType.STRING);
			assertThat(data.getCell(dateCol).getStringCellValue()).isEqualTo("2026-03-10");
			assertThat(data.getCell(lineItemCol).getStringCellValue()).isEqualTo("LI-1");
			assertThat(data.getCell(spendCol).getCellType()).isEqualTo(CellType.NUMERIC);
			assertThat(data.getCell(spendCol).getNumericCellValue()).isEqualTo(90.0);
			assertThat(data.getCell(impressionsCol).getNumericCellValue()).isEqualTo(5000.0);
		}
	}

	@Test
	void shouldLeaveAnUnadjustedMetricCellBlankTest() throws IOException {
		// Given: clicks is null
		ReportRowModel model = row("2026-03-10", "LI-1", 5000L, null, 90.0);

		// Execution:
		byte[] bytes = assembler.toWorkbook(List.of(model));

		// Verification:
		try (XSSFWorkbook workbook = new XSSFWorkbook(new ByteArrayInputStream(bytes))) {
			Row header = workbook.getSheetAt(0).getRow(0);
			Row data = workbook.getSheetAt(0).getRow(1);
			int clicksCol = columnIndex(header, "Clicks");
			assertThat(data.getCell(clicksCol)).isNull();
		}
	}

	@Test
	void shouldParseEachDataRowKeyedByHeaderTest() {
		// Given: a workbook rendered by this same assembler
		ReportRowModel model = row("2026-03-10", "LI-1", 5000L, 12L, 90.0);
		byte[] bytes = assembler.toWorkbook(List.of(model));

		// Execution:
		List<WorkbookAdjustmentRow> parsed = assembler.parse(bytes);

		// Verification:
		assertThat(parsed).hasSize(1);
		WorkbookAdjustmentRow parsedRow = parsed.get(0);
		assertThat(parsedRow.sourceRowNumber()).isEqualTo(2);
		assertThat(parsedRow.cells()).containsEntry("date", "2026-03-10");
		assertThat(parsedRow.cells()).containsEntry("line_item_id", "LI-1");
		assertThat(parsedRow.cells()).containsEntry("spend", "90");
		assertThat(parsedRow.cells()).containsEntry("impressions", "5000");
		assertThat(parsedRow.cells()).containsEntry("clicks", "12");
	}

	@Test
	void shouldAcceptDisplayAndCanonicalSnakeCaseHeadersOnUploadTest() {
		// Verification:
		assertThat(assembler.headerAliases())
				.containsEntry("creative id", "campaign_constructed_id")
				.containsEntry("campaign_constructed_id", "campaign_constructed_id")
				.containsEntry("client cost", "spend")
				.containsEntry("spend", "spend")
				.doesNotContainEntry("cost", "spend");
	}

	@Test
	void shouldRejectAnUploadWithMoreThanTheMaxRowsTest() {
		// Given: a workbook with more rows than the assembler will accept
		ReportRowModel model = row("2026-03-10", "LI-1", 1L, 1L, 1.0);
		byte[] bytes = assembler.toWorkbook(Collections.nCopies(100_001, model));

		// Execution + Verification:
		assertThatThrownBy(() -> assembler.parse(bytes))
				.isInstanceOf(BusinessException.class)
				.extracting(e -> ((BusinessException) e).getCode())
				.isEqualTo(OperationalHubErrorReason.OPH_027.getCode());
	}

	@Test
	void shouldThrowOph027WhenBytesAreNotAValidXlsxTest() {
		// Execution + Verification:
		assertThatThrownBy(() -> assembler.parse("not a zip".getBytes(StandardCharsets.UTF_8)))
				.isInstanceOf(BusinessException.class)
				.extracting(e -> ((BusinessException) e).getCode())
				.isEqualTo(OperationalHubErrorReason.OPH_027.getCode());
	}

	private int columnIndex(Row header, String columnName) {
		for (Cell cell : header) {
			if (cell.getStringCellValue().equals(columnName)) {
				return cell.getColumnIndex();
			}
		}
		throw new IllegalArgumentException("No such column: " + columnName);
	}
}
