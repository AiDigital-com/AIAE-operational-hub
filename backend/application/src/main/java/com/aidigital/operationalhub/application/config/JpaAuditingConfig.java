package com.aidigital.operationalhub.application.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.data.jpa.repository.config.EnableJpaAuditing;

/**
 * Enables Spring Data JPA auditing so {@code @CreatedDate}/{@code @LastModifiedDate} fields on
 * {@code AuditAwareEntity} are populated automatically on insert and update.
 */
@Configuration
@EnableJpaAuditing
public class JpaAuditingConfig {

}
