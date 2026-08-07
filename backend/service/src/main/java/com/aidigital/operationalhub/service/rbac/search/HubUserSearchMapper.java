package com.aidigital.operationalhub.service.rbac.search;

import com.aidigital.operationalhub.domain.entity.HubRole;
import com.aidigital.operationalhub.domain.entity.HubRoleAssignment;
import com.aidigital.operationalhub.domain.entity.HubRoleAssignment_;
import com.aidigital.operationalhub.domain.entity.HubRole_;
import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.domain.entity.HubUser_;
import com.aidigital.operationalhub.domain.enums.HubStatus;
import com.aidigital.operationalhub.service.common.search.FilterCriterion;
import com.aidigital.operationalhub.service.common.search.FilterOperation;
import com.aidigital.operationalhub.service.common.search.SearchCriteria;
import com.aidigital.operationalhub.service.common.search.SortCriterion;
import com.aidigital.operationalhub.service.common.search.SortDirection;
import jakarta.persistence.criteria.CriteriaBuilder;
import jakarta.persistence.criteria.CriteriaQuery;
import jakarta.persistence.criteria.Expression;
import jakarta.persistence.criteria.Join;
import jakarta.persistence.criteria.Predicate;
import jakarta.persistence.criteria.Root;
import jakarta.persistence.criteria.Subquery;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * Maps the user-management {@link SearchCriteria} to the JPA query inputs that drive the repository
 * search: a Criteria-API {@link Specification} (filters) and a {@link Pageable} (paging and sort).
 *
 * <p>Filters on columns owned by {@code hub_users} become predicates on the user root; a filter on
 * {@link HubUserField#ROLE_CODE} becomes an {@code exists} subquery over the user's single active
 * role assignment, so role filtering happens in the database before paging.
 */
@Component
public class HubUserSearchMapper {

	/**
	 * Builds the filter specification for the given criteria.
	 *
	 * @param criteria the search criteria
	 * @return the specification, or {@code null} when no filters are requested (matching all users)
	 */
	public Specification<HubUser> toSpecification(SearchCriteria<HubUserField> criteria) {
		List<FilterCriterion<HubUserField>> filters = criteria.filters();
		if (filters.isEmpty()) {
			return null;
		}
		return (root, query, builder) -> {
			List<Predicate> predicates = new ArrayList<>();
			for (FilterCriterion<HubUserField> filter : filters) {
				predicates.add(toPredicate(filter, root, query, builder));
			}
			return builder.and(predicates.toArray(new Predicate[0]));
		};
	}

	/**
	 * Builds the page request, translating the one-based criteria page number to the zero-based
	 * Spring Data page index and mapping the sort field to its entity attribute.
	 *
	 * @param criteria the search criteria
	 * @return the page request
	 */
	public Pageable toPageable(SearchCriteria<HubUserField> criteria) {
		return PageRequest.of(criteria.pageNumber() - 1, criteria.pageSize(), toSort(criteria.sort()));
	}

	/**
	 * Maps the optional sort criterion to a Spring Data {@link Sort}.
	 *
	 * @param sort the sort criterion, or {@code null}
	 * @return the resolved sort, or {@link Sort#unsorted()} when none is requested
	 */
	Sort toSort(SortCriterion<HubUserField> sort) {
		if (sort == null) {
			return Sort.unsorted();
		}
		Sort.Direction direction =
				sort.direction() == SortDirection.DESC ? Sort.Direction.DESC : Sort.Direction.ASC;
		return Sort.by(direction, sort.field().expression());
	}

	/**
	 * Translates a single filter into a Criteria predicate.
	 *
	 * @param filter  the filter to translate
	 * @param root    the user query root
	 * @param query   the enclosing query, used to attach the role subquery
	 * @param builder the criteria builder
	 * @return the predicate
	 */
	Predicate toPredicate(
			FilterCriterion<HubUserField> filter,
			Root<HubUser> root,
			CriteriaQuery<?> query,
			CriteriaBuilder builder) {
		if (filter.field() == HubUserField.ROLE_CODE) {
			return activeRoleCodePredicate(filter, root, query, builder);
		}
		if (filter.field().numeric()) {
			return numericPredicate(filter, root, builder);
		}
		return stringMatch(builder, stringExpression(root, filter.field()), filter);
	}

	/**
	 * Builds a predicate for a numeric user column, matching either a substring of the rendered value
	 * or the exact numeric value.
	 *
	 * @param filter  the numeric filter
	 * @param root    the user query root
	 * @param builder the criteria builder
	 * @return the predicate
	 */
	Predicate numericPredicate(
			FilterCriterion<HubUserField> filter, Root<HubUser> root, CriteriaBuilder builder) {
		if (filter.operation() == FilterOperation.CONTAINS) {
			Expression<String> rendered = numericExpression(root, filter.field()).as(String.class);
			return builder.like(builder.lower(rendered), containsPattern(filter.value().toLowerCase()));
		}
		Long exact = parseLongOrNull(filter.value());
		if (exact == null) {
			return builder.disjunction();
		}
		return builder.equal(numericExpression(root, filter.field()), exact);
	}

	/**
	 * Builds an {@code exists} subquery predicate matching users whose single active role assignment
	 * carries a role code satisfying the filter.
	 *
	 * @param filter  the role-code filter
	 * @param root    the user query root
	 * @param query   the enclosing query
	 * @param builder the criteria builder
	 * @return the predicate
	 */
	Predicate activeRoleCodePredicate(
			FilterCriterion<HubUserField> filter,
			Root<HubUser> root,
			CriteriaQuery<?> query,
			CriteriaBuilder builder) {
		Subquery<Long> subquery = query.subquery(Long.class);
		Root<HubRoleAssignment> assignment = subquery.from(HubRoleAssignment.class);
		Join<HubRoleAssignment, HubRole> role = assignment.join(HubRoleAssignment_.ROLE);
		subquery.select(assignment.get(HubRoleAssignment_.ID));
		subquery.where(
				builder.equal(assignment.get(HubRoleAssignment_.USER_ID), root.get(HubUser_.ID)),
				builder.equal(assignment.get(HubRoleAssignment_.STATUS), HubStatus.ACTIVE.getCode()),
				stringMatch(builder, role.get(HubRole_.ROLE_CODE), filter));
		return builder.exists(subquery);
	}

	/**
	 * Resolves a numeric Criteria expression for a user search field.
	 *
	 * @param root  the user query root
	 * @param field the numeric field
	 * @return the Criteria numeric expression
	 */
	Expression<Long> numericExpression(Root<HubUser> root, HubUserField field) {
		if (field == HubUserField.HUB_USER_ID) {
			return root.get(HubUser_.ID);
		}
		throw new IllegalArgumentException("Unsupported numeric user field: " + field);
	}

	/**
	 * Resolves a text Criteria expression for a user search field.
	 *
	 * @param root  the user query root
	 * @param field the text field
	 * @return the Criteria text expression
	 */
	Expression<String> stringExpression(Root<HubUser> root, HubUserField field) {
		return switch (field) {
			case FULL_NAME -> root.get(HubUser_.DISPLAY_NAME);
			case EMAIL -> root.get(HubUser_.EMAIL);
			case STATUS -> root.get(HubUser_.STATUS);
			default -> throw new IllegalArgumentException("Unsupported string user field: " + field);
		};
	}

	/**
	 * Builds a substring or exact text-matching predicate honoring case sensitivity.
	 *
	 * @param builder the criteria builder
	 * @param raw     the text expression to match against
	 * @param filter  the filter carrying the value, operation, and case-sensitivity flag
	 * @return the predicate
	 */
	Predicate stringMatch(CriteriaBuilder builder, Expression<String> raw, FilterCriterion<HubUserField> filter) {
		Expression<String> expression = filter.caseSensitive() ? raw : builder.lower(raw);
		String value = filter.caseSensitive() ? filter.value() : filter.value().toLowerCase();
		if (filter.operation() == FilterOperation.CONTAINS) {
			return builder.like(expression, containsPattern(value));
		}
		return builder.equal(expression, value);
	}

	/**
	 * Wraps a value in SQL wildcards for a substring match.
	 *
	 * @param value the value to wrap
	 * @return the {@code like} pattern
	 */
	String containsPattern(String value) {
		return "%" + value + "%";
	}

	/**
	 * Parses a string into a {@link Long}, returning {@code null} when it is not a valid number.
	 *
	 * @param value the value to parse
	 * @return the parsed value, or {@code null} when unparseable
	 */
	Long parseLongOrNull(String value) {
		try {
			return Long.parseLong(value.trim());
		} catch (NumberFormatException e) {
			return null;
		}
	}
}
