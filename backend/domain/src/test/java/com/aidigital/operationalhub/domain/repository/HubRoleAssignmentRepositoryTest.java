package com.aidigital.operationalhub.domain.repository;

import com.aidigital.operationalhub.domain.entity.HubRoleAssignment;
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.jdbc.Sql;

import java.io.IOException;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

@DataJpaTest(properties = {
		"spring.jpa.hibernate.ddl-auto=create-drop",
		"spring.jpa.properties.hibernate.cache.use_second_level_cache=false",
		"spring.liquibase.enabled=false"
})
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@Sql(scripts = "/sql/hub-role-assignment-query-test.sql")
class HubRoleAssignmentRepositoryTest {

	private static EmbeddedPostgres postgres;

	@Autowired
	private HubRoleAssignmentRepository hubRoleAssignmentRepository;

	@BeforeAll
	static void startPostgres() throws IOException {
		postgres = EmbeddedPostgres.start();
	}

	@AfterAll
	static void stopPostgres() throws IOException {
		postgres.close();
	}

	@DynamicPropertySource
	static void registerDatabaseProperties(DynamicPropertyRegistry registry) {
		registry.add("spring.datasource.url", () -> postgres.getJdbcUrl("postgres", "postgres"));
		registry.add("spring.datasource.username", () -> "postgres");
		registry.add("spring.datasource.password", () -> "postgres");
	}

	@Test
	void shouldReturnUnscopedAssignmentWhenScopeIdIsNullTest() {
		// Given:
		Long userId = 100L;
		Long roleId = 10L;
		Long scopeTypeId = 20L;
		String status = "ACTIVE";

		// When:
		List<HubRoleAssignment> assignments = hubRoleAssignmentRepository.findActiveForUserAndScopeForUpdate(
				userId,
				roleId,
				scopeTypeId,
				null,
				status
		);

		// Then:
		assertThat(assignments)
				.singleElement()
				.satisfies(assignment -> {
					assertThat(assignment.getId()).isEqualTo(1000L);
					assertThat(assignment.getScopeId()).isNull();
				});
	}

	@Test
	void shouldReturnScopedAssignmentWhenScopeIdMatchesTest() {
		// Given:
		Long userId = 100L;
		Long roleId = 11L;
		Long scopeTypeId = 21L;
		Long scopeId = 777L;
		String status = "ACTIVE";

		// When:
		List<HubRoleAssignment> assignments = hubRoleAssignmentRepository.findActiveForUserAndScopeForUpdate(
				userId,
				roleId,
				scopeTypeId,
				scopeId,
				status
		);

		// Then:
		assertThat(assignments)
				.singleElement()
				.satisfies(assignment -> assertThat(assignment.getId()).isEqualTo(1001L));
	}

	@Test
	void shouldNotReturnAssignmentWhenScopeIdDoesNotMatchTest() {
		// Given:
		Long userId = 100L;
		Long roleId = 11L;
		Long scopeTypeId = 21L;
		Long scopeId = 999L;
		String status = "ACTIVE";

		// When:
		List<HubRoleAssignment> assignments = hubRoleAssignmentRepository.findActiveForUserAndScopeForUpdate(
				userId,
				roleId,
				scopeTypeId,
				scopeId,
				status
		);

		// Then:
		assertThat(assignments).isEmpty();
	}

	@Test
	void shouldFindAnAssignmentForScopeRegardlessOfStatusTest() {
		// Given: id 1004 is seeded as REVOKED - findForScopeForUpdate must not filter by status, since it
		// exists to let a caller reactivate a previously-revoked row instead of inserting a duplicate
		Long userId = 102L;
		Long roleId = 10L;
		Long scopeTypeId = 20L;

		// When:
		Optional<HubRoleAssignment> assignment =
				hubRoleAssignmentRepository.findForScopeForUpdate(userId, roleId, scopeTypeId, null);

		// Then:
		assertThat(assignment).isPresent();
		assertThat(assignment.get().getId()).isEqualTo(1004L);
		assertThat(assignment.get().getStatus()).isEqualTo("REVOKED");
	}

	@Test
	void shouldFindAScopedAssignmentForScopeWhenScopeIdMatchesTest() {
		// Given:
		Long userId = 100L;
		Long roleId = 11L;
		Long scopeTypeId = 21L;
		Long scopeId = 777L;

		// When:
		Optional<HubRoleAssignment> assignment =
				hubRoleAssignmentRepository.findForScopeForUpdate(userId, roleId, scopeTypeId, scopeId);

		// Then:
		assertThat(assignment).isPresent();
		assertThat(assignment.get().getId()).isEqualTo(1001L);
	}

	@Test
	void shouldNotFindAnAssignmentForScopeWhenScopeIdDoesNotMatchTest() {
		// Given:
		Long userId = 100L;
		Long roleId = 11L;
		Long scopeTypeId = 21L;
		Long scopeId = 999L;

		// When:
		Optional<HubRoleAssignment> assignment =
				hubRoleAssignmentRepository.findForScopeForUpdate(userId, roleId, scopeTypeId, scopeId);

		// Then:
		assertThat(assignment).isEmpty();
	}
}
