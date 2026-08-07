package com.aidigital.operationalhub.application.cache;

import com.aidigital.operationalhub.application.cache.properties.HubCacheProperties;
import com.aidigital.operationalhub.domain.ToWarmUp;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.context.event.ContextRefreshedEvent;
import org.springframework.context.event.EventListener;

import java.util.List;
import java.util.stream.Collectors;

/**
 * Прогревает кеш при старте приложения.
 */
@Slf4j
@RequiredArgsConstructor
public class CacheWarmUpService {

	private volatile boolean isInitialized;

	private final HubCacheProperties clsCacheProperties;
	private final List<ToWarmUp<?>> repositoriesToWarmUp;

	/**
	 * Initialization of service.
	 */
	@EventListener(ContextRefreshedEvent.class)
	public void initCache() {
		if (clsCacheProperties.isWarmupEnabled() && !isInitialized) {
			synchronized (this) {
				if (!isInitialized) {
					warmUpCache();
					isInitialized = true;
				}
			}
		}
	}

	/**
	 * Method should warm up application caches on startup.
	 */
	void warmUpCache() {
		int repositoriesToWarmUpSize = repositoriesToWarmUp.size();
		log.info(
				"Starting warmup of {} dictionaries:\n{}",
				repositoriesToWarmUpSize,
				repositoriesToWarmUp.stream()
						.map(toWarmUp -> StringUtils.substringAfterLast(toWarmUp.getClazz().getName(), "."))
						.collect(Collectors.joining("\n"))
		);
		repositoriesToWarmUp.stream()
				.parallel()
				.forEach(ToWarmUp::findAll);
		log.info("Finishing warmup of {} dictionaries.", repositoriesToWarmUpSize);
	}
}
