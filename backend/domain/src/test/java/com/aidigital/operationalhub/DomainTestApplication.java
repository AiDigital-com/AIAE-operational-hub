package com.aidigital.operationalhub;

import com.aidigital.operationalhub.domain.entity.HubRoleAssignment;
import com.aidigital.operationalhub.domain.repository.HubRoleAssignmentRepository;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.autoconfigure.domain.EntityScan;
import org.springframework.data.jpa.repository.config.EnableJpaRepositories;

/**
 * Test-only Spring Boot configuration for domain JPA slice tests.
 */
@SpringBootConfiguration
@EnableAutoConfiguration
@EntityScan(basePackageClasses = HubRoleAssignment.class)
@EnableJpaRepositories(basePackageClasses = HubRoleAssignmentRepository.class)
public class DomainTestApplication {

}
