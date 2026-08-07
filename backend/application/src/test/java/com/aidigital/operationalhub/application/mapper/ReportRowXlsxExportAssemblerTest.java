package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.service.agency.model.ReportRowModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowTotalsModel;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.StreamSupport;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link ReportRowXlsxExportAssembler}.
 */
class ReportRowXlsxExportAssemblerTest {

	private final ReportRowXlsxExportAssembler assembler = new ReportRowXlsxExportAssembler();

	private ReportRowModel row(String account, String message, Long impressions, Long clicks, Double spend) {
		return new ReportRowModel(
				"2026-03-10", "dv_360_dlv", account, null, null, "LI-1", null, null, null, null,
				null, "Ourisman Ford", null, "Ourisman Ford 2026", "Display", null, null, null, null, null,
				null, null, message, null, null, null,
				impressions, clicks, spend, null, null, null, null, null, null, null, null, null, null,
				null, null, null, null, null, null, null, null, null, null,
				// The five derived ratios the server now computes and sends: cpm, cpc, cpv, ctr, avcr.
				null, null, null, null, null);
	}

	private ReportRowModel rowWithRatios(Double cpm, Double ctr) {
		return new ReportRowModel(
				"2026-03-10", "dv_360_dlv", "Ourisman Main", null, null, "LI-1", null, null, null, null,
				null, "Ourisman Ford", null, "Ourisman Ford 2026", "Display", null, null, null, null, null,
				null, null, null, null, null, null,
				5000L, 12L, 92.5, null, null, null, null, null, null, null, null, null, null,
				null, null, null, null, null, null, null, null, null, null,
				cpm, null, null, ctr, null);
	}

	@Test
	void shouldRenderTheFullRawExportSchemaWhenNoColumnsSelectedTest() throws IOException {
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
					"Agency id", "Client", "Industry code", "Campaign", "Channel", "Tactic", "Buying model",
					"Audience", "Unique line item id", "Other", "Geo", "Creative tag", "Message", "Keyword group",
					"Flight identifier", "Language", "Impressions", "Clicks", "DSP Cost", "Starts", "First quartiles",
					"Midpoints", "Third quartiles", "Completions", "Conversions", "Post-click conversions",
					"Post-view conversions", "Client Cost", "Link clicks", "Adjusted metrics", "Created at",
					"Created by", "Last modified at", "Last modified by", "Rate type", "Client CPM",
					"Average Client CPM (by date/tactic)", "Description", "IVT");
		}
	}

	@Test
	void shouldRenderOnlySelectedCurrentViewColumnsAsWorkbookHeadersTest() throws IOException {
		// Given:
		ReportRowModel model = row("Ourisman Main", null, 5000L, 12L, 92.5);

		// Execution:
		byte[] bytes = assembler.toWorkbook(List.of(model), List.of("date", "line_item_id", "impressions"), null);

		// Verification:
		try (XSSFWorkbook workbook = new XSSFWorkbook(new ByteArrayInputStream(bytes))) {
			Row header = workbook.getSheetAt(0).getRow(0);
			List<String> headerNames = StreamSupport.stream(header.spliterator(), false)
					.map(Cell::getStringCellValue)
					.collect(Collectors.toList());
			assertThat(headerNames).containsExactly("Date", "Line item id", "Impressions");
		}
	}

	@Test
	void shouldUseTheSameConstructedLevelLabelsAsTheInterfaceTest() throws IOException {
		// Given: DV360 rows agree that level 3 is the creative
		ReportRowModel model = row("Ourisman Main", null, 5000L, 12L, 92.5);

		// Execution:
		byte[] bytes = assembler.toWorkbook(
				List.of(model), List.of("campaign_constructed_name", "campaign_constructed_id"), null);

		// Verification:
		try (XSSFWorkbook workbook = new XSSFWorkbook(new ByteArrayInputStream(bytes))) {
			Row header = workbook.getSheetAt(0).getRow(0);
			List<String> headerNames = StreamSupport.stream(header.spliterator(), false)
					.map(Cell::getStringCellValue)
					.collect(Collectors.toList());
			assertThat(headerNames).containsExactly("Creative name", "Creative id");
		}
	}

	@Test
	void shouldWriteMetricCellsAsNumbersAndIdentityCellsAsTextTest() throws IOException {
		// Given:
		ReportRowModel model = row("Ourisman Main", null, 5000L, 12L, 92.5);

		// Execution:
		byte[] bytes = assembler.toWorkbook(List.of(model), List.of("date", "line_item_id", "impressions"), null);

		// Verification:
		try (XSSFWorkbook workbook = new XSSFWorkbook(new ByteArrayInputStream(bytes))) {
			Row data = workbook.getSheetAt(0).getRow(1);
			assertThat(data.getCell(0).getCellType()).isEqualTo(CellType.STRING);
			assertThat(data.getCell(0).getStringCellValue()).isEqualTo("2026-03-10");
			assertThat(data.getCell(1).getStringCellValue()).isEqualTo("LI-1");
			assertThat(data.getCell(2).getCellType()).isEqualTo(CellType.NUMERIC);
			assertThat(data.getCell(2).getNumericCellValue()).isEqualTo(5000.0);
		}
	}

	@Test
	void shouldWriteTheRatiosTheServerComputedRatherThanRecomputingThemTest() {
		// Given: a row carrying its own ratios. They are gated by channel and built on the rate-card cost,
		// so recomputing them here from spend and impressions would put a different CPM in the file than
		// the one on the screen it was exported from - which it once did.
		ReportRowModel model = rowWithRatios(18.5, 0.24);

		// Execution:
		byte[] bytes = assembler.toWorkbook(List.of(model), List.of("cpm", "ctr"), null);

		// Verification:
		try (XSSFWorkbook workbook = new XSSFWorkbook(new ByteArrayInputStream(bytes))) {
			Row data = workbook.getSheetAt(0).getRow(1);
			assertThat(data.getCell(0).getCellType()).isEqualTo(CellType.NUMERIC);
			assertThat(data.getCell(0).getNumericCellValue()).isEqualTo(model.cpm());
			assertThat(data.getCell(1).getNumericCellValue()).isEqualTo(model.ctr());
		} catch (IOException e) {
			throw new AssertionError(e);
		}
	}

	@Test
	void shouldLeaveARatioTheRowDoesNotHaveBlankTest() throws IOException {
		// Given: a search line - it spends and it serves, but a CPM on search means nothing, so the server
		// sent none
		ReportRowModel model = row("Ourisman Main", null, 5000L, 12L, 92.5);

		// Execution:
		byte[] bytes = assembler.toWorkbook(List.of(model), List.of("date", "cpm"), null);

		// Verification: blank, not a zero and not a figure invented from spend
		try (XSSFWorkbook workbook = new XSSFWorkbook(new ByteArrayInputStream(bytes))) {
			assertThat(workbook.getSheetAt(0).getRow(1).getCell(1)).isNull();
		}
	}

	@Test
	void shouldLeaveANullMetricCellBlankTest() throws IOException {
		// Given: clicks is null
		ReportRowModel model = row("Ourisman Main", null, 5000L, null, 92.5);

		// Execution:
		byte[] bytes = assembler.toWorkbook(List.of(model), List.of("date", "clicks"), null);

		// Verification:
		try (XSSFWorkbook workbook = new XSSFWorkbook(new ByteArrayInputStream(bytes))) {
			Row data = workbook.getSheetAt(0).getRow(1);
			assertThat(data.getCell(1)).isNull();
		}
	}

	@Test
	void shouldResolveEveryExportableColumnIncludingDerivedRatiosTest() throws IOException {
		// Given: every exportable column, identity/audit + metric + derived, requested at once
		ReportRowModel model = row("Ourisman Main", null, 5000L, 12L, 92.5);
		List<String> allColumns = List.of(
				"date", "platform", "account", "account_id", "line_item_name", "line_item_id",
				"insertion_order_name", "insertion_order_id", "campaign_constructed_name", "campaign_constructed_id",
				"agency_id", "client", "industry_code", "campaign_name", "channel", "tactic", "buying_model",
				"audience", "unique_line_item_id", "other", "geo", "creative_tag", "message", "keyword_group",
				"flight_identifier", "language", "impressions", "clicks", "spend", "starts", "first_quartiles",
				"midpoints", "third_quartiles", "completes", "conversions", "post_click_conversions",
				"post_view_conversions", "dynamic_cost", "link_clicks", "adjusted_metrics", "created_at",
				"created_by", "last_modified_at", "last_modified_by", "rate_type", "dynamic_rate",
				"avg_dynamic_rate_by_date_tactic", "line_item_description", "cpm", "cpc", "cpv", "ctr", "avcr",
				"ivt");

		// Execution:
		byte[] bytes = assembler.toWorkbook(List.of(model), allColumns, null);

		// Verification:
		try (XSSFWorkbook workbook = new XSSFWorkbook(new ByteArrayInputStream(bytes))) {
			Row header = workbook.getSheetAt(0).getRow(0);
			List<String> headerNames = StreamSupport.stream(header.spliterator(), false)
					.map(Cell::getStringCellValue)
					.collect(Collectors.toList());
			assertThat(headerNames).containsExactly(
					"Date", "Platform", "Account", "Account id", "Line item name", "Line item id",
					"Insertion order name", "Insertion order id", "Creative name", "Creative id",
					"Agency id", "Client", "Industry code", "Campaign", "Channel", "Tactic", "Buying model",
					"Audience", "Unique line item id", "Other", "Geo", "Creative tag", "Message", "Keyword group",
					"Flight identifier", "Language", "Impressions", "Clicks", "DSP Cost", "Starts", "First quartiles",
					"Midpoints", "Third quartiles", "Completions", "Conversions", "Post-click conversions",
					"Post-view conversions", "Client Cost", "Link clicks", "Adjusted metrics", "Created at",
					"Created by", "Last modified at", "Last modified by", "Rate type", "Client CPM",
					"Average Client CPM (by date/tactic)", "Description", "CPM", "CPC", "CPV", "CTR", "AVCR",
					"IVT");
			Row data = workbook.getSheetAt(0).getRow(1);
			int dateCol = allColumns.indexOf("date");
			int impressionsCol = allColumns.indexOf("impressions");
			assertThat(data.getCell(dateCol).getStringCellValue()).isEqualTo(model.date());
			assertThat(data.getCell(impressionsCol).getNumericCellValue())
					.isEqualTo(model.impressions().doubleValue());
		}
	}

	@Test
	void shouldNotExposeRawColumnIdsInAFullDownloadHeaderTest() throws IOException {
		// Execution:
		byte[] bytes = assembler.toWorkbook(List.of());

		// Verification:
		try (XSSFWorkbook workbook = new XSSFWorkbook(new ByteArrayInputStream(bytes))) {
			Row header = workbook.getSheetAt(0).getRow(0);
			List<String> headerNames = StreamSupport.stream(header.spliterator(), false)
					.map(Cell::getStringCellValue)
					.collect(Collectors.toList());
			assertThat(headerNames).noneMatch(name -> name.contains("_"));
			assertThat(headerNames).contains("Adjusted metrics", "Average Client CPM (by date/tactic)", "IVT");
		}
	}

	@Test
	void shouldStateTheReportsOwnTotalsOnTheirOwnSheetTest() throws IOException {
		// Given: six rows whose CPMs average to something other than the report's weighted CPM
		ReportRowModel model = row("Ourisman Main", null, 5000L, 12L, 92.5);
		ReportRowTotalsModel totals = new ReportRowTotalsModel(
				3_000_000L, 900L, 4_350.0, null, null, null, null, null, null, null, null, null, null,
				null, null, null, 1.45, 4.83, null, 0.03, null);

		// Execution:
		byte[] bytes = assembler.toWorkbook(List.of(model), List.of("date", "impressions", "spend", "cpm"), totals);

		// Verification: the number the screen shows, on a sheet of its own, with what it is a ratio of
		try (XSSFWorkbook workbook = new XSSFWorkbook(new ByteArrayInputStream(bytes))) {
			assertThat(workbook.getNumberOfSheets()).isEqualTo(2);
			Sheet sheetTotals = workbook.getSheet("Totals");
			List<String> headerNames = StreamSupport.stream(sheetTotals.getRow(0).spliterator(), false)
					.map(Cell::getStringCellValue)
					.collect(Collectors.toList());
			assertThat(headerNames).containsExactly("metric", "total", "basis");
			assertThat(sheetTotals.getRow(1).getCell(0).getStringCellValue()).isEqualTo("Impressions");
			assertThat(sheetTotals.getRow(1).getCell(1).getNumericCellValue()).isEqualTo(3_000_000.0);
			assertThat(sheetTotals.getRow(2).getCell(0).getStringCellValue()).isEqualTo("DSP Cost");
			assertThat(sheetTotals.getRow(3).getCell(0).getStringCellValue()).isEqualTo("CPM");
			assertThat(sheetTotals.getRow(3).getCell(1).getNumericCellValue()).isEqualTo(1.45);
			assertThat(sheetTotals.getRow(3).getCell(2).getStringCellValue())
					.isEqualTo("total client cost / total impressions x 1000");
			// The date column has no total, so it gets no row - the sheet lists metrics only.
			assertThat(sheetTotals.getLastRowNum()).isEqualTo(3);
		}
	}

	@Test
	void shouldKeepTheDataSheetAPlainRectangleWithNoTotalRowTest() throws IOException {
		// Given: two rows and a set of totals
		ReportRowModel model = row("Ourisman Main", null, 5000L, 12L, 92.5);
		ReportRowTotalsModel totals = Instancio.create(ReportRowTotalsModel.class);

		// Execution:
		byte[] bytes = assembler.toWorkbook(List.of(model, model), List.of("date", "impressions"), totals);

		// Verification: header + two data rows and nothing else, so a sort or a SUM over the column in
		// Excel cannot pick up a total row and double-count it
		try (XSSFWorkbook workbook = new XSSFWorkbook(new ByteArrayInputStream(bytes))) {
			Sheet data = workbook.getSheet("Report");
			assertThat(data.getLastRowNum()).isEqualTo(2);
			assertThat(data.getRow(1).getCell(1).getNumericCellValue()).isEqualTo(5000.0);
			assertThat(data.getRow(2).getCell(1).getNumericCellValue()).isEqualTo(5000.0);
		}
	}

	@Test
	void shouldOmitTheTotalsSheetWhenThereAreNoTotalsTest() throws IOException {
		// Given: the raw full-schema export, which carries no totals
		ReportRowModel model = row("Ourisman Main", null, 5000L, 12L, 92.5);

		// Execution:
		byte[] bytes = assembler.toWorkbook(List.of(model));

		// Verification:
		try (XSSFWorkbook workbook = new XSSFWorkbook(new ByteArrayInputStream(bytes))) {
			assertThat(workbook.getNumberOfSheets()).isEqualTo(1);
			assertThat(workbook.getSheet("Totals")).isNull();
		}
	}

}
