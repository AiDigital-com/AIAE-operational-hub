package com.aidigital.operationalhub.service.agency.bigquery.model;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * How a campaign's flight dates are read and ordered by.
 *
 * <p>A campaign has no dates of its own in the mart - it is a group of insertion-order lines, so its flight
 * is the earliest start and the latest end among them. Both are aggregates, which is why they cannot be
 * ordered by as plain columns.
 *
 * <p>Lives beside {@link BqSql} rather than in the service because the aggregate wrappers it needs are
 * package-private there, deliberately: the builder's {@code selectMin}/{@code selectMax} are the intended
 * way to reach them, and an {@code ORDER BY} is the one place that has neither.
 */
public final class CampaignFlightSql {

	/**
	 * How far apart the three phases are kept in {@link #phaseOrder}.
	 *
	 * <p>The order is one ascending number, because the builder carries a single {@code ORDER BY}
	 * expression. Phase picks the band, days-from-now picks the place within it. A million days is 2700
	 * years, so no real flight can reach out of its own band and overtake the phase above.
	 */
	private static final int PHASE_STRIDE = 1_000_000;

	/**
	 * The campaign's start - the earliest start among its lines.
	 *
	 * @param column the unquoted line-level start-date column
	 * @return the rendered aggregate, read as a date
	 */
	public static String startDate(String column) {
		return BqSql.safeCastDate(BqSql.min(column));
	}

	/**
	 * The campaign's end - the latest end among its lines.
	 *
	 * @param column the unquoted line-level end-date column
	 * @return the rendered aggregate, read as a date
	 */
	public static String endDate(String column) {
		return BqSql.safeCastDate(BqSql.max(column));
	}

	/**
	 * Orders campaigns by what is happening to them: live first, then upcoming, then finished.
	 *
	 * <p>The phase is worked out from the flight dates rather than read from the status column, because the
	 * statuses arriving from NetSuite are not always right and a wrong one would file a running campaign
	 * under Finished. Dates cannot be wrong in that way - they are what "running" means.
	 *
	 * <p>Within a band the key is days from today, ascending, which reads as the same idea in all three:
	 * a live campaign ending soonest needs attention first, an upcoming one starting soonest is next to
	 * plan, and among finished ones the one that just ended is the one still being reconciled.
	 *
	 * <p>A campaign whose dates do not parse sorts last: the {@code CASE} falls through to the live band
	 * with a {@code NULL} key, and the builder appends {@code NULLS LAST}.
	 *
	 * @param startColumn the unquoted line-level start-date column
	 * @param endColumn   the unquoted line-level end-date column
	 * @return the rendered {@code ORDER BY} expression, ascending
	 */
	public static String phaseOrder(String startColumn, String endColumn) {
		String today = BqSql.currentDate();
		String start = startDate(startColumn);
		String end = endDate(endColumn);
		Map<String, String> byPhase = new LinkedHashMap<>();
		byPhase.put(end + " < " + today, band(2, BqSql.daysBetween(today, end)));
		byPhase.put(start + " > " + today, band(1, BqSql.daysBetween(start, today)));
		return BqSql.caseWhen(byPhase, BqSql.daysBetween(end, today));
	}

	/**
	 * Places a days-from-now key inside its phase's band.
	 *
	 * @param phase      the phase's zero-based rank
	 * @param daysFromNow the rendered day-count expression
	 * @return the rendered banded key
	 */
	static String band(int phase, String daysFromNow) {
		return "(" + phase * PHASE_STRIDE + " + " + daysFromNow + ")";
	}

	private CampaignFlightSql() {
	}
}
