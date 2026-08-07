package com.aidigital.operationalhub.domain.repository;

import com.aidigital.operationalhub.domain.entity.HubTeam;
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import jakarta.persistence.EntityManager;
import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.io.IOException;
import java.util.List;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Proves {@code hibernate.jdbc.batch_size}/{@code order_inserts} actually batch {@link HubTeam} writes
 * (a SEQUENCE-generated id, so batching applies) the way {@code NetSuiteSyncReconciler}'s per-row
 * {@code save()} calls rely on.
 */
@DataJpaTest(properties = {
		"spring.jpa.hibernate.ddl-auto=create-drop",
		"spring.jpa.properties.hibernate.cache.use_second_level_cache=false",
		"spring.jpa.properties.hibernate.generate_statistics=true",
		"spring.jpa.properties.hibernate.jdbc.batch_size=50",
		"spring.jpa.properties.hibernate.order_inserts=true",
		"spring.liquibase.enabled=false"
})
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
class HubTeamRepositoryBatchingTest {

	private static final int ROW_COUNT = 20;

	private static EmbeddedPostgres postgres;

	@Autowired
	private HubTeamRepository hubTeamRepository;

	@Autowired
	private EntityManager entityManager;

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
	void shouldBatchMultiplePerRowSavesIntoFarFewerPreparedStatementsTest() {
		// Given:
		Statistics statistics = entityManager.getEntityManagerFactory().unwrap(SessionFactory.class).getStatistics();
		statistics.clear();
		List<HubTeam> teams = IntStream.range(0, ROW_COUNT)
				.mapToObj(i -> {
					HubTeam team = new HubTeam();
					team.setTeamName("Team " + i);
					team.setFromNetSuite(true);
					return team;
				})
				.toList();

		// Execution: one save() per row, exactly like NetSuiteSyncReconciler's per-row writes
		teams.forEach(hubTeamRepository::save);
		entityManager.flush();

		// Verification: far fewer prepared statements than rows, proving the inserts were batched
		assertThat(statistics.getPrepareStatementCount()).isLessThan(ROW_COUNT);
	}
}
