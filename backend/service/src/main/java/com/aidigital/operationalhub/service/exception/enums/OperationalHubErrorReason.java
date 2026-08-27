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
	OPH_033("OPH_033", "Another conversions adjustment is being applied. Please try again shortly."),

	/**
	 * Target dashboard is not found for the campaign.
	 */
	OPH_034("OPH_034", "Unknown dashboard: %s."),

	/**
	 * A dashboard with the same name already exists in the campaign.
	 */
	OPH_035("OPH_035", "A dashboard named '%s' already exists for this campaign."),

	/**
	 * Dashboard name is absent.
	 */
	OPH_036("OPH_036", "Dashboard name must not be blank."),

	/**
	 * Dashboard name is too long.
	 */
	OPH_037("OPH_037", "Dashboard name must be 50 characters or fewer."),

	/**
	 * The requested dashboard type has no schema behind it yet, so nothing could write its data source.
	 */
	OPH_038("OPH_038", "Dashboard type '%s' is not available yet."),

	/**
	 * The campaign has no name or no client, so nothing can scope a dashboard's dataset to it.
	 */
	OPH_039("OPH_039", "Campaign %s has no name or client recorded, so its dataset cannot be scoped."),

	/**
	 * A dashboard dataset preview filter references a column outside the fixed dashboard schema.
	 */
	OPH_040("OPH_040", "Unknown dashboard dataset column: %s."),

	/**
	 * A dashboard dataset preview date range is malformed.
	 */
	OPH_041("OPH_041", "Invalid dashboard dataset date range: %s."),

	/**
	 * A live dashboard cannot be renamed, because its name is part of the BigQuery table name ClicData reads.
	 */
	OPH_042("OPH_042", "Remove the data source before renaming '%s' - the name is part of its BigQuery table, "
			+ "and a renamed dashboard would leave ClicData reading the old table."),

	/**
	 * Add Line V1: the platform/account/account id triple has no delivery in this campaign's mart yet.
	 */
	OPH_043("OPH_043", "No delivery exists yet for platform '%s', account '%s' (%s) in this campaign - pick an "
			+ "existing platform/account."),

	/**
	 * Add Line V2: the selected line's ids do not match any entity in the campaign's mart data.
	 */
	OPH_044("OPH_044",
			"The selected line no longer matches any campaign delivery data - refresh and pick it again."),

	/**
	 * Add Line V3: an override, not an addition - a mart row already exists for that line and date.
	 */
	OPH_045("OPH_045", "This line already exists for %s - edit it instead of adding it again."),

	/**
	 * Add Line V4: the generated line's (date, ids) key already exists in the mart.
	 */
	OPH_046("OPH_046",
			"A line with date %s and these constructed ids already exists - edit it instead of adding it again."),

	/**
	 * Add Line V6: a generated line's name must split into exactly sixteen naming-convention segments.
	 */
	OPH_047("OPH_047",
			"The line name must be provided and have exactly sixteen underscore-separated segments."),

	/**
	 * Add Line V7: a generated line's name must stay within the campaign it was added to.
	 */
	OPH_048("OPH_048", "The line name must start with this campaign's naming prefix '%s'."),

	/**
	 * Add Line V8: a level was submitted for generation, but its name already matches real mart data.
	 */
	OPH_049("OPH_049",
			"This line already exists in platform data - select it instead of creating a new one.");

	private final String code;
	private final String description;
}
