package com.aidigital.operationalhub.externalservices.pacing.model;

/**
 * One sheet name that no rule routed, and how much of the file it carries.
 *
 * <p>The row count travels with the name on purpose: it is what tells the model - and the person
 * checking its answer - whether a name is worth attention or is one stray row.
 *
 * @param value the name as it appears in the sheet
 * @param rows  how many rows carry it
 */
public record PacingDimSourceUnboundName(
		String value,
		int rows) {
}
