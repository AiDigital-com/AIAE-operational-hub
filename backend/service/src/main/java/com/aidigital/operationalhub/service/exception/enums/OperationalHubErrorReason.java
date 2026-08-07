package com.aidigital.operationalhub.service.exception.enums;

import com.aidigital.operationalhub.service.exception.BusinessExceptionReason;
import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * Stable Operational Hub business error codes.
 */
@Getter
@RequiredArgsConstructor
public enum OperationalHubErrorReason implements BusinessExceptionReason {

	/**
	 * Unexpected error fallback.
	 */
	OPH_000("OPH_000", "Unexpected error occurred."),

	/**
	 * Assignment command is absent.
	 */
	OPH_001("OPH_001", "Assignment command must not be null."),

	/**
	 * Assignment target user id is absent.
	 */
	OPH_002("OPH_002", "Assignment userId must not be null."),

	/**
	 * Role code is absent.
	 */
	OPH_003("OPH_003", "Role code must not be blank."),

	/**
	 * Role code is not registered.
	 */
	OPH_004("OPH_004", "Unknown role code: %s."),

	/**
	 * Scope code is absent.
	 */
	OPH_005("OPH_005", "Scope code must not be blank."),

	/**
	 * Scope code is not registered.
	 */
	OPH_006("OPH_006", "Unknown scope code: %s."),

	/**
	 * Scope code is not supported by assignment rules.
	 */
	OPH_007("OPH_007", "Unsupported scope code: %s."),

	/**
	 * ALL scope must be unscoped.
	 */
	OPH_008("OPH_008", "Scope 'ALL' requires a null scopeId."),

	/**
	 * OWN scope must point to assigned user.
	 */
	OPH_009("OPH_009", "Scope 'OWN' requires scopeId to equal userId."),

	/**
	 * TEAM scope requires scope id.
	 */
	OPH_010("OPH_010", "Scope 'TEAM' requires a non-null scopeId."),

	/**
	 * TEAM scope references unknown team.
	 */
	OPH_011("OPH_011", "Scope 'TEAM' references a missing team: %s."),

	/**
	 * Scope exists but is not assignable yet.
	 */
	OPH_012("OPH_012", "Scope '%s' is seeded but not yet assignable."),

	/**
	 * Revoke command is invalid.
	 */
	OPH_013("OPH_013", "Revoke command requires an assignmentId."),

	/**
	 * Target Hub user is not found.
	 */
	OPH_014("OPH_014", "Unknown user: %s."),

	/**
	 * Authenticated user has no required permission.
	 */
	OPH_015("OPH_015", "User is not authorized."),

	/**
	 * Authenticated principal is malformed for this application.
	 */
	OPH_016("OPH_016", "Authenticated principal is invalid."),

	/**
	 * Request validation failed.
	 */
	OPH_017("OPH_017", "Validation failed."),

	/**
	 * BigQuery data query failed.
	 */
	OPH_018("OPH_018", "BigQuery data query failed: %s."),

	/**
	 * BigQuery authentication failed.
	 */
	OPH_019("OPH_019", "BigQuery authentication failed."),

	/**
	 * Target Hub team is not found.
	 */
	OPH_021("OPH_021", "Unknown team: %s."),

	/**
	 * Team name is absent.
	 */
	OPH_022("OPH_022", "Team name must not be blank."),

	/**
	 * NetSuite-sourced teams are read-only.
	 */
	OPH_023("OPH_023", "Teams synced from NetSuite cannot be edited."),

	/**
	 * The authenticated identity does not match any synced employee, so no Hub user can be provisioned.
	 */
	OPH_024("OPH_024", "User is not a registered employee. Contact your administrator."),

	/**
	 * Target campaign is not found, or not visible to the current user.
	 */
	OPH_025("OPH_025", "Unknown campaign: %s."),

	/**
	 * A report-row adjustment batch failed to write to BigQuery.
	 */
	OPH_026("OPH_026", "BigQuery adjustment write failed: %s."),

	/**
	 * A report-row adjustment batch failed request-shape validation.
	 */
	OPH_027("OPH_027", "Adjustment payload is invalid: %s."),

	/**
	 * Target report view is not found for the campaign.
	 */
	OPH_028("OPH_028", "Unknown report view: %s."),

	/**
	 * A report view with the same name already exists in the campaign.
	 */
	OPH_029("OPH_029", "A report named '%s' already exists for this campaign."),

	/**
	 * Report view name is absent.
	 */
	OPH_030("OPH_030", "Report name must not be blank."),

	/**
	 * Report view name is too long.
	 */
	OPH_031("OPH_031", "Report name must be 50 characters or fewer."),

	/**
	 * The concurrent-export limit is already reached.
	 */
	OPH_032("OPH_032", "Too many exports are already in progress. Please try again shortly."),

	/**
	 * Another conversions write is already running, and the two cannot safely overlap.
	 */
	OPH_033("OPH_033", "Another conversions adjustment is being applied. Please try again shortly.");

	private final String code;
	private final String description;
}
