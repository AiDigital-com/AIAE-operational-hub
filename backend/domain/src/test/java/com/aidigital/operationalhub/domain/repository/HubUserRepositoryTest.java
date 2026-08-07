package com.aidigital.operationalhub.domain.repository;

import com.aidigital.operationalhub.domain.entity.HubUser;
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
@Sql(scripts = "/sql/hub-user-email-query-test.sql")
class HubUserRepositoryTest {

	private static EmbeddedPostgres postgres;

	@Autowired
	private HubUserRepository hubUserRepository;

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
	void shouldFindUserByEmailCaseInsensitivelyTest() {
		// When:
		Optional<HubUser> found = hubUserRepository.findByEmailIgnoreCase("JANE.DOE@EXAMPLE.COM");

		// Then:
		assertThat(found).isPresent();
		assertThat(found.get().getId()).isEqualTo(100L);
	}

	@Test
	void shouldReturnEmptyWhenNoUserMatchesTheEmailTest() {
		// When:
		Optional<HubUser> found = hubUserRepository.findByEmailIgnoreCase("nobody@example.com");

		// Then:
		assertThat(found).isEmpty();
	}

	@Test
	void shouldBatchLoadUsersByEmailCaseInsensitivelyTest() {
		// Given: the caller lower-cases before calling, per the method contract
		List<String> lowerCaseEmails = List.of("jane.doe@example.com", "john@example.com", "missing@example.com");

		// When:
		List<HubUser> found = hubUserRepository.findAllByEmailIgnoreCaseIn(lowerCaseEmails);

		// Then:
		assertThat(found).extracting(HubUser::getId).containsExactlyInAnyOrder(100L, 101L);
	}
}
