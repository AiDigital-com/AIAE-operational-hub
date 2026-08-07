package com.aidigital.operationalhub.domain.repository;

import com.aidigital.operationalhub.domain.entity.HubReportView;
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
@Sql(scripts = "/sql/hub-report-view-query-test.sql")
class HubReportViewRepositoryTest {

	private static EmbeddedPostgres postgres;

	@Autowired
	private HubReportViewRepository hubReportViewRepository;

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
	void shouldListCampaignViewsOldestFirstTest() {
		// When:
		List<HubReportView> views = hubReportViewRepository.findByCampaignIdOrderByCreatedAtAsc(42L);

		// Then: only campaign 42's views, oldest first
		assertThat(views).extracting(HubReportView::getId).containsExactly(10L, 11L);
	}

	@Test
	void shouldFindByIdScopedToCampaignTest() {
		// When:
		Optional<HubReportView> found = hubReportViewRepository.findByIdAndCampaignId(10L, 42L);

		// Then:
		assertThat(found).isPresent();
		assertThat(found.get().getName()).isEqualTo("All data");
	}

	@Test
	void shouldNotFindViewFromAnotherCampaignTest() {
		// When: view 20 belongs to campaign 99, not 42
		Optional<HubReportView> found = hubReportViewRepository.findByIdAndCampaignId(20L, 42L);

		// Then:
		assertThat(found).isEmpty();
	}

	@Test
	void shouldReportNameExistsCaseInsensitivelyWithinCampaignTest() {
		// When/Then: "All data" exists in campaign 42 regardless of case
		assertThat(hubReportViewRepository.existsByCampaignIdAndNameIgnoreCase(42L, "all data")).isTrue();
		assertThat(hubReportViewRepository.existsByCampaignIdAndNameIgnoreCase(42L, "ALL DATA")).isTrue();
		// ...but not in a different campaign
		assertThat(hubReportViewRepository.existsByCampaignIdAndNameIgnoreCase(99L, "all data")).isFalse();
	}

	@Test
	void shouldExcludeSelfInNameExistenceCheckTest() {
		// When/Then: excluding view 10 itself, its own name no longer "exists"
		assertThat(hubReportViewRepository.existsByCampaignIdAndNameIgnoreCaseAndIdNot(42L, "All data", 10L)).isFalse();
		// ...but excluding a DIFFERENT view still finds view 10's name
		assertThat(hubReportViewRepository.existsByCampaignIdAndNameIgnoreCaseAndIdNot(42L, "All data", 11L)).isTrue();
	}
}
