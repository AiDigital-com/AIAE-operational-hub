package com.aidigital.operationalhub.service.common.search;

/**
 * A single-field sort directive.
 *
 * @param field     the field to sort by
 * @param direction the direction to sort in
 * @param <F>       the per-entity searchable field type
 */
public record SortCriterion<F extends SearchableField>(F field, SortDirection direction) {

}
