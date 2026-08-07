package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.service.agency.model.ReportRowModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowTotalsModel;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.streaming.SXSSFWorkbook;
import org.springframework.stereotype.Component;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Renders {@link ReportRowModel}s as an .xlsx workbook for the report-rows "Download report" export.
 * Columns are selected by {@code ReportRowV1}'s field ids, but rendered with the same display labels the
 * Reporting table uses. This is a read-only, non-editable dump - unlike
 * {@link ReportRowXlsxAssembler}'s fixed, re-uploadable bulk-adjustment template, this assembler renders
 * the current view's own selected dimensions/metrics (including the derived cpm/cpc/cpv/ctr/avcr ratios) and is
 * never parsed back.
 *
 * <p>Two sheets: "Report" holds the rows, "Totals" the report's own full-dataset totals - see
 * {@link #writeTotalsSheet} for why the totals are not a row on the first sheet, the way the screen
 * shows them.
 */
@Component
public class ReportRowXlsxExportAssembler {

	// SXSSF keeps only this many rows in memory per sheet, flushing older rows to a temp file as new
	// ones are created - the fix for the whole-workbook-DOM memory cost of the plain XSSF writer.
	private static final int ROW_ACCESS_WINDOW_SIZE = 100;

	private static final String DATA_SHEET = "Report";
	private static final String TOTALS_SHEET = "Totals";
	private static final List<String> TOTALS_HEADERS = List.of("metric", "total", "basis");
	private static final List<String> LINE_ITEM_FIRST =
			List.of("Line item", "Insertion order", "Creative");
	private static final List<String> CAMPAIGN_FIRST_IO =
			List.of("Campaign", "Insertion order", "Creative");
	private static final List<String> CAMPAIGN_FIRST_AD =
			List.of("Campaign", "Ad set", "Ad");
	private static final List<String> AD_SET_FIRST_AD =
			List.of("Ad set", "Campaign", "Ad");
	private static final List<String> IO_FIRST =
			List.of("Insertion order", "Line item", "Creative");
	static final Map<String, List<String>> PLATFORM_LEVEL_TERMS = Map.ofEntries(
			Map.entry("dv_360_dlv", LINE_ITEM_FIRST),
			Map.entry("dv_360_jellyfish", LINE_ITEM_FIRST),
			Map.entry("TTD", List.of("Ad set", "Campaign", "Creative")),
			Map.entry("Spotify", CAMPAIGN_FIRST_AD),
			Map.entry("Google Ads", CAMPAIGN_FIRST_AD),
			Map.entry("Vistar", CAMPAIGN_FIRST_IO),
			Map.entry("Viant", CAMPAIGN_FIRST_IO),
			Map.entry("Facebook", AD_SET_FIRST_AD),
			Map.entry("Meta", AD_SET_FIRST_AD),
			Map.entry("Adtelligent", IO_FIRST),
			Map.entry("Amazon", IO_FIRST),
			Map.entry("TikTok", AD_SET_FIRST_AD),
			Map.entry("Xandr", LINE_ITEM_FIRST),
			Map.entry("Yahoo", LINE_ITEM_FIRST),
			Map.entry("Beeswax", LINE_ITEM_FIRST),
			Map.entry("Microsoft", CAMPAIGN_FIRST_AD),
			Map.entry("LinkedIn", List.of("Ad set", "Campaign", "Creative")));

	private static final String[] HEADERS = {
			"date", "platform", "account", "account_id", "line_item_name", "line_item_id",
			"insertion_order_name", "insertion_order_id", "campaign_constructed_name", "campaign_constructed_id",
			"agency_id", "client", "industry_code", "campaign_name", "channel", "tactic", "buying_model",
			"audience", "unique_line_item_id", "other", "geo", "creative_tag", "message", "keyword_group",
			"flight_identifier", "language", "impressions", "clicks", "spend", "starts", "first_quartiles",
			"midpoints", "third_quartiles", "completes", "conversions", "post_click_conversions",
			"post_view_conversions", "dynamic_cost", "link_clicks", "adjusted_metrics", "created_at",
			"created_by", "last_modified_at", "last_modified_by", "rate_type", "dynamic_rate",
			"avg_dynamic_rate_by_date_tactic", "line_item_description", "ivt"
	};

	private static final Set<String> EXPORTABLE_COLUMNS = Set.of(
			"date", "platform", "account", "account_id", "line_item_name", "line_item_id",
			"insertion_order_name", "insertion_order_id", "campaign_constructed_name", "campaign_constructed_id",
			"agency_id", "client", "industry_code", "campaign_name", "channel", "tactic", "buying_model",
			"audience", "unique_line_item_id", "other", "geo", "creative_tag", "message", "keyword_group",
			"flight_identifier", "language", "impressions", "clicks", "spend", "starts", "first_quartiles",
			"midpoints", "third_quartiles", "completes", "conversions", "post_click_conversions",
			"post_view_conversions", "dynamic_cost", "link_clicks", "adjusted_metrics", "created_at",
			"created_by", "last_modified_at", "last_modified_by", "rate_type", "dynamic_rate",
			"avg_dynamic_rate_by_date_tactic", "line_item_description", "cpm", "cpc", "cpv", "ctr", "avcr", "ivt");

	/**
	 * Renders the rows as an .xlsx workbook, restricted to the requested columns when present.
	 *
	 * @param rows    the rows to render, in the order given
	 * @param columns selected column ids; empty means the full raw export schema
	 * @param totals  the report's full-dataset totals, or {@code null} for no Totals sheet
	 * @return the workbook's bytes
	 */
	public byte[] toWorkbook(List<ReportRowModel> rows, List<String> columns, ReportRowTotalsModel totals) {
		ByteArrayOutputStream out = new ByteArrayOutputStream();
		writeWorkbook(out, rows, columns, totals);
		return out.toByteArray();
	}

	/**
	 * Convenience: renders the rows using the full raw export schema (no column selection, no totals).
	 *
	 * @param rows the rows to render, in the order given
	 * @return the workbook's bytes
	 */
	public byte[] toWorkbook(List<ReportRowModel> rows) {
		return toWorkbook(rows, List.of(), null);
	}

	/**
	 * Streams the rows as an .xlsx workbook directly into {@code out}, restricted to the requested
	 * columns when present. Uses a windowed {@link SXSSFWorkbook} so memory use stays bounded by
	 * {@link #ROW_ACCESS_WINDOW_SIZE} rows regardless of how many rows are rendered, rather than holding
	 * the whole workbook's cell graph in memory at once.
	 *
	 * @param out     the stream to write the workbook into; not closed by this method
	 * @param rows    the rows to render, in the order given
	 * @param columns selected column ids; empty means the full raw export schema
	 * @param totals  the report's full-dataset totals, or {@code null} for no Totals sheet
	 */
	public void writeWorkbook(
			OutputStream out, List<ReportRowModel> rows, List<String> columns, ReportRowTotalsModel totals) {
		List<String> headers = selectedHeaders(columns);
		List<String> levelTerms = resolveLevelTerms(rows);
		try (SXSSFWorkbook workbook = new SXSSFWorkbook(ROW_ACCESS_WINDOW_SIZE)) {
			Sheet sheet = workbook.createSheet(DATA_SHEET);
			writeHeader(sheet, displayHeaders(headers, levelTerms));
			int rowNum = 1;
			for (ReportRowModel row : rows) {
				writeRow(sheet, rowNum++, row, headers);
			}
			if (totals != null) {
				writeTotalsSheet(workbook.createSheet(TOTALS_SHEET), headers, levelTerms, totals);
			}
			workbook.write(out);
		} catch (IOException e) {
			throw new UncheckedIOException("Failed to render the export workbook", e);
		}
	}

	/**
	 * Writes the Totals sheet: one row per metric column on the data sheet, with the metric's name, its
	 * total over the whole filtered dataset, and how that total is arrived at.
	 *
	 * <p>Its own sheet rather than a total row on the data sheet, which is what the screen shows. A row
	 * wedged into the data rectangle is caught by every sort, filter and pivot applied afterwards and
	 * silently double-counted by any {@code SUM} over the column - the download exists to be worked with
	 * in Excel, so the table has to stay a clean rectangle. Metric columns only: there is no total for
	 * a date or a line-item name.
	 *
	 * <p>The basis column is here because of the question that prompted the sheet. Averaging an exported
	 * CPM column gives a different answer than the report does, and it is not a rounding difference: the
	 * report weights by delivery (total spend over total impressions), while an average over rows lets a
	 * line that served a hundred impressions count for as much as one that served ten million. Stating
	 * the basis beside the number says which question each answers.
	 *
	 * @param sheet   the sheet to write into
	 * @param headers the data sheet's column ids, in order
	 * @param levelTerms the resolved constructed-level terms, or {@code null} when ambiguous
	 * @param totals  the report's full-dataset totals
	 */
	void writeTotalsSheet(
			Sheet sheet, List<String> headers, List<String> levelTerms, ReportRowTotalsModel totals) {
		writeHeader(sheet, TOTALS_HEADERS);
		int rowNum = 1;
		for (String header : headers) {
			Double total = totalFor(header, totals);
			if (total == null) {
				continue;
			}
			Row row = sheet.createRow(rowNum++);
			row.createCell(0).setCellValue(displayHeader(header, levelTerms));
			row.createCell(1).setCellValue(total);
			row.createCell(2).setCellValue(basisFor(header));
		}
	}

	/**
	 * Resolves one metric's total by export column id.
	 *
	 * @param header the column id
	 * @param totals the report's full-dataset totals
	 * @return the total, or {@code null} for a column that has none
	 */
	Double totalFor(String header, ReportRowTotalsModel totals) {
		return switch (header) {
			case "impressions" -> asDouble(totals.impressions());
			case "clicks" -> asDouble(totals.clicks());
			case "spend" -> totals.spend();
			case "starts" -> asDouble(totals.starts());
			case "first_quartiles" -> asDouble(totals.firstQuartiles());
			case "midpoints" -> asDouble(totals.midpoints());
			case "third_quartiles" -> asDouble(totals.thirdQuartiles());
			case "completes" -> asDouble(totals.completes());
			case "conversions" -> totals.conversions();
			case "post_click_conversions" -> totals.postClickConversions();
			case "post_view_conversions" -> totals.postViewConversions();
			case "dynamic_cost" -> totals.dynamicCost();
			case "link_clicks" -> asDouble(totals.linkClicks());
			case "dynamic_rate" -> totals.dynamicRate();
			case "ivt" -> totals.ivt();
			case "cpm" -> totals.cpm();
			case "cpc" -> totals.cpc();
			case "cpv" -> totals.cpv();
			case "ctr" -> totals.ctr();
			case "avcr" -> totals.avcr();
			default -> null;
		};
	}

	/**
	 * How a metric's total is arrived at, in the report's own terms.
	 *
	 * @param header the column id
	 * @return the basis, phrased for a reader of the workbook
	 */
	String basisFor(String header) {
		return switch (header) {
			case "cpm" -> "total client cost / total impressions x 1000";
			case "cpc" -> "total spend / total clicks";
			case "cpv" -> "total spend / total starts (a view is a start)";
			case "ctr" -> "total clicks / total impressions x 100";
			case "avcr" -> "total completes / total impressions x 100";
			case "dynamic_rate" -> "total dynamic cost / total billable units";
			default -> "sum of every matching row";
		};
	}

	/**
	 * Widens a counted total to the numeric type a cell takes.
	 *
	 * @param value the counted total, may be {@code null}
	 * @return the same value as a Double, or {@code null}
	 */
	Double asDouble(Long value) {
		return value == null ? null : value.doubleValue();
	}

	/**
	 * Writes the header row of the selected column names.
	 *
	 * @param sheet   the sheet to write into
	 * @param headers the column ids to render, in order
	 */
	void writeHeader(Sheet sheet, List<String> headers) {
		Row header = sheet.createRow(0);
		for (int i = 0; i < headers.size(); i++) {
			header.createCell(i).setCellValue(headers.get(i));
		}
	}

	/**
	 * Writes one data row: each selected header cell resolved from the given report row, numeric for
	 * metric/derived-ratio columns and text for identity/audit columns, blank when the value is null.
	 *
	 * @param sheet   the sheet to write into
	 * @param rowNum  the 0-based row index to create
	 * @param row     the report row to render
	 * @param headers the column ids to render, in order
	 */
	void writeRow(Sheet sheet, int rowNum, ReportRowModel row, List<String> headers) {
		Row sheetRow = sheet.createRow(rowNum);
		for (int i = 0; i < headers.size(); i++) {
			Object value = valueFor(headers.get(i), row);
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
	 * Normalizes selected columns while preserving caller order and removing duplicates.
	 *
	 * @param columns selected column ids
	 * @return selected exportable columns, or the full raw export schema when none were requested
	 */
	List<String> selectedHeaders(List<String> columns) {
		if (columns == null || columns.isEmpty()) {
			return List.of(HEADERS);
		}
		LinkedHashSet<String> selected = columns.stream()
				.filter(EXPORTABLE_COLUMNS::contains)
				.collect(Collectors.toCollection(LinkedHashSet::new));
		return selected.isEmpty() ? List.of() : List.copyOf(selected);
	}

	/**
	 * Resolves the Excel labels for selected column ids.
	 *
	 * @param headers    selected column ids
	 * @param levelTerms resolved constructed-level terms, or {@code null} when ambiguous
	 * @return display labels in the same order
	 */
	List<String> displayHeaders(List<String> headers, List<String> levelTerms) {
		return headers.stream().map(header -> displayHeader(header, levelTerms)).toList();
	}

	/**
	 * Resolves one Excel label from a report column id.
	 *
	 * @param header     selected column id
	 * @param levelTerms resolved constructed-level terms, or {@code null} when ambiguous
	 * @return display label matching the Reporting table vocabulary
	 */
	String displayHeader(String header, List<String> levelTerms) {
		return switch (header) {
			case "date" -> "Date";
			case "platform" -> "Platform";
			case "account" -> "Account";
			case "account_id" -> "Account id";
			case "line_item_name" -> levelLabel(levelTerms, 0, false, "Constructed name L1");
			case "line_item_id" -> levelLabel(levelTerms, 0, true, "Constructed id L1");
			case "insertion_order_name" -> levelLabel(levelTerms, 1, false, "Constructed name L2");
			case "insertion_order_id" -> levelLabel(levelTerms, 1, true, "Constructed id L2");
			case "campaign_constructed_name" -> levelLabel(levelTerms, 2, false, "Constructed name L3");
			case "campaign_constructed_id" -> levelLabel(levelTerms, 2, true, "Constructed id L3");
			case "agency_id" -> "Agency id";
			case "client" -> "Client";
			case "industry_code" -> "Industry code";
			case "campaign_name" -> "Campaign";
			case "channel" -> "Channel";
			case "tactic" -> "Tactic";
			case "buying_model" -> "Buying model";
			case "audience" -> "Audience";
			case "unique_line_item_id" -> "Unique line item id";
			case "other" -> "Other";
			case "geo" -> "Geo";
			case "creative_tag" -> "Creative tag";
			case "message" -> "Message";
			case "keyword_group" -> "Keyword group";
			case "flight_identifier" -> "Flight identifier";
			case "language" -> "Language";
			case "impressions" -> "Impressions";
			case "clicks" -> "Clicks";
			case "spend" -> "Client Cost";
			case "starts" -> "Starts";
			case "first_quartiles" -> "First quartiles";
			case "midpoints" -> "Midpoints";
			case "third_quartiles" -> "Third quartiles";
			case "completes" -> "Completions";
			case "conversions" -> "Conversions";
			case "post_click_conversions" -> "Post-click conversions";
			case "post_view_conversions" -> "Post-view conversions";
			case "dynamic_cost" -> "Dynamic cost";
			case "link_clicks" -> "Link clicks";
			case "adjusted_metrics" -> "Adjusted metrics";
			case "created_at" -> "Created at";
			case "created_by" -> "Created by";
			case "last_modified_at" -> "Last modified at";
			case "last_modified_by" -> "Last modified by";
			case "rate_type" -> "Rate type";
			case "dynamic_rate" -> "Dynamic rate";
			case "avg_dynamic_rate_by_date_tactic" -> "Avg dynamic rate (by date/tactic)";
			case "line_item_description" -> "Description";
			case "cpm" -> "Client CPM";
			case "cpc" -> "CPC";
			case "cpv" -> "CPV";
			case "ctr" -> "CTR";
			case "avcr" -> "AVCR";
			case "ivt" -> "IVT";
			default -> header;
		};
	}

	/**
	 * Resolves constructed-level terms from the platforms present in the exported rows. If the rows span
	 * platforms that disagree, labels stay neutral, exactly as the Reporting table does.
	 *
	 * @param rows exported rows
	 * @return resolved level terms, or {@code null}
	 */
	List<String> resolveLevelTerms(List<ReportRowModel> rows) {
		List<String> resolved = null;
		for (ReportRowModel row : rows) {
			if (row.platform() == null) {
				return null;
			}
			List<String> terms = PLATFORM_LEVEL_TERMS.get(row.platform());
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

	String levelLabel(List<String> terms, int level, boolean id, String fallback) {
		if (terms == null) {
			return fallback;
		}
		String name = level >= 0 && level < terms.size() ? terms.get(level) : null;
		return name == null ? fallback : name + (id ? " id" : " name");
	}

	/**
	 * Resolves one row value by report/export column id.
	 *
	 * @param header the column id
	 * @param row    the row
	 * @return the raw value for export rendering
	 */
	Object valueFor(String header, ReportRowModel row) {
		return switch (header) {
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
			case "client" -> row.client();
			case "industry_code" -> row.industryCode();
			case "campaign_name" -> row.campaignName();
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
			case "conversions" -> row.conversions();
			case "post_click_conversions" -> row.postClickConversions();
			case "post_view_conversions" -> row.postViewConversions();
			case "dynamic_cost" -> row.dynamicCost();
			case "link_clicks" -> row.linkClicks();
			case "adjusted_metrics" -> row.adjustedMetrics();
			case "created_at" -> row.createdAt();
			case "created_by" -> row.createdBy();
			case "last_modified_at" -> row.lastModifiedAt();
			case "last_modified_by" -> row.lastModifiedBy();
			case "rate_type" -> row.rateType();
			case "dynamic_rate" -> row.dynamicRate();
			case "avg_dynamic_rate_by_date_tactic" -> row.avgDynamicRateByDateTactic();
			case "line_item_description" -> row.lineItemDescription();
			case "ivt" -> row.ivt();
			// Read off the row, not recomputed here. Each ratio is gated to the channels it means
			// anything on, and a second implementation of that gating - in a third language - is how the
			// export came to disagree with the screen it was exported from.
			case "cpm" -> row.cpm();
			case "cpc" -> row.cpc();
			case "cpv" -> row.cpv();
			case "ctr" -> row.ctr();
			case "avcr" -> row.avcr();
			default -> null;
		};
	}

}
