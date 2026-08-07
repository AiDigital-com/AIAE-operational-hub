package com.aidigital.operationalhub.service.agency.model;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * What identifies one report row to a bulk-adjustment round trip.
 *
 * <p>The workbook carries a hidden {@link #WORKBOOK_COLUMN} value generated from the row's editable identity.
 * That is the primary key for upload matching: users can keep only modified rows, reorder visible columns, or
 * accidentally touch a name cell without making the row impossible to match. If the hidden column is missing,
 * the same key can still be rebuilt from the visible identity columns.
 *
 * <p>A key of just date and level-1 id is not an identity. One line item runs several creatives, so a single
 * day and line item are several report rows, and the upload used to refuse them all with <em>matches more than
 * one report row</em>. The same edit made in the table worked, because there the user pointed at one concrete
 * row.
 *
 * <p>The digest is deliberately not reversible: it is only a correlation token for this workbook round trip,
 * not another public data column.
 *
 * @param encoded the deterministic row identity token
 */
public record ReportRowKey(String encoded) {

	private static final byte NULL_MARKER = 1;

	private static final byte VALUE_MARKER = 2;

	/**
	 * Hidden workbook column carrying the generated row identity.
	 */
	public static final String WORKBOOK_COLUMN = "_row_key";

	/**
	 * Hidden workbook column carrying the original delivery date used to bound the baseline lookup.
	 */
	public static final String WORKBOOK_SOURCE_DATE_COLUMN = "_source_date";

	/**
	 * Hidden workbook column carrying the canonical level-1 {@code constructed_id} used to bound the
	 * baseline lookup. Display labels for constructed levels vary by platform and must not decide this id.
	 */
	public static final String WORKBOOK_SOURCE_CONSTRUCTED_ID_COLUMN = "_source_constructed_id";

	/**
	 * Prefix for hidden workbook columns carrying the metric values as they were when the template was
	 * downloaded. Upload diffing uses them to detect user edits without mistaking later mart refreshes for
	 * edited cells.
	 */
	public static final String ORIGINAL_METRIC_COLUMN_PREFIX = "_original_";

	/**
	 * Sentinel written into hidden original-value columns when the downloaded metric was blank. Hidden
	 * columns need a real cell value so upload diffing can distinguish "downloaded blank" from "old
	 * template without original-value metadata".
	 */
	public static final String ORIGINAL_NULL_VALUE = "__NULL__";

	/**
	 * Visible columns that can rebuild the row key when the hidden workbook key was removed.
	 */
	public static final List<String> COLUMNS = List.of(
			"date", "platform", "account", "account_id",
			"line_item_name", "line_item_id", "insertion_order_name", "insertion_order_id",
			"campaign_constructed_name", "campaign_constructed_id", "agency_id", "industry_code",
			"channel", "tactic", "buying_model", "audience", "unique_line_item_id", "other",
			"geo", "creative_tag", "message", "keyword_group", "flight_identifier", "language");

	/**
	 * The key of a report row as the mart reports it.
	 *
	 * @param row the report row
	 * @return its key
	 */
	public static ReportRowKey of(ReportRowModel row) {
		return new ReportRowKey(digest(Arrays.asList(
				normalize(row.date()),
				normalize(row.platform()),
				normalize(row.account()),
				normalize(row.accountId()),
				normalize(row.lineItemName()),
				normalize(row.lineItemId()),
				normalize(row.insertionOrderName()),
				normalize(row.insertionOrderId()),
				normalize(row.campaignConstructedName()),
				normalize(row.campaignConstructedId()),
				normalize(row.agencyId()),
				normalize(row.industryCode()),
				normalize(row.channel()),
				normalize(row.tactic()),
				normalize(row.buyingModel()),
				normalize(row.audience()),
				normalize(row.uniqueLineItemId()),
				normalize(row.other()),
				normalize(row.geo()),
				normalize(row.creativeTag()),
				normalize(row.message()),
				normalize(row.keywordGroup()),
				normalize(row.flightIdentifier()),
				normalize(row.language()))));
	}

	/**
	 * The key an uploaded spreadsheet row refers to, read from its cells.
	 *
	 * @param cells the row's cell values, keyed by column name
	 * @return the key the row names
	 */
	public static ReportRowKey fromCells(Map<String, String> cells) {
		String workbookKey = normalize(cells.get(WORKBOOK_COLUMN));
		if (workbookKey != null) {
			return new ReportRowKey(workbookKey);
		}
		return new ReportRowKey(digest(COLUMNS.stream()
				.map(column -> normalize(cells.get(column)))
				.toList()));
	}

	/**
	 * Hidden workbook column name that stores one metric's downloaded value.
	 *
	 * @param metricColumn the canonical metric column id
	 * @return the hidden original-value column id
	 */
	public static String originalMetricColumn(String metricColumn) {
		return ORIGINAL_METRIC_COLUMN_PREFIX + metricColumn;
	}

	/**
	 * Which key columns the sheet carried no value for.
	 *
	 * <p>A report grouped coarser than the raw grain leaves the columns it did not group by empty, and a
	 * sheet downloaded from it cannot name a single row. Reported as the columns to add rather than as a
	 * failed match, because that is the difference between a fixable download and a mystery.
	 *
	 * @param cells the row's cell values, keyed by column name
	 * @return the missing column names, in sheet order; empty when the row names a key
	 */
	public static List<String> missingColumns(Map<String, String> cells) {
		if (normalize(cells.get(WORKBOOK_COLUMN)) != null) {
			List<String> missing = new ArrayList<>();
			if (sourceDate(cells) == null) {
				missing.add("date");
			}
			if (sourceConstructedIds(cells).isEmpty()) {
				missing.add("line_item_id");
			}
			return missing;
		}
		List<String> missing = new ArrayList<>();
		for (String column : COLUMNS) {
			if (normalize(cells.get(column)) == null) {
				missing.add(column);
			}
		}
		return missing;
	}

	/**
	 * Returns the original date that should bound an upload's baseline read. Current templates carry it
	 * separately so changing a visible identity cell cannot make the original row disappear before key
	 * matching; templates created before that metadata use the visible date.
	 *
	 * @param cells workbook row cells
	 * @return the original date, or {@code null}
	 */
	public static String sourceDate(Map<String, String> cells) {
		String sourceDate = normalize(cells.get(WORKBOOK_SOURCE_DATE_COLUMN));
		return sourceDate == null ? normalize(cells.get("date")) : sourceDate;
	}

	/**
	 * Returns candidate canonical level-1 ids that should bound an upload's baseline read. Current
	 * templates carry the exact id in hidden metadata. For already-downloaded templates, every visible
	 * constructed-level id is included because platform-specific labels can swap their canonical fields
	 * during parsing; the row key still performs the exact match afterward.
	 *
	 * @param cells workbook row cells
	 * @return one exact source id for current templates, or the distinct visible candidates otherwise
	 */
	public static List<String> sourceConstructedIds(Map<String, String> cells) {
		String sourceId = normalize(cells.get(WORKBOOK_SOURCE_CONSTRUCTED_ID_COLUMN));
		if (sourceId != null) {
			return List.of(sourceId);
		}
		return List.of("line_item_id", "insertion_order_id", "campaign_constructed_id").stream()
				.map(cells::get)
				.map(ReportRowKey::normalize)
				.filter(value -> value != null)
				.distinct()
				.toList();
	}

	/**
	 * Normalizes one component so both sides of the round trip agree: surrounding whitespace is dropped and
	 * a value with nothing left in it becomes {@code null}.
	 *
	 * <p>Case is left alone. These are platform-issued ids, where two values differing only in case are two
	 * different things.
	 *
	 * @param value the raw component value, may be {@code null}
	 * @return the trimmed value, or {@code null} when it carries nothing
	 */
	static String normalize(String value) {
		if (value == null) {
			return null;
		}
		String trimmed = value.trim();
		return trimmed.isEmpty() ? null : trimmed;
	}

	private static String digest(List<String> values) {
		try {
			MessageDigest digest = MessageDigest.getInstance("SHA-256");
			for (String value : values) {
				if (value == null) {
					digest.update(NULL_MARKER);
				} else {
					byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
					digest.update(VALUE_MARKER);
					digest.update(ByteBuffer.allocate(Integer.BYTES).putInt(bytes.length).array());
					digest.update(bytes);
				}
			}
			return bytesToHex(digest.digest());
		} catch (NoSuchAlgorithmException ex) {
			throw new IllegalStateException("SHA-256 is not available", ex);
		}
	}

	private static String bytesToHex(byte[] bytes) {
		StringBuilder hex = new StringBuilder(bytes.length * 2);
		for (byte value : bytes) {
			hex.append(Character.forDigit((value >> 4) & 0xF, 16));
			hex.append(Character.forDigit(value & 0xF, 16));
		}
		return hex.toString();
	}
}
