package com.aidigital.operationalhub.service.common.search;

/**
 * A field of a searchable collection that exposes the persistence expression it maps to.
 *
 * <p>Implemented by per-entity field enums so that generic search criteria can carry a typed,
 * whitelisted field while the entity-specific service translates it into its own query language
 * (JPQL path or SuiteQL column). Because only enum constants implement this contract, callers can
 * never inject an arbitrary column name, which keeps dynamic query building injection-safe.
 */
public interface SearchableField {

	/**
	 * Returns the persistence expression this field maps to.
	 *
	 * @return the JPQL path or SuiteQL column for the field
	 */
	String expression();

	/**
	 * Indicates whether the field is backed by a numeric column.
	 *
	 * @return {@code true} when the field is numeric, {@code false} when it is textual
	 */
	boolean numeric();
}
