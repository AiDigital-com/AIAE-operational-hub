package com.aidigital.operationalhub.application;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Spring Boot entry point for the Operational Hub backend.
 *
 * <p>Component-scans the {@code com.aidigital.operationalhub} package root so the application,
 * service, and domain modules are wired together, and binds {@code @ConfigurationProperties} types
 * such as {@code ClerkProperties}. Caching is enabled by the service-layer cache configuration.
 */
@SpringBootApplication
@ComponentScan(basePackages = "com.aidigital.operationalhub")
@ConfigurationPropertiesScan(basePackages = "com.aidigital.operationalhub")
@EntityScan(basePackages = {
		"com.aidigital.operationalhub.domain",
		// The removable event-logging feature module owns its own entity (PDI_100).
		"com.aidigital.operationalhub.usagelogging.entities"})
@EnableJpaRepositories(basePackages = {
		"com.aidigital.operationalhub.domain.repository",
		"com.aidigital.operationalhub.usagelogging.repositories"})
@EnableScheduling
public class OperationalHubApplication {

	/**
	 * Starts the Spring Boot application.
	 *
	 * @param args command-line arguments passed by the runtime
	 */
	public static void main(String[] args) {
		SpringApplication.run(OperationalHubApplication.class, args);
	}
}
