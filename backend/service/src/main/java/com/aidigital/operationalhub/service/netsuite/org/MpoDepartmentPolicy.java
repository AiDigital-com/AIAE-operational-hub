package com.aidigital.operationalhub.service.netsuite.org;

import com.aidigital.operationalhub.service.netsuite.config.NetSuiteSyncProperties;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * Tells whether a Rippling department path sits inside MPO - the configured root department
 * ({@link NetSuiteSyncProperties#getDirectorRootDepartment()}) or any sub-department of it, such as
 * {@code "Media & Performance Optimization > Integration"}.
 *
 * <p>One answer for two questions that must agree: whether a Director title grants the
 * {@code DIRECTOR} role ({@link OrgTreeTeamResolver}), and whether a person may be added to a campaign
 * at all ({@code CampaignShareServiceImpl}, "Add people = MPO only", 2026-10-23). The sync writes the
 * raw path to {@code hub_users.department}; this policy reads it back the same way it reads the
 * BigQuery row, so the two never disagree about who is MPO.
 */
@Component
@RequiredArgsConstructor
public class MpoDepartmentPolicy {

	/**
	 * Separator of a Rippling department path ({@code "Media & Performance Optimization > Media
	 * Optimization"}); the segment before the first one is the root department.
	 */
	static final String DEPARTMENT_PATH_SEPARATOR = ">";

	private final NetSuiteSyncProperties properties;

	/**
	 * Tells whether a department path sits under the configured root department: its first
	 * {@code >}-segment equals the root, case-insensitively, whitespace collapsed. A blank department or
	 * a blank configuration never qualifies, so a misconfiguration fails closed.
	 *
	 * @param department the raw {@code department} value, possibly {@code null}
	 * @return {@code true} when the department is the root or one of its sub-departments
	 */
	public boolean isMpo(String department) {
		String configuredRoot = collapseWhitespace(properties.getDirectorRootDepartment());
		if (department == null || configuredRoot.isEmpty()) {
			return false;
		}
		String root = collapseWhitespace(department.split(DEPARTMENT_PATH_SEPARATOR)[0]);
		return !root.isEmpty() && root.equalsIgnoreCase(configuredRoot);
	}

	/**
	 * Trims a string and collapses inner whitespace runs to one space.
	 *
	 * @param value the raw value, possibly {@code null}
	 * @return the normalized value, or an empty string for {@code null}
	 */
	String collapseWhitespace(String value) {
		return value == null ? "" : value.trim().replaceAll("\\s+", " ");
	}
}
