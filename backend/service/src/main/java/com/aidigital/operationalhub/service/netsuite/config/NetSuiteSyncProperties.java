package com.aidigital.operationalhub.service.netsuite.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;
import org.springframework.validation.annotation.Validated;

/**
 * Settings of the daily NetSuite/Rippling sync, under {@code app.netsuite-sync}.
 */
@Setter
@Getter
@Validated
@Component
@ConfigurationProperties(prefix = "app.netsuite-sync")
public class NetSuiteSyncProperties {

	/**
	 * The root Rippling department of MPO: its Directors are granted the {@code DIRECTOR} role (scoped
	 * to their own streams' teams since 2026-10-23), and its people - the whole tree under it, Integration
	 * and AdOps included - are the only ones who can be added to a campaign. A Rippling department is a
	 * {@code >}-separated path; only its first segment is compared, case-insensitively, so every
	 * sub-department of the root qualifies. Read through {@code MpoDepartmentPolicy}.
	 *
	 * <p>A Director title anywhere else in the company (Growth, Client Service, Strategy, Finance, ...)
	 * is read as a plain member: the title still sets the grade, but no role follows from it. Owner
	 * decision 2026-10-20: a sync that handed every «Growth Director» the whole Pacing fleet gave 103
	 * people outside MPO full visibility for 16 who needed it.
	 */
	private String directorRootDepartment = "Media & Performance Optimization";
}
