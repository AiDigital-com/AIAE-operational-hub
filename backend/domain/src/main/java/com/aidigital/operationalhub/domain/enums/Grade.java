package com.aidigital.operationalhub.domain.enums;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * Canonical seniority grade dictionary codes, persisted on {@code hub_users.grade}.
 *
 * <p>Values are derived from the Rippling {@code title} column by
 * {@code com.aidigital.operationalhub.service.netsuite.org.TitleClassifier}, cross-checked against the
 * {@code teams} grade-cohort token. Values are persisted as TEXT; this enum centralizes the code and
 * display label without using PostgreSQL enum types.
 */
@Getter
@RequiredArgsConstructor
public enum Grade {

	/**
	 * Entry-level, pre-junior grade ({@code "MPO Trainees"} / title contains {@code "Trainee"}).
	 */
	TRAINEE("TRAINEE", "Trainee"),

	/**
	 * Junior individual contributor grade.
	 */
	JUNIOR("JUNIOR", "Junior"),

	/**
	 * Middle (default) individual contributor grade.
	 */
	MIDDLE("MIDDLE", "Middle"),

	/**
	 * Senior individual contributor grade.
	 */
	SENIOR("SENIOR", "Senior"),

	/**
	 * Team Lead grade; the employee heads a team.
	 */
	TEAM_LEAD("TEAM_LEAD", "Team Lead"),

	/**
	 * Director grade; the employee heads a department, with no team of their own.
	 */
	DIRECTOR("DIRECTOR", "Director"),

	/**
	 * Senior Director grade; the employee heads a department, with no team of their own.
	 */
	SENIOR_DIRECTOR("SENIOR_DIRECTOR", "Senior Director"),

	/**
	 * The title matched no known pattern; the grade could not be classified.
	 */
	UNKNOWN("UNKNOWN", "Unknown");

	private final String code;
	private final String displayName;
}
