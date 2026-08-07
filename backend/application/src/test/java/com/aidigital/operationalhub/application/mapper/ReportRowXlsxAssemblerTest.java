package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.service.agency.model.ReportRowModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowKey;
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
				null, "Ourisman Ford", null, "Ourisman Ford 2026", "Display", null, null, null, null, null,
				null, null, null, null, null, null,
				impressions, clicks, spend, null, null, null, null, null, null, null, null, null, null,
				null, null, null, null, null, null, null, null, null, null,
				// The five derived ratios the server now computes and sends: cpm, cpc, cpv, ctr, avcr.
				null, null, null, null, null);
	}

	private ReportRowModel amazonRow() {
		return new ReportRowModel(
				"2026-04-03", "Amazon", "TCL", "587815091557859387",
				"Amazon insertion order", "L1-ID", "Amazon line item", "L2-ID",
				"March Madness_QM8K_AMZ_AMZ Display", "L3-ID",
				"tcl", "TCL", "20", "TCL 2026 Q2-Q4", "Amazon Display", "Prospecting", "-",
				"Amazon Shoppers", "626085", "-", "-", "-", "Amazon", "-", "Core", "-",
				3248L, 26L, 1.00553253, 0L, 0L, 0L, 0L, 0L, null, null, null,
				18.808714784657067, 0L, null, null, null, null, null, null, null, null, null, null,
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
				int rowKeyColumn = headerNames.indexOf(ReportRowKey.WORKBOOK_COLUMN);
				assertThat(headerNames.subList(0, rowKeyColumn)).containsExactly(
						"Date", "Platform", "Account", "Account id", "Constructed name L1", "Constructed id L1",
						"Constructed name L2", "Constructed id L2", "Constructed name L3", "Constructed id L3",
						"Agency id", "Client", "Industry code", "Campaign", "Channel", "Tactic", "Buying model", "Audience",
					"Unique line item id", "Other", "Geo", "Creative tag", "Message", "Keyword group",
					"Flight identifier", "Language",
					// No conversion columns: a report's conversions come from the conversions mart, so a value
						// written to the delivery table through this template would never be shown
						"Impressions", "Clicks", "DSP Cost", "Starts", "First quartiles", "Midpoints",
						"Third quartiles", "Completions", "Client Cost", "Link clicks");
				assertThat(headerNames.subList(rowKeyColumn, headerNames.size())).containsExactly(
						ReportRowKey.WORKBOOK_COLUMN,
						ReportRowKey.WORKBOOK_SOURCE_DATE_COLUMN,
						ReportRowKey.WORKBOOK_SOURCE_CONSTRUCTED_ID_COLUMN,
						ReportRowKey.originalMetricColumn("impressions"),
						ReportRowKey.originalMetricColumn("clicks"),
						ReportRowKey.originalMetricColumn("spend"),
						ReportRowKey.originalMetricColumn("starts"),
						ReportRowKey.originalMetricColumn("first_quartiles"),
						ReportRowKey.originalMetricColumn("midpoints"),
						ReportRowKey.originalMetricColumn("third_quartiles"),
						ReportRowKey.originalMetricColumn("completes"),
						ReportRowKey.originalMetricColumn("dynamic_cost"),
						ReportRowKey.originalMetricColumn("link_clicks"));
				for (int i = rowKeyColumn; i < headerNames.size(); i++) {
					assertThat(workbook.getSheetAt(0).isColumnHidden(i)).isTrue();
				}
				assertThat(headerNames).doesNotContain(
						"cpm", "ctr", "avcr", "created_at",
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
	void shouldKeepCanonicalAmazonLookupIdentityOutsidePlatformSpecificDisplayLabelsTest() {
		// Given: Amazon calls L1 an insertion order and L2 a line item in the UI/export. Those are display
		// labels; the service still stores them in the canonical L1/L2 fields used by the BigQuery lookup.
		byte[] bytes = assembler.toWorkbook(List.of(amazonRow()));

		// When:
		WorkbookAdjustmentRow parsed = assembler.parse(bytes).getFirst();

		// Then: upload lookup uses canonical hidden identity, not the platform-specific visible labels.
		assertThat(parsed.cells())
				.containsEntry(ReportRowKey.WORKBOOK_SOURCE_DATE_COLUMN, "2026-04-03")
				.containsEntry(ReportRowKey.WORKBOOK_SOURCE_CONSTRUCTED_ID_COLUMN, "L1-ID");
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
			int spendCol = columnIndex(header, "DSP Cost");
			int impressionsCol = columnIndex(header, "Impressions");
			int originalSpendCol = columnIndex(header, ReportRowKey.originalMetricColumn("spend"));
			assertThat(data.getCell(dateCol).getCellType()).isEqualTo(CellType.STRING);
			assertThat(data.getCell(dateCol).getStringCellValue()).isEqualTo("2026-03-10");
			assertThat(data.getCell(lineItemCol).getStringCellValue()).isEqualTo("LI-1");
			assertThat(data.getCell(spendCol).getCellType()).isEqualTo(CellType.NUMERIC);
			assertThat(data.getCell(spendCol).getNumericCellValue()).isEqualTo(90.0);
			assertThat(data.getCell(originalSpendCol).getNumericCellValue()).isEqualTo(90.0);
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
			assertThat(data.getCell(columnIndex(header, ReportRowKey.originalMetricColumn("clicks")))
					.getStringCellValue()).isEqualTo(ReportRowKey.ORIGINAL_NULL_VALUE);
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
		assertThat(parsedRow.cells()).containsEntry("client", "Ourisman Ford");
		assertThat(parsedRow.cells()).containsEntry("campaign_name", "Ourisman Ford 2026");
			assertThat(parsedRow.cells()).containsEntry("spend", "90");
			assertThat(parsedRow.cells()).containsEntry("impressions", "5000");
			assertThat(parsedRow.cells()).containsEntry("clicks", "12");
			assertThat(parsedRow.cells()).containsKey(ReportRowKey.WORKBOOK_COLUMN);
			assertThat(parsedRow.cells()).containsEntry(ReportRowKey.originalMetricColumn("spend"), "90");
			assertThat(parsedRow.cells()).containsEntry(
					ReportRowKey.originalMetricColumn("dynamic_cost"),
					ReportRowKey.ORIGINAL_NULL_VALUE);
		}

	@Test
	void shouldAcceptDisplayAndCanonicalSnakeCaseHeadersOnUploadTest() {
		// Verification:
		assertThat(assembler.headerAliases())
				.containsEntry("creative id", "campaign_constructed_id")
					.containsEntry("campaign_constructed_id", "campaign_constructed_id")
					.containsEntry("client", "client")
					.containsEntry("campaign", "campaign_name")
					.containsEntry("campaign_name", "campaign_name")
					.containsEntry("dsp cost", "spend")
					.containsEntry("spend", "spend")
					// PDI_105 moved "Client Cost" from spend to dynamic_cost. A template downloaded before
					// that rename still says "Client Cost" over its spend column, and would be read into
					// dynamic_cost - see the assembler's note on retired labels.
					.containsEntry("client cost", "dynamic_cost")
					.containsEntry("dynamic_cost", "dynamic_cost")
					.containsEntry(ReportRowKey.WORKBOOK_COLUMN, ReportRowKey.WORKBOOK_COLUMN)
					.containsEntry(
							ReportRowKey.WORKBOOK_SOURCE_DATE_COLUMN,
							ReportRowKey.WORKBOOK_SOURCE_DATE_COLUMN)
					.containsEntry(
							ReportRowKey.WORKBOOK_SOURCE_CONSTRUCTED_ID_COLUMN,
							ReportRowKey.WORKBOOK_SOURCE_CONSTRUCTED_ID_COLUMN)
					.containsEntry(
							ReportRowKey.originalMetricColumn("spend"),
							ReportRowKey.originalMetricColumn("spend"))
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
