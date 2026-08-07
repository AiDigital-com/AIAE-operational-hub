package com.aidigital.operationalhub.service.common.search;

/**
 * A single-field filter directive.
 *
 * @param field         the field to filter on
 * @param value         the value matched against the field
 * @param operation     the operation used to match the value
 * @param caseSensitive whether the match is case-sensitive
 * @param <F>           the per-entity searchable field type
 */
public record FilterCriterion<F extends SearchableField>(
		F field, String value, FilterOperation operation, boolean caseSensitive) {

}
