package com.aidigital.operationalhub.cachemanagement.registry;

import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Default {@link CacheNamesByClassService}. Flattens the {@link CacheNamesByClassRegistry} into a
 * lookup keyed by simple class name once at construction.
 */
@Service
public class CacheNamesByClassServiceImpl implements CacheNamesByClassService {

	private final Map<String, List<String>> cacheNamesBySimpleClassName;

	/**
	 * Builds the simple-name → cache-names lookup from the registry.
	 *
	 * @param registry the application's cache-names registry
	 */
	public CacheNamesByClassServiceImpl(CacheNamesByClassRegistry registry) {
		Map<String, List<String>> lookup = new HashMap<>();
		for (Map.Entry<Class<?>, List<String>> entry : registry.cacheNamesByClassMap().entrySet()) {
			lookup.computeIfAbsent(entry.getKey().getSimpleName(), key -> new ArrayList<>())
					.addAll(entry.getValue());
		}
		this.cacheNamesBySimpleClassName = lookup;
	}

	@Override
	public List<String> getCacheNamesBySimpleClassName(String simpleClassName) {
		return cacheNamesBySimpleClassName.getOrDefault(simpleClassName, List.of());
	}

	@Override
	public List<String> getAllCacheNames() {
		return cacheNamesBySimpleClassName.values().stream()
				.flatMap(Collection::stream)
				.toList();
	}
}
