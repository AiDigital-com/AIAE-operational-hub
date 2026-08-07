package com.aidigital.operationalhub.service.agency.model;

import java.util.Map;

/**
 * What identifies one conversions row to the round trip: a day, the three level ids, and the action with
 * its category.
 *
 * <p>A type rather than a {@code List<String>} for two reasons, and the second one is the important one.
 * The components are named, so nothing has to remember that position three is the level-3 id. And both
 * sides of the round trip - the rows read from the mart and the rows read back out of the spreadsheet -
 * are built through the factories here, so they cannot normalize differently or order differently. They
 * used to be two separate methods that happened to agree, and when they stopped agreeing the whole upload
 * was rejected with a message that pointed at the wrong thing.
 *
 * <p>Note this is not the mart's own twelve-column natural key (see
 * {@code BigQueryConversionsViewColumns.NATURAL_KEY}), which is what a write is deleted and inserted by.
 * This is the narrower key a spreadsheet is matched by: ids and the action, without the platform, account
 * or level names, which follow from the ids and would only add cells a user could accidentally reformat.
 *
 * @param date               the conversion date
 * @param lineItemId         the level-1 constructed id
 * @param insertionOrderId   the level-2 constructed id
 * @param creativeId         the level-3 constructed id
 * @param conversionAction   the advertiser's own name for what was counted
 * @param conversionCategory the platform's classification of that action
 */
public record ConversionKey(
		String date, String lineItemId, String insertionOrderId, String creativeId,
		String conversionAction, String conversionCategory) {

	/**
	 * The key of a conversions row as the mart reports it.
	 *
	 * @param row the conversions row
	 * @return its key
	 */
	public static ConversionKey of(ConversionRowModel row) {
		return new ConversionKey(
				normalize(row.date()),
				normalize(row.lineItemId()),
				normalize(row.insertionOrderId()),
				normalize(row.creativeId()),
				normalize(row.conversionAction()),
				normalize(row.conversionCategory()));
	}

	/**
	 * The key an uploaded spreadsheet row refers to, read from its cells.
	 *
	 * @param cells the row's cell values, keyed by column name
	 * @return the key the row names
	 */
	public static ConversionKey fromCells(Map<String, String> cells) {
		return new ConversionKey(
				normalize(cells.get(ConversionTemplateColumn.DATE.getColumnName())),
				normalize(cells.get(ConversionTemplateColumn.LINE_ITEM_ID.getColumnName())),
				normalize(cells.get(ConversionTemplateColumn.INSERTION_ORDER_ID.getColumnName())),
				normalize(cells.get(ConversionTemplateColumn.CREATIVE_ID.getColumnName())),
				normalize(cells.get(ConversionTemplateColumn.CONVERSION_ACTION.getColumnName())),
				normalize(cells.get(ConversionTemplateColumn.CONVERSION_CATEGORY.getColumnName())));
	}

	/**
	 * Normalizes one component so the two sides of the round trip agree: surrounding whitespace is dropped,
	 * and a value with nothing left in it becomes {@code null}.
	 *
	 * <p>Both halves are about the same failure - a key that can never match, and an upload rejected
	 * wholesale for a reason the user cannot see. The spreadsheet reader trims every cell and omits an empty
	 * one entirely, so a mart value of {@code "LI-1 "} comes back as {@code "LI-1"} and a value of
	 * {@code ""} comes back absent; compared against the raw mart value, neither equals what it came from.
	 * These marts are known to disagree about stray spaces and empty strings - it is why the report's own
	 * join compares level names through {@code LOWER(TRIM(...))}.
	 *
	 * <p>Case is deliberately left alone. These are ids and platform-issued action names, where two values
	 * differing only in case are two different things, and folding them would merge rows the mart keeps
	 * apart.
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
}
