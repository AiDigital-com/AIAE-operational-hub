package com.aidigital.operationalhub.service.rbac.search;

import com.aidigital.operationalhub.domain.entity.HubRoleAssignment;
import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.service.common.search.FilterCriterion;
import com.aidigital.operationalhub.service.common.search.FilterOperation;
import com.aidigital.operationalhub.service.common.search.SearchCriteria;
import com.aidigital.operationalhub.service.common.search.SortCriterion;
import com.aidigital.operationalhub.service.common.search.SortDirection;
import jakarta.persistence.criteria.CriteriaBuilder;
import jakarta.persistence.criteria.CriteriaQuery;
import jakarta.persistence.criteria.Expression;
import jakarta.persistence.criteria.Join;
import jakarta.persistence.criteria.Path;
import jakarta.persistence.criteria.Predicate;
import jakarta.persistence.criteria.Root;
import jakarta.persistence.criteria.Subquery;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Pure Mockito unit tests for {@link HubUserSearchMapper}, driving a mocked Criteria API.
 */
@ExtendWith(MockitoExtension.class)
@SuppressWarnings({"unchecked", "rawtypes"})
class HubUserSearchMapperTest {

	@Mock
	private CriteriaBuilder builder;
	@Mock
	private Root<HubUser> root;
	@Mock
	private CriteriaQuery<?> query;

	@Test
	void shouldReturnNullSpecificationWhenNoFiltersTest() {
		// Given:
		HubUserSearchMapper factory = new HubUserSearchMapper();
		SearchCriteria<HubUserField> criteria = new SearchCriteria<>(List.of(), null, 1, 20);

		// When:
		Specification<HubUser> specification = factory.toSpecification(criteria);

		// Then:
		assertThat(specification).isNull();
	}

	@Test
	void shouldBuildPageableWithSortFromCriteriaTest() {
		// Given:
		HubUserSearchMapper factory = new HubUserSearchMapper();
		SearchCriteria<HubUserField> criteria = new SearchCriteria<>(
				List.of(), new SortCriterion<>(HubUserField.FULL_NAME, SortDirection.DESC), 2, 15);

		// When:
		Pageable pageable = factory.toPageable(criteria);

		// Then:
		assertThat(pageable.getPageNumber()).isEqualTo(1);
		assertThat(pageable.getPageSize()).isEqualTo(15);
		assertThat(pageable.getSort()).isEqualTo(Sort.by(Sort.Direction.DESC, "displayName"));
	}

	@Test
	void shouldBuildUnsortedPageableWhenNoSortTest() {
		// Given:
		HubUserSearchMapper factory = new HubUserSearchMapper();
		SearchCriteria<HubUserField> criteria = new SearchCriteria<>(List.of(), null, 1, 20);

		// When:
		Pageable pageable = factory.toPageable(criteria);

		// Then:
		assertThat(pageable.getSort().isUnsorted()).isTrue();
	}

	@Test
	void shouldCombineFilterPredicatesIntoConjunctionTest() {
		// Given:
		HubUserSearchMapper factory = new HubUserSearchMapper();
		SearchCriteria<HubUserField> criteria = new SearchCriteria<>(
				List.of(new FilterCriterion<>(HubUserField.EMAIL, "a@b", FilterOperation.EQUALS, true)), null, 1, 20);
		Path path = mock(Path.class);
		Predicate predicate = mock(Predicate.class);
		Predicate combined = mock(Predicate.class);
		when(root.get("email")).thenReturn(path);
		when(builder.equal(path, "a@b")).thenReturn(predicate);
		when(builder.and(predicate)).thenReturn(combined);

		// When:
		Predicate result = factory.toSpecification(criteria).toPredicate(root, query, builder);

		// Then:
		assertThat(result).isSameAs(combined);
	}

	@Test
	void shouldBuildCaseInsensitiveContainsPredicateForTextFieldTest() {
		// Given:
		HubUserSearchMapper factory = new HubUserSearchMapper();
		FilterCriterion<HubUserField> filter =
				new FilterCriterion<>(HubUserField.EMAIL, "X", FilterOperation.CONTAINS, false);
		Path path = mock(Path.class);
		Expression lowered = mock(Expression.class);
		Predicate predicate = mock(Predicate.class);
		when(root.get("email")).thenReturn(path);
		when(builder.lower(path)).thenReturn(lowered);
		when(builder.like(lowered, "%x%")).thenReturn(predicate);

		// When:
		Predicate result = factory.toPredicate(filter, root, query, builder);

		// Then:
		assertThat(result).isSameAs(predicate);
	}

	@Test
	void shouldBuildExactNumericPredicateForIdFieldTest() {
		// Given:
		HubUserSearchMapper factory = new HubUserSearchMapper();
		FilterCriterion<HubUserField> filter =
				new FilterCriterion<>(HubUserField.HUB_USER_ID, "5", FilterOperation.EQUALS, false);
		Path path = mock(Path.class);
		Predicate predicate = mock(Predicate.class);
		when(root.get("id")).thenReturn(path);
		when(builder.equal(path, 5L)).thenReturn(predicate);

		// When:
		Predicate result = factory.toPredicate(filter, root, query, builder);

		// Then:
		assertThat(result).isSameAs(predicate);
	}

	@Test
	void shouldBuildSubstringNumericPredicateForIdFieldTest() {
		// Given:
		HubUserSearchMapper factory = new HubUserSearchMapper();
		FilterCriterion<HubUserField> filter =
				new FilterCriterion<>(HubUserField.HUB_USER_ID, "5", FilterOperation.CONTAINS, false);
		Path path = mock(Path.class);
		Expression rendered = mock(Expression.class);
		Expression lowered = mock(Expression.class);
		Predicate predicate = mock(Predicate.class);
		when(root.get("id")).thenReturn(path);
		when(path.as(String.class)).thenReturn(rendered);
		when(builder.lower(rendered)).thenReturn(lowered);
		when(builder.like(lowered, "%5%")).thenReturn(predicate);

		// When:
		Predicate result = factory.toPredicate(filter, root, query, builder);

		// Then:
		assertThat(result).isSameAs(predicate);
	}

	@Test
	void shouldReturnDisjunctionForUnparseableNumericEqualsTest() {
		// Given:
		HubUserSearchMapper factory = new HubUserSearchMapper();
		FilterCriterion<HubUserField> filter =
				new FilterCriterion<>(HubUserField.HUB_USER_ID, "abc", FilterOperation.EQUALS, false);
		Predicate disjunction = mock(Predicate.class);
		when(builder.disjunction()).thenReturn(disjunction);

		// When:
		Predicate result = factory.toPredicate(filter, root, query, builder);

		// Then:
		assertThat(result).isSameAs(disjunction);
	}

	@Test
	void shouldBuildActiveRoleExistsSubqueryForRoleCodeFilterTest() {
		// Given:
		HubUserSearchMapper factory = new HubUserSearchMapper();
		FilterCriterion<HubUserField> filter =
				new FilterCriterion<>(HubUserField.ROLE_CODE, "ADMIN", FilterOperation.EQUALS, false);
		Subquery subquery = mock(Subquery.class);
		Root assignmentRoot = mock(Root.class);
		Join roleJoin = mock(Join.class);
		Path assignmentId = mock(Path.class);
		Path assignmentUserId = mock(Path.class);
		Path assignmentStatus = mock(Path.class);
		Path userId = mock(Path.class);
		Path roleCode = mock(Path.class);
		Expression loweredRoleCode = mock(Expression.class);
		Predicate userMatch = mock(Predicate.class);
		Predicate statusMatch = mock(Predicate.class);
		Predicate roleMatch = mock(Predicate.class);
		Predicate exists = mock(Predicate.class);
		when(query.subquery(Long.class)).thenReturn(subquery);
		when(subquery.from(HubRoleAssignment.class)).thenReturn(assignmentRoot);
		when(assignmentRoot.join("role")).thenReturn(roleJoin);
		when(assignmentRoot.get("id")).thenReturn(assignmentId);
		when(assignmentRoot.get("userId")).thenReturn(assignmentUserId);
		when(assignmentRoot.get("status")).thenReturn(assignmentStatus);
		when(root.get("id")).thenReturn(userId);
		when(roleJoin.get("roleCode")).thenReturn(roleCode);
		when(builder.equal(assignmentUserId, userId)).thenReturn(userMatch);
		when(builder.equal(assignmentStatus, "ACTIVE")).thenReturn(statusMatch);
		when(builder.lower(roleCode)).thenReturn(loweredRoleCode);
		when(builder.equal(loweredRoleCode, "admin")).thenReturn(roleMatch);
		when(builder.exists(subquery)).thenReturn(exists);

		// When:
		Predicate result = factory.toPredicate(filter, root, query, builder);

		// Then:
		assertThat(result).isSameAs(exists);
	}
}
