package com.aidigital.operationalhub.service.agency.model;

/**
 * Names one report row, so the conversions behind its Conversions cell can be read at their own
 * per-action grain.
 *
 * <p>The three names are exactly what the report joins conversions on - date, level-1 name and level-3
 * name - because the breakdown has to be the rows that produced the cell, not rows that merely resemble
 * them. The channel comes along because it decides whether level 3 narrows the match at all: on channels
 * that report conversions against the campaign rather than the creative, the report drops level 3 from
 * the join, and a breakdown that kept it would show a fraction of the figure above it.
 *
 * @param date           the report row's date, as the mart stores it
 * @param levelOneName   the report row's level-1 constructed name
 * @param levelThreeName the report row's level-3 constructed name, may be {@code null}
 * @param channel        the report row's channel, may be {@code null}
 */
public record ConversionBreakdownQuery(
		String date, String levelOneName, String levelThreeName, String channel) {
}
