package com.aidigital.operationalhub.domain;


import java.util.List;

/**
 * Marker interface indicating that a dictionary should be warmed up
 * when the application starts.
 *
 * @param <T> The entity class to be warmed up.
 */
public interface ToWarmUp<T> {

	/**
	 * Retrieves all entities from the database in order to store the result
	 * in the L2 cache.
	 *
	 * @return All dictionary entities.
	 */
	List<T> findAll();

	/**
	 * Returns the class of the entity being warmed up for extended logging
	 * of the dictionary warm-up process.
	 * This is required because generic types are erased at runtime.
	 *
	 * @return The class of the entity being warmed up.
	 */
	default Class<T> getClazz() {
		throw new IllegalArgumentException("getClazz() must be overridden by the warm-up repository.");
	}
}
