package com.aidigital.operationalhub.service.common.search;

/**
 * Operation used to match a filter value against a field.
 */
public enum FilterOperation {

	/**
	 * Substring match used for free-text columns.
	 */
	CONTAINS,

	/**
	 * Exact match used for code or enumerated columns.
	 */
	EQUALS
}
