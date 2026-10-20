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
	 * The root Rippling department whose Directors are granted the {@code DIRECTOR} role (unrestricted
	 * visibility). A Rippling department is a {@code >}-separated path; only its first segment is
	 * compared, case-insensitively, so every sub-department of the root qualifies.
	 *
	 * <p>A Director title anywhere else in the company (Growth, Client Service, Strategy, Finance, ...)
	 * is read as a plain member: the title still sets the grade, but no role follows from it. Owner
	 * decision 2026-10-20: a sync that handed every «Growth Director» the whole Pacing fleet gave 103
	 * people outside MPO full visibility for 16 who needed it.
	 */
	private String directorRootDepartment = "Media & Performance Optimization";
}
