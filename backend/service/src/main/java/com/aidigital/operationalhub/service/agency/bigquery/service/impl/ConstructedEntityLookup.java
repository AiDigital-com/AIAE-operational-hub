package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqPage;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRequest;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRow;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqSql;
import com.aidigital.operationalhub.service.agency.bigquery.model.CampaignDeliveryScope;
import com.aidigital.operationalhub.service.agency.bigquery.model.ConstructedEntityLevel;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQuerySearchGateway;
import com.aidigital.operationalhub.service.agency.model.ConstructedEntity;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Optional;

import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.ACCOUNT_ID;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CONSTRUCTED_NAME;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.DATE;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.IMPRESSIONS;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.PLATFORM;

/**
 * Resolves an Add Line typed name against the campaign's own mart entities at one constructed-name level
 * (PDI_117 mode A - the name is still typed, but its id is resolved server-side rather than typed).
 * Every query is scoped to the campaign the same way {@link BigQueryReportRowService} scopes report rows
 * - through {@link CampaignDeliveryScope}'s constructed-name subquery - so a resolution can never match
 * an entity outside the campaign it was typed in.
 */
@Component
@RequiredArgsConstructor
class ConstructedEntityLookup {

	private static final String ALIAS_NAME = "entity_name";
	private static final String ALIAS_ID = "entity_id";
	private static final String ALIAS_FIRST_DATE = "first_date";
	private static final String ALIAS_LAST_DATE = "last_date";
	private static final String ALIAS_IMPRESSIONS = "entity_impressions";

	private final BigQuerySearchGateway gateway;
	private final BigQueryProperties bigQueryProperties;

	/**
	 * Returns one page of one level's constructed entities matching an exact typed name, optionally
	 * narrowed by platform and account id. Grouped by (name, id) rather than filtered to one id, because
	 * the same name can carry several distinct ids (PDI_117-PLAN.md 2.1) - every match is returned, with
	 * the date range and impressions a disambiguation popover needs to tell them apart.
	 *
	 * @param scope      the resolved campaign delivery scope
	 * @param level      the constructed-name level to resolve at
	 * @param platform   the platform to narrow to, or {@code null}/blank for every platform
	 * @param accountId  the platform account id to narrow to, or {@code null}/blank for every account
	 * @param name       the exact constructed name to resolve, or {@code null}/blank to match every entity
	 *                   at this level - used as a lightweight "does this campaign have any data at this
	 *                   level yet" probe (a bounded {@code pageSize} keeps it cheap), not as a browsing UI
	 * @param pageNumber the one-based page number
	 * @param pageSize   the page size
	 * @return the requested page of matching entities, ordered by name
	 */
	Page<ConstructedEntity> findEntities(
			CampaignDeliveryScope scope, ConstructedEntityLevel level, String platform, String accountId,
			String name, int pageNumber, int pageSize) {
		BqRequest.Builder query = new BqRequest.Builder()
				.from(gateway.qualify(bigQueryProperties.getAdjustmentsView()))
				.whereInSubquery(
						CONSTRUCTED_NAME, CampaignDeliveryScopeResolver.CONSTRUCTED_NAME_ALIAS,
						scope.constructedNames())
				.whereBeforeCurrentDate(DATE)
				.whereNotNull(level.getIdColumn())
				.select(level.getNameColumn(), ALIAS_NAME)
				.select(level.getIdColumn(), ALIAS_ID)
				.selectMin(DATE, ALIAS_FIRST_DATE)
				.selectMax(DATE, ALIAS_LAST_DATE)
				.selectSum(IMPRESSIONS, ALIAS_IMPRESSIONS)
				.withTotalCount(level.getIdColumn())
				.countDistinct(level.getIdColumn())
				.groupBy(level.getNameColumn())
				.groupBy(level.getIdColumn())
				.whereEquals(level.getNameColumn(), blankToNull(name))
				.whereEquals(PLATFORM, blankToNull(platform))
				.whereEquals(ACCOUNT_ID, blankToNull(accountId))
				.orderBy(BqSql.col(level.getNameColumn()))
				.page(pageNumber, pageSize);
		BqPage<ConstructedEntity> page =
				gateway.fetchPage(query.build(), query::buildCount, pageNumber, this::toEntity);
		return new PageImpl<>(page.content(), PageRequest.of(pageNumber - 1, pageSize), page.total());
	}

	/**
	 * Looks up the single mart id an exact, campaign-scoped name resolves to - used to preview a mode B
	 * name that happens to already match a real, unambiguous mart entity (see
	 * {@link BigQueryReportRowService#previewConstructedIds}). A name that matches zero or more than one
	 * id is left for mode B to generate a fresh id for, rather than guessing which one the user meant.
	 *
	 * @param scope the resolved campaign delivery scope
	 * @param level the constructed-name level to look the name up at
	 * @param name  the exact constructed name to match
	 * @return the single matching id, or empty when the name matches zero or several ids
	 */
	Optional<String> findSingleExistingId(CampaignDeliveryScope scope, ConstructedEntityLevel level, String name) {
		if (name == null || name.isBlank()) {
			return Optional.empty();
		}
		BqRequest request = new BqRequest.Builder()
				.from(gateway.qualify(bigQueryProperties.getAdjustmentsView()))
				.whereInSubquery(
						CONSTRUCTED_NAME, CampaignDeliveryScopeResolver.CONSTRUCTED_NAME_ALIAS,
						scope.constructedNames())
				.whereBeforeCurrentDate(DATE)
				.whereNotNull(level.getIdColumn())
				.distinct()
				.select(level.getIdColumn(), ALIAS_ID)
				.whereEquals(level.getNameColumn(), name)
				.limitOffset(2, 0)
				.build();
		List<String> ids = gateway.fetch(request, row -> row.getString(ALIAS_ID));
		return ids.size() == 1 ? Optional.ofNullable(ids.get(0)) : Optional.empty();
	}

	/**
	 * Maps one grouped mart row into a {@link ConstructedEntity}.
	 *
	 * @param row the result row
	 * @return the mapped entity
	 */
	ConstructedEntity toEntity(BqRow row) {
		return new ConstructedEntity(
				row.getString(ALIAS_NAME), row.getString(ALIAS_ID), row.getString(ALIAS_FIRST_DATE),
				row.getString(ALIAS_LAST_DATE), row.getLong(ALIAS_IMPRESSIONS));
	}

	/**
	 * Normalizes a blank optional query parameter to {@code null}, so {@link BqRequest.Builder#whereEquals}
	 * treats it as absent rather than matching the literal empty string.
	 *
	 * @param value the raw optional parameter
	 * @return {@code null} when blank, the value unchanged otherwise
	 */
	String blankToNull(String value) {
		return value == null || value.isBlank() ? null : value;
	}
}
