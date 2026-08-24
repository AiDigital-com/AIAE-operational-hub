package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.service.agency.model.ConversionRowModel;
import com.aidigital.operationalhub.service.agency.model.ConversionTemplateColumn;
import com.aidigital.operationalhub.service.agency.model.WorkbookAdjustmentRow;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.StreamSupport;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link ConversionAdjustmentXlsxAssembler}, the conversions round-trip spreadsheet.
 */
class ConversionAdjustmentXlsxAssemblerTest {

	private final ConversionAdjustmentXlsxAssembler assembler =
			new ConversionAdjustmentXlsxAssembler(
					new WorkbookRowParser(), new ReportRowXlsxExportAssembler(new ColumnOrderArranger()));

	private ConversionRowModel row(String action, Double conversions) {
		return new ConversionRowModel(
				"2026-03-10", "DV360", "Ourisman Main", "acct-1",
				action, "PURCHASE",
				"20_Ourisman Ford_AUTO_Ourisman Ford 2026_Display_Retargeting", "LI-1",
				"Display — Ourisman Ford 2026", "IO-1",
				"Hero 30s", "CR-1",
				conversions);
	}

	@Test
	void shouldWriteAHeaderCarryingTheConversionActionAndTheOneEditableColumnTest() throws IOException {
		// When:
		byte[] bytes = assembler.toWorkbook(List.of());

		// Then: the action is what this template exists for - a delivery row has no column for it
		try (XSSFWorkbook workbook = new XSSFWorkbook(new ByteArrayInputStream(bytes))) {
			Row header = workbook.getSheetAt(0).getRow(0);
			List<String> headerNames = StreamSupport.stream(header.spliterator(), false)
					.map(Cell::getStringCellValue)
					.collect(Collectors.toList());
			assertThat(headerNames).containsExactly(
					"Date", "Line item id", "Insertion order id", "Creative id",
					"Conversion action", "Conversion category",
					"Platform", "Account", "Account id",
					"Line item name", "Insertion order name", "Creative name",
					"Conversions");
			assertThat(headerNames).doesNotContain(
					"Impressions", "Clicks", "Cost", "Revenue", "Installs",
					"Created at", "Created by", "Adjusted metrics");
		}
	}

	@Test
	void shouldWriteExactlyTheDeclaredHeaderTest() throws IOException {
		// Given: the columns and their order are declared once, in the service module
		byte[] bytes = assembler.toWorkbook(List.of());

		// When:
		try (XSSFWorkbook workbook = new XSSFWorkbook(new ByteArrayInputStream(bytes))) {
			Row header = workbook.getSheetAt(0).getRow(0);
			List<String> headerNames = StreamSupport.stream(header.spliterator(), false)
					.map(Cell::getStringCellValue)
					.collect(Collectors.toList());

			// Then: the sheet is that declaration, in that order, with user-facing labels. The upload
			// canonicalises those labels back to the service column ids before validation.
			assertThat(headerNames).isEqualTo(ConversionTemplateColumn.header().stream()
					.map(assembler::displayHeader)
					.toList());
			assertThat(assembler.headerAliases()).containsEntry("creative id", "creative_id")
					.containsEntry("creative_id", "creative_id")
					.containsEntry("conversions", ConversionTemplateColumn.CONVERSIONS);
		}
	}

	@Test
	void shouldWriteIdentityAsTextAndConversionsAsANumberTest() throws IOException {
		// Given:
		ConversionRowModel model = row("Purchase", 12.0);

		// When:
		byte[] bytes = assembler.toWorkbook(List.of(model));

		// Then:
		try (XSSFWorkbook workbook = new XSSFWorkbook(new ByteArrayInputStream(bytes))) {
			Row header = workbook.getSheetAt(0).getRow(0);
			Row data = workbook.getSheetAt(0).getRow(1);
			assertThat(data.getCell(columnIndex(header, "Date")).getStringCellValue()).isEqualTo("2026-03-10");
			assertThat(data.getCell(columnIndex(header, "Conversion action")).getStringCellValue())
					.isEqualTo("Purchase");
			Cell conversions = data.getCell(columnIndex(header, "Conversions"));
			assertThat(conversions.getCellType()).isEqualTo(CellType.NUMERIC);
			assertThat(conversions.getNumericCellValue()).isEqualTo(12.0);
		}
	}

	@Test
	void shouldWriteZeroRatherThanABlankForARowWithNoConversionsTest() throws IOException {
		// Given: the view coalesces every metric to zero, so it has no null to report
		ConversionRowModel model = row("Purchase", null);

		// When:
		byte[] bytes = assembler.toWorkbook(List.of(model));

		// Then: a blank would read as "not edited" on the way back, making a deliberate zero impossible
		try (XSSFWorkbook workbook = new XSSFWorkbook(new ByteArrayInputStream(bytes))) {
			Row header = workbook.getSheetAt(0).getRow(0);
			Row data = workbook.getSheetAt(0).getRow(1);
			Cell conversions = data.getCell(columnIndex(header, "Conversions"));
			assertThat(conversions).isNotNull();
			assertThat(conversions.getNumericCellValue()).isZero();
		}
	}

	@Test
	void shouldParseItsOwnWorkbookBackIntoHeaderKeyedRowsTest() {
		// Given: a workbook this assembler rendered
		byte[] bytes = assembler.toWorkbook(List.of(row("Purchase", 12.0)));

		// When:
		List<WorkbookAdjustmentRow> parsed = assembler.parse(bytes);

		// Then:
		assertThat(parsed).hasSize(1);
		assertThat(parsed.get(0).sourceRowNumber()).isEqualTo(2);
		assertThat(parsed.get(0).cells()).containsEntry("date", "2026-03-10");
		assertThat(parsed.get(0).cells()).containsEntry("conversion_action", "Purchase");
		assertThat(parsed.get(0).cells()).containsEntry("creative_id", "CR-1");
		assertThat(parsed.get(0).cells()).containsEntry("conversions", "12");
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
