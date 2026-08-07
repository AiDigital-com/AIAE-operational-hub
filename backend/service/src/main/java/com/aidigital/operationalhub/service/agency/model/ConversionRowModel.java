package com.aidigital.operationalhub.service.agency.model;

/**
 * One conversions row as the conversions view reports it: a day, a line item, and the figure counted for
 * one conversion action.
 *
 * <p>The read counterpart of {@link ConversionAdjustmentRowModel}, and deliberately the same field set.
 * A row is downloaded into the conversions template, edited, and uploaded back, and the identity has to
 * survive that trip intact - it is the only thing the write side can find the row by again.
 *
 * <p>The level names follow {@link ReportRowModel}'s vocabulary rather than the view's own column names,
 * so a user reading the conversions template beside the delivery one sees the same three levels called
 * the same three things.
 *
 * @param date               the conversion date
 * @param platform           the DSP/ad-server platform
 * @param account            the platform account name
 * @param accountId          the platform account id
 * @param conversionAction   the advertiser's own name for what was counted
 * @param conversionCategory the platform's classification of that action
 * @param lineItemName       the level-1 constructed name
 * @param lineItemId         the level-1 constructed id
 * @param insertionOrderName the level-2 constructed name
 * @param insertionOrderId   the level-2 constructed id
 * @param creativeName       the level-3 constructed name
 * @param creativeId         the level-3 constructed id
 * @param conversions        the conversions figure reported for this action
 */
public record ConversionRowModel(
		String date, String platform, String account, String accountId,
		String conversionAction, String conversionCategory,
		String lineItemName, String lineItemId,
		String insertionOrderName, String insertionOrderId,
		String creativeName, String creativeId,
		Double conversions) {
}
