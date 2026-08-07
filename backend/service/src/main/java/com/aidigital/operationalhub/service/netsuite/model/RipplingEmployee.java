package com.aidigital.operationalhub.service.netsuite.model;

/**
 * A single active employee row read from the Rippling employees BigQuery table.
 *
 * @param name       the employee's display name
 * @param department the employee's department
 * @param workEmail  the employee's work email, used to match the Hub user
 * @param teams      the employee's comma-separated {@code teams} string (team/pod/grade-cohort tokens,
 *                   plus noise), parsed by {@code TeamsStringParser}
 * @param title      the employee's job title, classified by {@code TitleClassifier} into an
 *                   organizational role and grade
 * @param manager    the employee's manager, as a full display name (not an email); used to walk the
 *                   manager chain to the nearest Team Lead
 */
public record RipplingEmployee(
		String name, String department, String workEmail, String teams, String title, String manager) {

}
