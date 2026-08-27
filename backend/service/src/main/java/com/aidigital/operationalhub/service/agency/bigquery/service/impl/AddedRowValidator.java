package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRequest;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRow;
import com.aidigital.operationalhub.service.agency.bigquery.model.CampaignDeliveryScope;
import com.aidigital.operationalhub.service.agency.bigquery.model.ConstructedEntityLevel;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQuerySearchGateway;
import com.aidigital.operationalhub.service.agency.model.AdjustmentRowModel;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.List;

import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.ACCOUNT;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.ACCOUNT_ID;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CONSTRUCTED_ID;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CONSTRUCTED_ID_LVL2;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CONSTRUCTED_ID_LVL3;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.CONSTRUCTED_NAME;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.DATE;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns.PLATFORM;

/**
 * Resolves and validates one manually-added report row before it is written (PDI_117 V1-V8). The user
 * never types a constructed id (D1). Each of the three constructed-name levels is resolved
 * independently (D2): an existing insertion order and line item with a brand-new creative is a normal,
 * common addition, not an edge case, so a row may legitimately carry real ids at some levels and
 * generated ones at others. The client-supplied identity is never trusted outright (D5) - for every
 * level this class re-resolves the name against the campaign's own mart data itself.
 */
@Component
@RequiredArgsConstructor
class AddedRowValidator {

	private static final String ALIAS_NAME = "matched_name";
	private static final String ALIAS_ID = "matched_id";
	/** The sixteen naming-convention segments a generated level-1 name must split into (PDI_117 V6/Fact D). */
	private static final int REQUIRED_NAME_SEGMENTS = 16;

	private final BigQuerySearchGateway gateway;
	private final BigQueryProperties bigQueryProperties;
	private final ConstructedIdGenerator idGenerator;

	/**
	 * Resolves one manually-added adjustment's final identity, applying V1-V8 and returning a new model
	 * whose platform/account/account id, three names and three ids are all re-derived - never the values
	 * the client sent.
	 *
	 * @param scope      the resolved campaign delivery scope the row is being added to
	 * @param adjustment the client-submitted added row (see {@link AdjustmentRowModel#added()})
	 * @return the same row with its identity fields replaced by the resolved, validated values
	 * @throws BusinessException OPH_043-OPH_049 when any validation rule fails
	 */
	AdjustmentRowModel resolve(CampaignDeliveryScope scope, AdjustmentRowModel adjustment) {
		requireKnownDeliveryAccount(scope, adjustment);
		ConstructedLevelIdentity level1 = resolveLevel(
				scope, ConstructedEntityLevel.LVL1, adjustment.lineItemName(), adjustment.lineItemId(), true,
				adjustment.lineItemName());
		ConstructedLevelIdentity level2 = resolveLevel(
				scope, ConstructedEntityLevel.LVL2, adjustment.insertionOrderName(), adjustment.insertionOrderId(),
				false, adjustment.lineItemName());
		ConstructedLevelIdentity level3 = resolveLevel(
				scope, ConstructedEntityLevel.LVL3, adjustment.campaignConstructedName(),
				adjustment.campaignConstructedId(), false, adjustment.lineItemName());
		if (everyLevelResolvedReal(level1, level2, level3)) {
			requireNotAnOverride(scope, adjustment, level1.id(), level2.id(), level3.id());
		}
		requireUnusedKey(adjustment.date(), level1.id(), level2.id(), level3.id());
		return withIdentity(
				adjustment,
				adjustment.platform(), adjustment.account(), adjustment.accountId(),
				level1.name(), level1.id(), level2.name(), level2.id(), level3.name(), level3.id());
	}

	/**
	 * Resolves one constructed-name level independently (D2). The client's own id for that level states
	 * what it must already be true: a real (non-{@code OPH_}) id means the client believes this level is
	 * an existing entity, and V2 confirms the name actually resolves to that exact id; a blank or
	 * {@code OPH_}-prefixed id means the client believes the level is new, and V8 confirms the name
	 * really resolves to nothing before a fresh id is generated. Level 1 additionally applies V6/V7
	 * before generating.
	 *
	 * @param scope       the resolved campaign delivery scope
	 * @param level       the constructed-name level to resolve
	 * @param clientName  the level's client-submitted (still free-text, still trusted) name
	 * @param clientId    the level's client-submitted id - never trusted as a source of truth, only as a
	 *                    signal of what the client believes about this level
	 * @param isLevelOne  whether this is level 1 - gates V6/V7, which only apply there
	 * @param level1Name  the row's level-1 name, used to derive the campaign scope (D3) when a
	 *                    level-2/level-3 name needs to be generated; unused for level 1 itself
	 * @return the level's resolved identity
	 * @throws BusinessException OPH_044 (V2), OPH_047 (V6), OPH_048 (V7) or OPH_049 (V8)
	 */
	ConstructedLevelIdentity resolveLevel(
			CampaignDeliveryScope scope, ConstructedEntityLevel level, String clientName, String clientId,
			boolean isLevelOne, String level1Name) {
		List<BqRow> matches = findLevelMatches(scope, level, clientName);
		if (isRealId(clientId)) {
			return matches.stream()
					.filter(row -> clientId.equals(row.getString(ALIAS_ID)))
					.findFirst()
					.map(row -> new ConstructedLevelIdentity(row.getString(ALIAS_NAME), row.getString(ALIAS_ID)))
					.orElseThrow(() -> new BusinessException(OperationalHubErrorReason.OPH_044));
		}
		if (!matches.isEmpty()) {
			throw new BusinessException(OperationalHubErrorReason.OPH_049);
		}
		if (isLevelOne) {
			requireSixteenSegments(clientName);
			requireInheritedPrefix(scope, clientName);
			return new ConstructedLevelIdentity(clientName, idGenerator.generate(List.of(requireName(clientName))));
		}
		String campaignScopeName = idGenerator.scopeOf(requireName(level1Name));
		return new ConstructedLevelIdentity(
				clientName, idGenerator.generate(List.of(campaignScopeName, requireName(clientName))));
	}

	/**
	 * V1: the row's platform/account/account id triple must already have delivery somewhere in this
	 * campaign's mart data. Closes the read view's "vanishing row" failure mode (the added-rows branch
	 * joins on date and the three constructed ids only, with no platform/account condition), and keeps a
	 * manually-added row's platform from being free-text junk.
	 *
	 * @param scope      the resolved campaign delivery scope
	 * @param adjustment the added row
	 * @throws BusinessException OPH_043 when the triple is blank or matches no campaign delivery
	 */
	void requireKnownDeliveryAccount(CampaignDeliveryScope scope, AdjustmentRowModel adjustment) {
		if (isBlank(adjustment.platform()) || isBlank(adjustment.account()) || isBlank(adjustment.accountId())) {
			throw new BusinessException(
					OperationalHubErrorReason.OPH_043,
					adjustment.platform(), adjustment.account(), adjustment.accountId());
		}
		BqRequest request = campaignScoped(scope)
				.select(PLATFORM)
				.whereEquals(PLATFORM, adjustment.platform())
				.whereEquals(ACCOUNT, adjustment.account())
				.whereEquals(ACCOUNT_ID, adjustment.accountId())
				.limitOffset(1, 0)
				.build();
		if (gateway.fetch(request, row -> row.getString(PLATFORM)).isEmpty()) {
			throw new BusinessException(
					OperationalHubErrorReason.OPH_043,
					adjustment.platform(), adjustment.account(), adjustment.accountId());
		}
	}

	/**
	 * Finds every distinct (name, id) pair this level's exact name resolves to in the campaign's own mart
	 * data - the shared read behind V2 (does the client's real id actually belong to this name), V8 (does
	 * a "new" name really match nothing) and level 1's real-id path.
	 *
	 * @param scope the resolved campaign delivery scope
	 * @param level the constructed-name level to resolve
	 * @param name  the exact constructed name to match
	 * @return the matching (name, id) rows; empty when the name is blank or matches nothing
	 */
	List<BqRow> findLevelMatches(CampaignDeliveryScope scope, ConstructedEntityLevel level, String name) {
		if (isBlank(name)) {
			return List.of();
		}
		BqRequest request = campaignScoped(scope)
				.distinct()
				.select(level.getNameColumn(), ALIAS_NAME)
				.select(level.getIdColumn(), ALIAS_ID)
				.whereNotNull(level.getIdColumn())
				.whereEquals(level.getNameColumn(), name)
				.build();
		return gateway.fetch(request, row -> row);
	}

	/**
	 * Whether an id looks like a genuine platform id rather than a blank placeholder or a previewed
	 * {@link ConstructedIdGenerator} value - the signal for whether the client believes a level is
	 * existing (V2) or new (V8). A user can never type an id directly (D1), so a real id here can only
	 * have come from a prior resolution.
	 *
	 * @param id the id to inspect
	 * @return {@code true} when non-blank and not {@code OPH_}-namespaced
	 */
	boolean isRealId(String id) {
		return id != null && !id.isBlank() && !id.startsWith(ConstructedIdGenerator.PREFIX);
	}

	/**
	 * Whether every one of the three resolved levels came from a real mart match rather than generation -
	 * V3 (the "is this actually an override" check) only makes sense when the whole entity already
	 * exists; if any level was generated, the combined key cannot exist in the mart at all yet.
	 *
	 * @param level1 the resolved level-1 identity
	 * @param level2 the resolved level-2 identity
	 * @param level3 the resolved level-3 identity
	 * @return {@code true} when none of the three ids are {@code OPH_}-namespaced
	 */
	boolean everyLevelResolvedReal(
			ConstructedLevelIdentity level1, ConstructedLevelIdentity level2, ConstructedLevelIdentity level3) {
		return isRealId(level1.id()) && isRealId(level2.id()) && isRealId(level3.id());
	}

	/**
	 * V3: when every level resolved to a real entity, that entity must have no row on the row's own
	 * requested date already - otherwise this is an edit of an existing row, not an addition, and must go
	 * through the override path instead.
	 *
	 * @param scope      the resolved campaign delivery scope
	 * @param adjustment the added row, carrying the requested date and account id
	 * @param id1        the resolved, real level-1 id
	 * @param id2        the resolved, real level-2 id
	 * @param id3        the resolved, real level-3 id
	 * @throws BusinessException OPH_045 when a row already exists for that entity on that date
	 */
	void requireNotAnOverride(
			CampaignDeliveryScope scope, AdjustmentRowModel adjustment, String id1, String id2, String id3) {
		BqRequest request = campaignScoped(scope)
				.select(DATE)
				.whereEquals(PLATFORM, adjustment.platform())
				.whereEquals(ACCOUNT_ID, adjustment.accountId())
				.whereEquals(CONSTRUCTED_ID, id1)
				.whereEquals(CONSTRUCTED_ID_LVL2, id2)
				.whereEquals(CONSTRUCTED_ID_LVL3, id3)
				.whereEquals(DATE, adjustment.date())
				.limitOffset(1, 0)
				.build();
		if (!gateway.fetch(request, row -> row.getString(DATE)).isEmpty()) {
			throw new BusinessException(OperationalHubErrorReason.OPH_045, adjustment.date());
		}
	}

	/**
	 * V6: a generated level-1 constructed name must split into exactly sixteen underscore-separated
	 * segments - the same split the read view uses to derive an added row's whole naming-convention
	 * breakdown (Fact D). Only checked when level 1 itself is generated: real mart names legitimately
	 * have as few as one segment on some platforms (e.g. Google Ads), so the rule would falsely reject a
	 * resolved level-1 match. Runs before {@link ConstructedIdGenerator#scopeOf}, which depends on it.
	 *
	 * @param name the level-1 constructed name
	 * @throws BusinessException OPH_047 when blank or not exactly sixteen segments
	 */
	void requireSixteenSegments(String name) {
		if (isBlank(name) || name.split("_", -1).length != REQUIRED_NAME_SEGMENTS) {
			throw new BusinessException(OperationalHubErrorReason.OPH_047);
		}
	}

	/**
	 * V7: a generated level-1 name must start with the leading naming-convention segments every existing
	 * name in this campaign already agrees on, so a manually-added line cannot silently leave the
	 * campaign it was created in. A campaign with no mart rows yet (or whose rows do not agree on any
	 * leading segment) has no prefix to enforce, and this check is skipped.
	 *
	 * @param scope the resolved campaign delivery scope
	 * @param name  the level-1 constructed name
	 * @throws BusinessException OPH_048 when a non-empty prefix is known and {@code name} does not start
	 *                           with it
	 */
	void requireInheritedPrefix(CampaignDeliveryScope scope, String name) {
		String prefix = inheritedPrefix(scope);
		if (!prefix.isEmpty() && (isBlank(name) || !name.startsWith(prefix))) {
			throw new BusinessException(OperationalHubErrorReason.OPH_048, prefix);
		}
	}

	/**
	 * Computes the campaign's inherited naming prefix the same way the frontend seeds a new added row's
	 * name with one ({@code inheritedNamePrefix} in {@code frontend/src/features/pacing/mock/reports.ts}):
	 * the leading underscore-separated segments every known constructed name in the campaign agrees on,
	 * stopping at the first segment they disagree on (or that any of them leaves blank).
	 *
	 * @param scope the resolved campaign delivery scope
	 * @return the shared prefix (including its trailing underscore), or {@code ""} when nothing is shared
	 */
	String inheritedPrefix(CampaignDeliveryScope scope) {
		List<String> names = gateway.fetch(
				scope.constructedNames(), row -> row.getString(CampaignDeliveryScopeResolver.CONSTRUCTED_NAME_ALIAS));
		if (names.isEmpty()) {
			return "";
		}
		StringBuilder prefix = new StringBuilder();
		for (int index = 0; index < REQUIRED_NAME_SEGMENTS; index++) {
			String agreed = null;
			boolean allAgree = true;
			for (String name : names) {
				String[] segments = name.split("_", -1);
				String segment = index < segments.length ? segments[index] : "";
				if (segment.isBlank()) {
					allAgree = false;
					break;
				}
				if (agreed == null) {
					agreed = segment;
				} else if (!agreed.equals(segment)) {
					allAgree = false;
					break;
				}
			}
			if (!allAgree) {
				break;
			}
			prefix.append(agreed).append('_');
		}
		return prefix.toString();
	}

	/**
	 * V4: the final resolved (date, id1, id2, id3) key must not already be used anywhere in the mart -
	 * deliberately unscoped by campaign or account id, because the read view's {@code added_rows} branch
	 * joins on date and the three constructed ids only (no platform/account/account id condition, see
	 * PDI_117-PLAN.md Fact C). Applies to every added row, whatever mix of resolved/generated levels it
	 * carries: a collision from a completely different campaign or advertiser on the same date would
	 * still make the colliding row vanish from the view, so this check must see the whole mart, not just
	 * this campaign's slice of it.
	 *
	 * @param date the row's requested delivery date
	 * @param id1  the resolved level-1 id
	 * @param id2  the resolved level-2 id
	 * @param id3  the resolved level-3 id
	 * @throws BusinessException OPH_046 when the key already matches a mart row
	 */
	void requireUnusedKey(String date, String id1, String id2, String id3) {
		BqRequest request = new BqRequest.Builder()
				.from(gateway.qualify(bigQueryProperties.getAdjustmentsView()))
				.select(DATE)
				.whereEquals(DATE, date)
				.whereEquals(CONSTRUCTED_ID, id1)
				.whereEquals(CONSTRUCTED_ID_LVL2, id2)
				.whereEquals(CONSTRUCTED_ID_LVL3, id3)
				.limitOffset(1, 0)
				.build();
		if (!gateway.fetch(request, row -> row.getString(DATE)).isEmpty()) {
			throw new BusinessException(OperationalHubErrorReason.OPH_046, date);
		}
	}

	/**
	 * A fresh query builder scoped to the campaign's own constructed names, the same way every other
	 * campaign-scoped report-row read is scoped.
	 *
	 * @param scope the resolved campaign delivery scope
	 * @return a new, campaign-scoped builder
	 */
	BqRequest.Builder campaignScoped(CampaignDeliveryScope scope) {
		return new BqRequest.Builder()
				.from(gateway.qualify(bigQueryProperties.getAdjustmentsView()))
				.whereInSubquery(
						CONSTRUCTED_NAME, CampaignDeliveryScopeResolver.CONSTRUCTED_NAME_ALIAS,
						scope.constructedNames());
	}

	/**
	 * Builds the resolved row: every identity field replaced, every metric and audit field carried over
	 * unchanged from the client-submitted row.
	 *
	 * @param adjustment the original added row
	 * @param platform   the resolved platform
	 * @param account    the resolved account
	 * @param accountId  the resolved account id
	 * @param name       the resolved level-1 name
	 * @param id         the resolved level-1 id
	 * @param nameLvl2   the resolved level-2 name
	 * @param idLvl2     the resolved level-2 id
	 * @param nameLvl3   the resolved level-3 name
	 * @param idLvl3     the resolved level-3 id
	 * @return the row with its identity fields replaced
	 */
	AdjustmentRowModel withIdentity(
			AdjustmentRowModel adjustment, String platform, String account, String accountId,
			String name, String id, String nameLvl2, String idLvl2, String nameLvl3, String idLvl3) {
		return new AdjustmentRowModel(
				true,
				adjustment.date(), platform, account, accountId,
				name, id, nameLvl2, idLvl2, nameLvl3, idLvl3,
				adjustment.agencyId(), adjustment.client(), adjustment.industryCode(), adjustment.campaignName(),
				adjustment.channel(), adjustment.tactic(), adjustment.buyingModel(), adjustment.audience(),
				adjustment.uniqueLineItemId(), adjustment.other(), adjustment.geo(), adjustment.creativeTag(),
				adjustment.message(), adjustment.keywordGroup(), adjustment.flightIdentifier(), adjustment.language(),
				adjustment.impressions(), adjustment.clicks(), adjustment.spend(), adjustment.starts(),
				adjustment.firstQuartiles(), adjustment.midpoints(), adjustment.thirdQuartiles(),
				adjustment.completes(), adjustment.dynamicCost(), adjustment.linkClicks(),
				adjustment.adjustedMetrics());
	}

	/**
	 * Requires an identity name to be present before it can be matched or hashed.
	 *
	 * @param name the level's constructed name
	 * @return the same name
	 * @throws BusinessException OPH_027 when blank
	 */
	String requireName(String name) {
		if (isBlank(name)) {
			throw new BusinessException(
					OperationalHubErrorReason.OPH_027, "an added row requires a name at every level");
		}
		return name;
	}

	/**
	 * Indicates whether a string field is missing or blank.
	 *
	 * @param value the value to check
	 * @return {@code true} when {@code null} or all-whitespace
	 */
	boolean isBlank(String value) {
		return value == null || value.isBlank();
	}
}
