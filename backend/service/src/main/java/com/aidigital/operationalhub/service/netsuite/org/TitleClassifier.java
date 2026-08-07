package com.aidigital.operationalhub.service.netsuite.org;

import com.aidigital.operationalhub.domain.enums.Grade;
import org.springframework.stereotype.Component;

/**
 * Classifies a Rippling {@code title} string into an {@link OrgRole} and {@link Grade}.
 *
 * <p>Titles are trimmed (trailing whitespace occurs in the source data) and matched case-insensitively
 * against a fixed precedence — Senior Director, Director, Team Lead, Trainee, Senior Manager, Junior
 * Manager, plain Manager — mirroring {@code team-by-team-lead-PLAN.md} §3 S1. A title matching none of
 * these is classified {@link OrgRole#MEMBER} / {@link Grade#UNKNOWN} and flagged as unrecognized.
 */
@Component
public class TitleClassifier {

	private static final String SENIOR_DIRECTOR_MARKER = "senior director";
	private static final String DIRECTOR_MARKER = "director";
	private static final String TEAM_LEAD_MARKER = "team lead";
	private static final String TRAINEE_MARKER = "trainee";
	private static final String SENIOR_MARKER = "senior";
	private static final String JUNIOR_MARKER = "junior";
	private static final String MANAGER_MARKER = "manager";

	/**
	 * Classifies the given title.
	 *
	 * @param title the raw {@code title} value, possibly {@code null} or blank
	 * @return the classification; {@link OrgRole#MEMBER} / {@link Grade#UNKNOWN} with
	 * {@code titleUnrecognized=true} when the title matches no known pattern
	 */
	public TitleClassification classify(String title) {
		String normalized = title == null ? "" : title.trim().toLowerCase();
		if (normalized.contains(SENIOR_DIRECTOR_MARKER)) {
			return new TitleClassification(OrgRole.DIRECTOR, Grade.SENIOR_DIRECTOR, false);
		}
		if (normalized.contains(DIRECTOR_MARKER)) {
			return new TitleClassification(OrgRole.DIRECTOR, Grade.DIRECTOR, false);
		}
		if (normalized.contains(TEAM_LEAD_MARKER)) {
			return new TitleClassification(OrgRole.TEAM_LEAD, Grade.TEAM_LEAD, false);
		}
		if (normalized.contains(TRAINEE_MARKER)) {
			return new TitleClassification(OrgRole.MEMBER, Grade.TRAINEE, false);
		}
		if (normalized.contains(SENIOR_MARKER) && normalized.contains(MANAGER_MARKER)) {
			return new TitleClassification(OrgRole.MEMBER, Grade.SENIOR, false);
		}
		if (normalized.contains(JUNIOR_MARKER) && normalized.contains(MANAGER_MARKER)) {
			return new TitleClassification(OrgRole.MEMBER, Grade.JUNIOR, false);
		}
		if (normalized.contains(MANAGER_MARKER)) {
			return new TitleClassification(OrgRole.MEMBER, Grade.MIDDLE, false);
		}
		return new TitleClassification(OrgRole.MEMBER, Grade.UNKNOWN, true);
	}
}
