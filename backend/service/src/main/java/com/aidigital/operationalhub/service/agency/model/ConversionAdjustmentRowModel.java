package com.aidigital.operationalhub.service.agency.model;

/**
 * One adjustment row to write to the conversions adjustments table: the conversions figure a day's
 * line item should report for one conversion action, together with the full identity that action's row
 * is found by.
 *
 * <p>Two things separate this from {@link AdjustmentRowModel}, and both come from the grain rather than
 * from any decision of ours. A delivery row is one line item on one day; a conversions row is one line
 * item on one day <em>for one action</em>, so {@code conversionAction} and {@code conversionCategory} are
 * part of the identity here and have no counterpart there. And the table this is written to carries no
 * {@code CNB_*} columns at all - the view derives every one of them by splitting
 * {@code constructedName} - so the campaign a row belongs to is asserted by that name and by nothing
 * else, which is why the service checks it against the resolved campaign before writing.
 *
 * <p>Only {@code conversions} is carried, of the seven metrics the table can hold. The report shows that
 * one and no other, and a stored value nothing displays would read as an edit that silently did nothing.
 * The rest are left unwritten, which is not the same as zero: the view falls back to the mart's own
 * figure for any metric an adjustment row leaves null.
 *
 * @param date                the conversion date
 * @param platform            the DSP/ad-server platform
 * @param account             the platform account name
 * @param accountId           the platform account id
 * @param conversionAction    the advertiser's own name for what was counted
 * @param conversionCategory  the platform's classification of that action
 * @param constructedName     the level-1 constructed name, which also carries the campaign's identity
 * @param constructedId       the level-1 constructed id
 * @param constructedNameLvl2 the level-2 constructed name
 * @param constructedIdLvl2   the level-2 constructed id
 * @param constructedNameLvl3 the level-3 constructed name
 * @param constructedIdLvl3   the level-3 constructed id
 * @param conversions         the conversions figure this row should report
 * @param adjustedMetrics     marker of which metric names were changed (comma-joined)
 */
public record ConversionAdjustmentRowModel(
		String date, String platform, String account, String accountId,
		String conversionAction, String conversionCategory,
		String constructedName, String constructedId,
		String constructedNameLvl2, String constructedIdLvl2,
		String constructedNameLvl3, String constructedIdLvl3,
		Double conversions,
		String adjustedMetrics) {
}
