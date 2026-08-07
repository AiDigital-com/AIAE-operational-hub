package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.DirectionEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.FilterOperationEnumV1;
import com.aidigital.operationalhub.service.common.search.FilterCriterion;
import com.aidigital.operationalhub.service.common.search.FilterOperation;
import com.aidigital.operationalhub.service.common.search.SearchableField;
import com.aidigital.operationalhub.service.common.search.SortCriterion;
import com.aidigital.operationalhub.service.common.search.SortDirection;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.function.Function;

/**
 * Shared translations between the generated search enums and their service-layer counterparts.
 *
 * <p>Used by the per-entity search mappers so the direction and operation conversions are defined
 * once rather than duplicated for users, agencies, and clients.
 */
@Component
public class SearchContractSupport {

	/**
	 * Maps the contract sort direction to the service direction, defaulting to ascending.
	 *
	 * @param direction the contract direction, may be {@code null}
	 * @return the service direction
	 */
	public SortDirection toDirection(DirectionEnumV1 direction) {
		return direction == DirectionEnumV1.DESC ? SortDirection.DESC : SortDirection.ASC;
	}

	/**
	 * Maps the contract filter operation to the service operation, defaulting to substring matching.
	 *
	 * @param operation the contract operation, may be {@code null}
	 * @return the service operation
	 */
	public FilterOperation toOperation(FilterOperationEnumV1 operation) {
		return operation == FilterOperationEnumV1.EQUALS ? FilterOperation.EQUALS : FilterOperation.CONTAINS;
	}

	/**
	 * Maps a list of contract filters to service filter criteria.
	 *
	 * <p>Filters whose required fields ({@code field}, {@code value}, {@code operation}) are
	 * {@code null} are skipped rather than causing a {@link NullPointerException}.
	 *
	 * @param contractFilters the contract filters, may be {@code null}
	 * @param fieldName       extracts the field name from a contract filter
	 * @param value           extracts the filter value from a contract filter
	 * @param operation       extracts the filter operation from a contract filter
	 * @param caseSensitive   extracts the case-sensitivity flag from a contract filter
	 * @param fieldResolver   resolves the service field enum constant from its name
	 * @param <F>             the service searchable field type
	 * @param <FF>            the contract filter type
	 * @return the service filter criteria, never {@code null}
	 */
	public <F extends SearchableField, FF> List<FilterCriterion<F>> toFilters(
			List<FF> contractFilters,
			Function<FF, String> fieldName,
			Function<FF, String> value,
			Function<FF, FilterOperationEnumV1> operation,
			Function<FF, Boolean> caseSensitive,
			Function<String, F> fieldResolver) {
		if (contractFilters == null) {
			return List.of();
		}
		return contractFilters.stream()
				.map(filter -> toFilterCriterion(filter, fieldName, value, operation, caseSensitive, fieldResolver))
				.filter(java.util.Objects::nonNull)
				.toList();
	}

	/**
	 * Maps a single contract filter to a service filter criterion when all required fields are present.
	 *
	 * @param filter        the contract filter
	 * @param fieldName     extracts the field name
	 * @param value         extracts the filter value
	 * @param operation     extracts the filter operation
	 * @param caseSensitive extracts the case-sensitivity flag
	 * @param fieldResolver resolves the service field enum constant from its name
	 * @param <F>           the service searchable field type
	 * @param <FF>          the contract filter type
	 * @return the service filter criterion, or {@code null} when required fields are missing
	 */
	<F extends SearchableField, FF> FilterCriterion<F> toFilterCriterion(
			FF filter,
			Function<FF, String> fieldName,
			Function<FF, String> value,
			Function<FF, FilterOperationEnumV1> operation,
			Function<FF, Boolean> caseSensitive,
			Function<String, F> fieldResolver) {
		String name = fieldName.apply(filter);
		String filterValue = value.apply(filter);
		FilterOperationEnumV1 op = operation.apply(filter);
		if (name == null || filterValue == null || op == null) {
			return null;
		}
		return new FilterCriterion<>(
				fieldResolver.apply(name),
				filterValue,
				toOperation(op),
				Boolean.TRUE.equals(caseSensitive.apply(filter)));
	}

	/**
	 * Maps a contract sort directive to a service sort criterion.
	 *
	 * <p>If the sort field name is {@code null} the method returns {@code null}; a missing direction
	 * defaults to ascending through {@link #toDirection(DirectionEnumV1)}.
	 *
	 * @param contractSort  the contract sort, may be {@code null}
	 * @param fieldName     extracts the field name from the contract sort
	 * @param direction     extracts the direction from the contract sort
	 * @param fieldResolver resolves the service field enum constant from its name
	 * @param <F>           the service searchable field type
	 * @param <SF>          the contract sort type
	 * @return the service sort criterion, or {@code null} when no sort is requested or the field is missing
	 */
	public <F extends SearchableField, SF> SortCriterion<F> toSort(
			SF contractSort,
			Function<SF, String> fieldName,
			Function<SF, DirectionEnumV1> direction,
			Function<String, F> fieldResolver) {
		if (contractSort == null) {
			return null;
		}
		String name = fieldName.apply(contractSort);
		if (name == null) {
			return null;
		}
		return new SortCriterion<>(fieldResolver.apply(name), toDirection(direction.apply(contractSort)));
	}
}
