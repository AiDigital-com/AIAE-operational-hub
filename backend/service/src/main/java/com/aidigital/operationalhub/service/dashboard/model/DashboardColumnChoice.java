package com.aidigital.operationalhub.service.dashboard.model;

/**
 * Which of a Basic dashboard's optional columns are kept.
 *
 * <p>Two, today, and both named rather than held in a list: the query has to ask about each one separately
 * anyway, and a list would let a typo pass as a switched-off column.
 *
 * @param creative whether the creative (level-3) breakdown is kept
 * @param cpa      whether the CPA helper columns carry values
 */
public record DashboardColumnChoice(boolean creative, boolean cpa) {

	/** Id of the creative column, as the contract and the stored selection spell it. */
	public static final String CREATIVE = "creative";

	/** Id of the CPA column, as the contract and the stored selection spell it. */
	public static final String CPA = "cpa";
}
