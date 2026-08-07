package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.DirectionEnumV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.FilterOperationEnumV1;
import com.aidigital.operationalhub.service.common.search.FilterCriterion;
import com.aidigital.operationalhub.service.common.search.FilterOperation;
import com.aidigital.operationalhub.service.common.search.SearchableField;
import com.aidigital.operationalhub.service.common.search.SortCriterion;
import com.aidigital.operationalhub.service.common.search.SortDirection;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link SearchContractSupport}.
 */
class SearchContractSupportTest {

	@Test
	void shouldMapSortDirectionDefaultingToAscendingTest() {
		// Given:
		SearchContractSupport support = new SearchContractSupport();

		// When-Then:
		assertThat(support.toDirection(DirectionEnumV1.DESC)).isEqualTo(SortDirection.DESC);
		assertThat(support.toDirection(DirectionEnumV1.ASC)).isEqualTo(SortDirection.ASC);
		assertThat(support.toDirection(null)).isEqualTo(SortDirection.ASC);
	}

	@Test
	void shouldMapFilterOperationDefaultingToContainsTest() {
		// Given:
		SearchContractSupport support = new SearchContractSupport();

		// When-Then:
		assertThat(support.toOperation(FilterOperationEnumV1.EQUALS)).isEqualTo(FilterOperation.EQUALS);
		assertThat(support.toOperation(FilterOperationEnumV1.CONTAINS)).isEqualTo(FilterOperation.CONTAINS);
		assertThat(support.toOperation(null)).isEqualTo(FilterOperation.CONTAINS);
	}

	@Test
	void shouldMapContractFiltersToServiceCriteriaTest() {
		// Given:
		SearchContractSupport support = new SearchContractSupport();
		ContractFilter filter = new ContractFilter("B", "value", FilterOperationEnumV1.EQUALS, true);

		// When:
		List<FilterCriterion<TestField>> result = support.toFilters(
				List.of(filter),
				ContractFilter::field,
				ContractFilter::value,
				ContractFilter::operation,
				ContractFilter::caseSensitive,
				TestField::valueOf);

		// Then:
		assertThat(result).hasSize(1);
		assertThat(result.get(0).field()).isEqualTo(TestField.B);
		assertThat(result.get(0).value()).isEqualTo("value");
		assertThat(result.get(0).operation()).isEqualTo(FilterOperation.EQUALS);
		assertThat(result.get(0).caseSensitive()).isTrue();
	}

	@Test
	void shouldReturnEmptyFiltersWhenContractFiltersAreNullTest() {
		// Given:
		SearchContractSupport support = new SearchContractSupport();

		// When:
		List<FilterCriterion<TestField>> result = support.toFilters(
				null,
				f -> f.field(),
				ContractFilter::value,
				ContractFilter::operation,
				ContractFilter::caseSensitive,
				TestField::valueOf);

		// Then:
		assertThat(result).isEmpty();
	}

	@Test
	void shouldMapContractSortToServiceCriterionTest() {
		// Given:
		SearchContractSupport support = new SearchContractSupport();
		ContractSort sort = new ContractSort("A", DirectionEnumV1.DESC);

		// When:
		SortCriterion<TestField> result = support.toSort(
				sort,
				ContractSort::field,
				ContractSort::direction,
				TestField::valueOf);

		// Then:
		assertThat(result.field()).isEqualTo(TestField.A);
		assertThat(result.direction()).isEqualTo(SortDirection.DESC);
	}

	@Test
	void shouldReturnNullSortWhenContractSortIsNullTest() {
		// Given:
		SearchContractSupport support = new SearchContractSupport();

		// When:
		SortCriterion<TestField> result = support.toSort(
				null,
				ContractSort::field,
				ContractSort::direction,
				TestField::valueOf);

		// Then:
		assertThat(result).isNull();
	}

	enum TestField implements SearchableField {
		A("a", false),
		B("b", false);

		private final String expression;
		private final boolean numeric;

		TestField(String expression, boolean numeric) {
			this.expression = expression;
			this.numeric = numeric;
		}

		@Override
		public String expression() {
			return expression;
		}

		@Override
		public boolean numeric() {
			return numeric;
		}
	}

	record ContractFilter(String field, String value, FilterOperationEnumV1 operation, Boolean caseSensitive) {

	}

	record ContractSort(String field, DirectionEnumV1 direction) {

	}
}
