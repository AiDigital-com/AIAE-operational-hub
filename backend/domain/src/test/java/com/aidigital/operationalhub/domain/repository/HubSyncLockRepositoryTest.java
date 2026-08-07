package com.aidigital.operationalhub.domain.repository;

import com.aidigital.operationalhub.domain.entity.HubSyncLock;
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.io.IOException;
import java.time.LocalDateTime;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

@DataJpaTest(properties = {
		"spring.jpa.hibernate.ddl-auto=create-drop",
		"spring.jpa.properties.hibernate.cache.use_second_level_cache=false",
		"spring.liquibase.enabled=false"
})
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
class HubSyncLockRepositoryTest {

	private static EmbeddedPostgres postgres;

	@Autowired
	private HubSyncLockRepository hubSyncLockRepository;

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
	void shouldCreateDynamicLockRowsIdempotentlyTest() {
		// Given:
		String lockName = "conversion_adjustments:key:abc";

		// When:
		hubSyncLockRepository.ensureExists(lockName);
		hubSyncLockRepository.ensureExists(lockName);

		// Then:
		Optional<HubSyncLock> found = hubSyncLockRepository.findById(lockName);
		assertThat(found).isPresent();
		assertThat(found.get().isLocked()).isFalse();
		assertThat(hubSyncLockRepository.count()).isEqualTo(1);
	}

	@Test
	void shouldAcquireCreatedDynamicLockOnlyOnceTest() {
		// Given:
		String lockName = "conversion_adjustments:key:def";
		LocalDateTime now = LocalDateTime.of(2026, 3, 10, 12, 30);
		hubSyncLockRepository.ensureExists(lockName);

		// When:
		int acquired = hubSyncLockRepository.tryAcquire(lockName, now);
		int alreadyHeld = hubSyncLockRepository.tryAcquire(lockName, now.plusSeconds(1));

		// Then:
		HubSyncLock found = hubSyncLockRepository.findById(lockName).orElseThrow();
		assertThat(acquired).isEqualTo(1);
		assertThat(alreadyHeld).isZero();
		assertThat(found.isLocked()).isTrue();
		assertThat(found.getLockedAt()).isEqualTo(now);
	}
}
