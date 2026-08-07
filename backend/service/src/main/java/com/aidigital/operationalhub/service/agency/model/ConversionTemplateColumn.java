package com.aidigital.operationalhub.service.agency.model;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

import java.util.Arrays;
import java.util.List;
import java.util.function.Function;
import java.util.stream.Stream;

/**
 * The columns of the conversions round-trip spreadsheet: their names, their order, which of them find a
 * row again on the way back, and where each one's value comes from.
 *
 * <p>One declaration because the file is written in one module and read in another. The workbook writer
 * needs the header and a value per column; the upload needs the subset that identifies a row. Those used to
 * be a {@code String[]} in the application module and a {@code List<String>} in the service module, kept in
 * step by a test that asserted one was a subset of the other - a test that could only fail after someone
 * had already made the mistake. Adding an identity column is now one entry here.
 *
 * <p>The level names follow {@link ReportRowModel}'s vocabulary rather than the view's own column names, so
 * a user reading the conversions template beside the delivery one sees the same three levels called the
 * same three things.
 */
@Getter
@RequiredArgsConstructor
public enum ConversionTemplateColumn {

	/**
	 * The conversion date.
	 */
	DATE("date", true, ConversionRowModel::date),

	/**
	 * The level-1 constructed id.
	 */
	LINE_ITEM_ID("line_item_id", true, ConversionRowModel::lineItemId),

	/**
	 * The level-2 constructed id.
	 */
	INSERTION_ORDER_ID("insertion_order_id", true, ConversionRowModel::insertionOrderId),

	/**
	 * The level-3 constructed id.
	 */
	CREATIVE_ID("creative_id", true, ConversionRowModel::creativeId),

	/**
	 * The advertiser's own name for what was counted.
	 */
	CONVERSION_ACTION("conversion_action", true, ConversionRowModel::conversionAction),

	/**
	 * The platform's classification of that action.
	 */
	CONVERSION_CATEGORY("conversion_category", true, ConversionRowModel::conversionCategory),

	/**
	 * The DSP/ad-server platform. Written so the user can see which row is which, not read back: the
	 * platform of a line item follows from the line item, and asking a spreadsheet to preserve it exactly
	 * would let a reformatted cell break a match that is otherwise unambiguous.
	 */
	PLATFORM("platform", false, ConversionRowModel::platform),

	/**
	 * The platform account name, written for readability only.
	 */
	ACCOUNT("account", false, ConversionRowModel::account),

	/**
	 * The platform account id, written for readability only.
	 */
	ACCOUNT_ID("account_id", false, ConversionRowModel::accountId),

	/**
	 * The level-1 constructed name, written for readability only.
	 */
	LINE_ITEM_NAME("line_item_name", false, ConversionRowModel::lineItemName),

	/**
	 * The level-2 constructed name, written for readability only.
	 */
	INSERTION_ORDER_NAME("insertion_order_name", false, ConversionRowModel::insertionOrderName),

	/**
	 * The level-3 constructed name, written for readability only.
	 */
	CREATIVE_NAME("creative_name", false, ConversionRowModel::creativeName);

	/**
	 * The one editable column, and the only one the upload reads a value from.
	 *
	 * <p>Not an enum constant because it is not an identity column: it is written as a number rather than
	 * text and has no place in a header of things that describe a row. Declared here so the whole header
	 * still comes from one file.
	 */
	public static final String CONVERSIONS = "conversions";

	private final String columnName;

	private final boolean partOfKey;

	private final Function<ConversionRowModel, String> value;

	/**
	 * The template's full header, in the order the workbook writes it: every identity column, then the
	 * editable one.
	 *
	 * @return the column names, in file order
	 */
	public static List<String> header() {
		return Stream.concat(Arrays.stream(values()).map(ConversionTemplateColumn::getColumnName),
						Stream.of(CONVERSIONS))
				.toList();
	}

	/**
	 * The columns that together find the conversions row an uploaded line refers to.
	 *
	 * @return the key column names, in key order
	 */
	public static List<String> keyColumns() {
		return Arrays.stream(values())
				.filter(ConversionTemplateColumn::isPartOfKey)
				.map(ConversionTemplateColumn::getColumnName)
				.toList();
	}
}
