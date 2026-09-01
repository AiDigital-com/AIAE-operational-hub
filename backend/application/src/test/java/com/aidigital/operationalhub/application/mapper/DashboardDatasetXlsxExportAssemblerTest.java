package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.service.dashboard.model.DashboardColumnChoice;
import com.aidigital.operationalhub.service.dashboard.model.DashboardDatasetRow;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.stream.StreamSupport;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link DashboardDatasetXlsxExportAssembler}.
 */
class DashboardDatasetXlsxExportAssemblerTest {

	private final DashboardDatasetXlsxExportAssembler assembler =
			new DashboardDatasetXlsxExportAssembler(new ColumnOrderArranger());

	@Test
	void shouldRenderOnlyMandatoryColumnsWhenNoOptionalColumnIsKeptTest() throws IOException {
		// Given: neither creative nor CPA kept
		DashboardDatasetRow row = new DashboardDatasetRow(Map.of("Date", "2026-08-01", "Impressions", 100L));

		// When:
		byte[] bytes = workbookBytes(List.of(row), new DashboardColumnChoice(false, false), List.of());

		// Then: the two optional columns are absent, everything else stays
		List<String> headers = headerRow(bytes);
		assertThat(headers).contains("Date", "Impressions").doesNotContain("Creative", "CPA");
	}

	@Test
	void shouldRenderOptionalColumnsWhenTheDashboardKeepsThemTest() throws IOException {
		// Given: both optional columns kept
		DashboardDatasetRow row = new DashboardDatasetRow(Map.of("Creative", "Banner A"));

		// When:
		byte[] bytes = workbookBytes(List.of(row), new DashboardColumnChoice(true, true), List.of());

		// Then:
		List<String> headers = headerRow(bytes);
		assertThat(headers).contains("Creative", "CPA");
	}

	@Test
	void shouldArrangeColumnsByTheDashboardsSavedColumnOrderTest() throws IOException {
		// Given: a saved arrangement moving Impressions before Date
		DashboardDatasetRow row = new DashboardDatasetRow(Map.of());

		// When:
		byte[] bytes = workbookBytes(List.of(row), new DashboardColumnChoice(false, false), List.of("impressions", "date"));

		// Then: the requested pair leads, everything else follows in its own default order
		List<String> headers = headerRow(bytes);
		assertThat(headers.get(0)).isEqualTo("Impressions");
		assertThat(headers.get(1)).isEqualTo("Date");
	}

	@Test
	void shouldComputeCpaFromItsTwoHalvesTest() throws IOException {
		// Given: cost and conversions both present, conversions positive
		DashboardDatasetRow row =
				new DashboardDatasetRow(Map.of("CPA_Cost", 500.0, "CPA_Conversions", 25.0));

		// When:
		byte[] bytes = workbookBytes(List.of(row), new DashboardColumnChoice(false, true), List.of());

		// Then: 500 / 25 = 20
		Map<String, Double> values = dataRowValues(bytes);
		assertThat(values.get("CPA")).isEqualTo(20.0);
	}

	@Test
	void shouldLeaveCpaBlankWhenConversionsAreZeroOrAbsentTest() throws IOException {
		// Given: cost present, but nothing to divide it by
		DashboardDatasetRow row = new DashboardDatasetRow(Map.of("CPA_Cost", 500.0));

		// When:
		byte[] bytes = workbookBytes(List.of(row), new DashboardColumnChoice(false, true), List.of());

		// Then: no CPA cell was written at all - not even a zero
		Map<String, Double> values = dataRowValues(bytes);
		assertThat(values).doesNotContainKey("CPA");
	}

	@Test
	void shouldParseANumericStringValueTheSameAsANumberTest() throws IOException {
		// Given: a BigQuery driver value returned as a string rather than a native number
		DashboardDatasetRow row =
				new DashboardDatasetRow(Map.of("CPA_Cost", "100", "CPA_Conversions", "4"));

		// When:
		byte[] bytes = workbookBytes(List.of(row), new DashboardColumnChoice(false, true), List.of());

		// Then:
		Map<String, Double> values = dataRowValues(bytes);
		assertThat(values.get("CPA")).isEqualTo(25.0);
	}

	@Test
	void shouldLeaveACellBlankWhenTheRowHasNoValueForItTest() throws IOException {
		// Given: a row missing the Impressions field entirely
		DashboardDatasetRow row = new DashboardDatasetRow(Map.of("Date", "2026-08-01"));

		// When:
		byte[] bytes = workbookBytes(List.of(row), new DashboardColumnChoice(false, false), List.of());

		// Then:
		Map<String, Double> values = dataRowValues(bytes);
		assertThat(values).doesNotContainKey("Impressions");
	}

	/**
	 * Renders a workbook and returns its bytes.
	 *
	 * @param rows         the rows to render
	 * @param columnChoice which optional columns are kept
	 * @param columnOrder  the requested column order
	 * @return the workbook bytes
	 */
	private byte[] workbookBytes(
			List<DashboardDatasetRow> rows, DashboardColumnChoice columnChoice, List<String> columnOrder) {
		ByteArrayOutputStream out = new ByteArrayOutputStream();
		assembler.writeWorkbook(out, rows, columnChoice, columnOrder);
		return out.toByteArray();
	}

	/**
	 * Reads the header row's column labels.
	 *
	 * @param bytes the workbook bytes
	 * @return the header labels, in column order
	 */
	private List<String> headerRow(byte[] bytes) throws IOException {
		try (XSSFWorkbook workbook = new XSSFWorkbook(new ByteArrayInputStream(bytes))) {
			Row header = workbook.getSheetAt(0).getRow(0);
			return StreamSupport.stream(header.spliterator(), false)
					.map(Cell::getStringCellValue)
					.collect(Collectors.toList());
		}
	}

	/**
	 * Reads the first data row's numeric values, keyed by their column header.
	 *
	 * @param bytes the workbook bytes
	 * @return header label to numeric cell value; a header with no written cell is absent from the map
	 */
	private Map<String, Double> dataRowValues(byte[] bytes) throws IOException {
		try (XSSFWorkbook workbook = new XSSFWorkbook(new ByteArrayInputStream(bytes))) {
			List<String> headers = headerRow(bytes);
			Row data = workbook.getSheetAt(0).getRow(1);
			Map<String, Double> values = new LinkedHashMap<>();
			for (int i = 0; i < headers.size(); i++) {
				Cell cell = data.getCell(i);
				if (cell != null && cell.getCellType() == org.apache.poi.ss.usermodel.CellType.NUMERIC) {
					values.put(headers.get(i), cell.getNumericCellValue());
				}
			}
			return values;
		}
	}
}
