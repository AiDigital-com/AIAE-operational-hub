package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.service.agency.AdjustmentRollbackLimits;
import com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryAdjustmentsViewColumns;
import com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryConversionsViewColumns;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqDelete;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqInsert;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRequest;
import com.aidigital.operationalhub.service.agency.bigquery.model.CampaignDeliveryScope;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQuerySearchGateway;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQueryWriteGateway;
import com.aidigital.operationalhub.service.agency.model.AdjustmentRollbackResultModel;
import com.aidigital.operationalhub.service.entity.HubSyncLockService;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Rolls back the Hub's own manual adjustments for a resolved campaign scope and date window - "rollback"
 * meaning {@code DELETE} the Hub-owned overlay row, never a restore, because nothing was ever destroyed:
 * {@code platform_mart}/{@code conversions_mart} are immutable facts the read views merge an overlay
 * over, and removing the overlay simply lets the raw mart figure show through again on the next read.
 *
 * <p>Modelled directly on {@link ConversionAdjustmentWriter}: same locking style (one coarse lock here,
 * since the key set a rollback touches is unbounded rather than a handful of edited rows), same batching
 * via {@link BqDelete.Builder#buildBatches(int)}, same delete-by-key discipline. It does not add a
 * scope-based form to {@link BqDelete} - see that class's Javadoc for why - and instead resolves the
 * scope into an explicit key list first (see {@link #readKeys}), which is what keeps this inside
 * {@link BqDelete}'s own contract.
 *
 * <p>Both Hub-owned adjustment tables are in scope - delivery and conversions - because both are overlays
 * over their own immutable mart, and a rollback that only cleared one would leave a campaign half rolled
 * back. The MDA spreadsheet tool's own adjustment tables (in {@code aidigital_database}) are never read or
 * written here: a row it adjusted keeps showing after this call, by design.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AdjustmentRollbackWriter {

	/** Prefix for the one coarse per-campaign rollback lock. */
	private static final String WRITE_LOCK_PREFIX = "adjustment_rollback:campaign:";

	/**
	 * The delivery table's rollback key - the view's own {@code QUALIFY} partition key (date, account,
	 * and the three constructed ids), not the twelve-column natural key {@link ConversionAdjustmentWriter}
	 * writes by. A rollback has to remove <em>every</em> historical overlay row a resolved key could ever
	 * hold, not just the one an insert would replace, so it is keyed at the same granularity the view
	 * itself resolves conflicts at.
	 */
	private static final List<String> DELIVERY_KEY_COLUMNS = List.of(
			BigQueryAdjustmentsViewColumns.DATE,
			BigQueryAdjustmentsViewColumns.ACCOUNT_ID,
			BigQueryAdjustmentsViewColumns.CONSTRUCTED_ID,
			BigQueryAdjustmentsViewColumns.CONSTRUCTED_ID_LVL2,
			BigQueryAdjustmentsViewColumns.CONSTRUCTED_ID_LVL3);

	/**
	 * The conversions table's rollback key: {@link #DELIVERY_KEY_COLUMNS}' five columns plus the two that
	 * make a conversions row its own grain (see {@link BigQueryConversionsViewColumns}'s Javadoc on its
	 * own {@code QUALIFY} partition).
	 */
	private static final List<String> CONVERSION_KEY_COLUMNS = List.of(
			BigQueryConversionsViewColumns.DATE,
			BigQueryConversionsViewColumns.ACCOUNT_ID,
			BigQueryConversionsViewColumns.CONSTRUCTED_ID,
			BigQueryConversionsViewColumns.CONSTRUCTED_ID_LVL2,
			BigQueryConversionsViewColumns.CONSTRUCTED_ID_LVL3,
			BigQueryConversionsViewColumns.CONVERSION_ACTION,
			BigQueryConversionsViewColumns.CONVERSION_CATEGORY);

	private final BigQuerySearchGateway gateway;
	private final BigQueryWriteGateway writeGateway;
	private final HubSyncLockService syncLockService;

	/**
	 * Reports how many overlay rows a rollback of this scope would remove, without deleting anything.
	 * Runs the same validation and key read as {@link #rollback}, only stopping short of the delete - so a
	 * preview can never claim a larger or different scope than the rollback it previews.
	 *
	 * @param scope                     the resolved campaign delivery scope
	 * @param campaignConstructedNames  the requested level-1 constructed names
	 * @param constructedNamesLvl2      the optional level-2 constructed names to further narrow by, or
	 *                                  empty/{@code null} to not narrow by level 2
	 * @param constructedNamesLvl3      the optional level-3 constructed names to further narrow by,
	 *                                  independent of {@code constructedNamesLvl2}, or empty/{@code null}
	 *                                  to not narrow by level 3
	 * @param dateFrom                  the inclusive first date, as {@code yyyy-MM-dd}
	 * @param dateTo                    the inclusive last date, as {@code yyyy-MM-dd}
	 * @return the counts a rollback of this scope would remove
	 * @throws BusinessException OPH_027 on an empty/blank level-1 selection, a level-1 selection over
	 *                           {@link AdjustmentRollbackLimits#MAX_CAMPAIGN_NAMES}, a blank level-2/3
	 *                           entry, or a level-2/3 selection over the same size limit; OPH_050 on an
	 *                           out-of-scope level-1 name
	 */
	AdjustmentRollbackResultModel preview(
			CampaignDeliveryScope scope, List<String> campaignConstructedNames, List<String> constructedNamesLvl2,
			List<String> constructedNamesLvl3, String dateFrom, String dateTo) {
		List<String> resolvedNames = resolveScopedNames(scope, campaignConstructedNames);
		requireValidOptionalNames(constructedNamesLvl2);
		requireValidOptionalNames(constructedNamesLvl3);
		List<List<String>> deliveryKeys = readKeys(
				writeGateway.writeTable(), BigQueryAdjustmentsViewColumns.CONSTRUCTED_NAME,
				BigQueryAdjustmentsViewColumns.CONSTRUCTED_NAME_LVL2,
				BigQueryAdjustmentsViewColumns.CONSTRUCTED_NAME_LVL3, BigQueryAdjustmentsViewColumns.DATE,
				DELIVERY_KEY_COLUMNS, resolvedNames, constructedNamesLvl2, constructedNamesLvl3, dateFrom, dateTo);
		List<List<String>> conversionKeys = readKeys(
				writeGateway.conversionsWriteTable(), BigQueryConversionsViewColumns.CONSTRUCTED_NAME,
				BigQueryConversionsViewColumns.CONSTRUCTED_NAME_LVL2,
				BigQueryConversionsViewColumns.CONSTRUCTED_NAME_LVL3, BigQueryConversionsViewColumns.DATE,
				CONVERSION_KEY_COLUMNS, resolvedNames, constructedNamesLvl2, constructedNamesLvl3, dateFrom, dateTo);
		return new AdjustmentRollbackResultModel(deliveryKeys.size(), conversionKeys.size());
	}

	/**
	 * Removes every Hub-owned delivery and conversions overlay row for the resolved scope and date window.
	 * One coarse lock per campaign is held for the whole operation - it only stops two concurrent rollbacks
	 * doing redundant work, since the delete itself is idempotent and a concurrent insert simply means
	 * "edited after the rollback"; correctness does not depend on it the way {@link ConversionAdjustmentWriter}'s
	 * per-key locks do.
	 *
	 * @param scope                    the resolved campaign delivery scope
	 * @param campaignConstructedNames the requested level-1 constructed names
	 * @param constructedNamesLvl2     the optional level-2 constructed names to further narrow by, or
	 *                                 empty/{@code null} to not narrow by level 2
	 * @param constructedNamesLvl3     the optional level-3 constructed names to further narrow by,
	 *                                 independent of {@code constructedNamesLvl2}, or empty/{@code null}
	 *                                 to not narrow by level 3
	 * @param dateFrom                 the inclusive first date, as {@code yyyy-MM-dd}
	 * @param dateTo                   the inclusive last date, as {@code yyyy-MM-dd}
	 * @return the counts actually removed
	 * @throws BusinessException OPH_027 on an empty/blank level-1 selection, a level-1 selection over
	 *                           {@link AdjustmentRollbackLimits#MAX_CAMPAIGN_NAMES}, a blank level-2/3
	 *                           entry, or a level-2/3 selection over the same size limit; OPH_050 on an
	 *                           out-of-scope level-1 name, OPH_033 on lock contention, OPH_026 when the
	 *                           BigQuery delete fails
	 */
	AdjustmentRollbackResultModel rollback(
			CampaignDeliveryScope scope, List<String> campaignConstructedNames, List<String> constructedNamesLvl2,
			List<String> constructedNamesLvl3, String dateFrom, String dateTo) {
		List<String> resolvedNames = resolveScopedNames(scope, campaignConstructedNames);
		requireValidOptionalNames(constructedNamesLvl2);
		requireValidOptionalNames(constructedNamesLvl3);
		String lockName = lockName(scope.campaign().id());
		if (!syncLockService.tryAcquire(lockName)) {
			throw new BusinessException(OperationalHubErrorReason.OPH_033);
		}
		try {
			List<List<String>> deliveryKeys = readKeys(
					writeGateway.writeTable(), BigQueryAdjustmentsViewColumns.CONSTRUCTED_NAME,
					BigQueryAdjustmentsViewColumns.CONSTRUCTED_NAME_LVL2,
					BigQueryAdjustmentsViewColumns.CONSTRUCTED_NAME_LVL3, BigQueryAdjustmentsViewColumns.DATE,
					DELIVERY_KEY_COLUMNS, resolvedNames, constructedNamesLvl2, constructedNamesLvl3, dateFrom,
					dateTo);
			List<List<String>> conversionKeys = readKeys(
					writeGateway.conversionsWriteTable(), BigQueryConversionsViewColumns.CONSTRUCTED_NAME,
					BigQueryConversionsViewColumns.CONSTRUCTED_NAME_LVL2,
					BigQueryConversionsViewColumns.CONSTRUCTED_NAME_LVL3, BigQueryConversionsViewColumns.DATE,
					CONVERSION_KEY_COLUMNS, resolvedNames, constructedNamesLvl2, constructedNamesLvl3, dateFrom,
					dateTo);
			long deliveryRemoved = deleteKeys(writeGateway.writeTable(), DELIVERY_KEY_COLUMNS, deliveryKeys);
			long conversionRemoved =
					deleteKeys(writeGateway.conversionsWriteTable(), CONVERSION_KEY_COLUMNS, conversionKeys);
			gateway.evictSearchCache();
			log.info(
					"Rolled back adjustments for campaign {}: {} delivery rows removed, {} conversion rows removed",
					scope.campaign().id(), deliveryRemoved, conversionRemoved);
			return new AdjustmentRollbackResultModel(deliveryRemoved, conversionRemoved);
		} finally {
			syncLockService.release(lockName);
		}
	}

	/**
	 * Builds the one coarse lock name for a campaign's rollback.
	 *
	 * @param campaignId the campaign id
	 * @return the lock name stored in {@code hub_sync_lock}
	 */
	String lockName(Long campaignId) {
		return WRITE_LOCK_PREFIX + campaignId;
	}

	/**
	 * Validates the requested selection and resolves it against the campaign's own delivery scope. Never
	 * trusts the request's names outright: each one must match, case-insensitively (the MDA tool matches
	 * with {@code LOWER(...)}, so this does too), a name the campaign's own resolved scope actually
	 * contains - otherwise a crafted request could delete outside the caller's visibility.
	 *
	 * @param scope                    the resolved campaign delivery scope
	 * @param campaignConstructedNames the requested level-1 constructed names
	 * @return the requested names, unchanged, once every one has been proven in scope
	 * @throws BusinessException OPH_027 on an empty/blank selection, OPH_050 on an out-of-scope name
	 */
	List<String> resolveScopedNames(CampaignDeliveryScope scope, List<String> campaignConstructedNames) {
		requireNonBlankNames(campaignConstructedNames);
		Set<String> allowedNormalized = fetchAllowedConstructedNames(scope);
		for (String name : campaignConstructedNames) {
			if (!allowedNormalized.contains(normalize(name))) {
				throw new BusinessException(OperationalHubErrorReason.OPH_050, name);
			}
		}
		return List.copyOf(campaignConstructedNames);
	}

	/**
	 * Rejects a selection that is empty, contains a blank name, or names more level-1 campaigns than
	 * {@link AdjustmentRollbackLimits#MAX_CAMPAIGN_NAMES} - an empty selection is never interpreted as
	 * "every campaign", and an oversized one is rejected here rather than trusted to the generated
	 * request's own {@code maxItems} validation alone.
	 *
	 * @param campaignConstructedNames the requested level-1 constructed names
	 * @throws BusinessException OPH_027 on an empty/blank selection, or one over the size limit
	 */
	void requireNonBlankNames(List<String> campaignConstructedNames) {
		if (campaignConstructedNames == null || campaignConstructedNames.isEmpty()) {
			throw new BusinessException(
					OperationalHubErrorReason.OPH_027, "at least one campaign name is required");
		}
		if (campaignConstructedNames.size() > AdjustmentRollbackLimits.MAX_CAMPAIGN_NAMES) {
			throw new BusinessException(
					OperationalHubErrorReason.OPH_027,
					"at most " + AdjustmentRollbackLimits.MAX_CAMPAIGN_NAMES + " campaign names may be named");
		}
		for (String name : campaignConstructedNames) {
			if (name == null || name.isBlank()) {
				throw new BusinessException(OperationalHubErrorReason.OPH_027, "a campaign name must not be blank");
			}
		}
	}

	/**
	 * Reads every level-1 constructed name the campaign's own resolved delivery scope contains, normalized
	 * for case-insensitive membership checks.
	 *
	 * @param scope the resolved campaign delivery scope
	 * @return the scope's constructed names, lower-cased and trimmed
	 */
	Set<String> fetchAllowedConstructedNames(CampaignDeliveryScope scope) {
		BqRequest request = new BqRequest.Builder()
				.from(scope.constructedNames())
				.select(CampaignDeliveryScopeResolver.CONSTRUCTED_NAME_ALIAS)
				.build();
		Set<String> normalized = new HashSet<>();
		for (String name : gateway.fetch(
				request, row -> row.getString(CampaignDeliveryScopeResolver.CONSTRUCTED_NAME_ALIAS))) {
			normalized.add(normalize(name));
		}
		return normalized;
	}

	/**
	 * Lower-cases and trims a name for case-insensitive comparison, mirroring the MDA spreadsheet tool's
	 * own {@code LOWER(...)} matching.
	 *
	 * @param value the value to normalize, may be {@code null}
	 * @return the normalized value, or {@code null} when {@code value} is {@code null}
	 */
	String normalize(String value) {
		return value == null ? null : value.trim().toLowerCase(Locale.ROOT);
	}

	/**
	 * Rejects an optional level-2/level-3 narrowing selection that contains a blank entry or names more
	 * than {@link AdjustmentRollbackLimits#MAX_CAMPAIGN_NAMES} values - the same sanity ceiling the
	 * required level-1 selection enforces in {@link #requireNonBlankNames}. Unlike that method, an
	 * empty or {@code null} selection is valid here: it means "do not narrow by this level", not "every
	 * value". No scope membership check applies either - {@link #resolveScopedNames} is the security
	 * boundary for level 1, and levels 2/3 can only narrow an already-bounded level-1 selection, never
	 * escape it, so a name that matches nothing simply yields zero keys.
	 *
	 * @param names the optional level-2 or level-3 constructed names to validate
	 * @throws BusinessException OPH_027 on a blank entry, or a selection over the size limit
	 */
	void requireValidOptionalNames(List<String> names) {
		if (names == null || names.isEmpty()) {
			return;
		}
		if (names.size() > AdjustmentRollbackLimits.MAX_CAMPAIGN_NAMES) {
			throw new BusinessException(
					OperationalHubErrorReason.OPH_027,
					"at most " + AdjustmentRollbackLimits.MAX_CAMPAIGN_NAMES + " names may be named");
		}
		for (String name : names) {
			if (name == null || name.isBlank()) {
				throw new BusinessException(OperationalHubErrorReason.OPH_027, "a name must not be blank");
			}
		}
	}

	/**
	 * Reads the distinct rollback keys already-validated names and a date window match in one Hub adjustment
	 * table - the exact keys {@link #deleteKeys} then removes. Read from the table itself, never the view,
	 * so an absent value here is a real stored {@code NULL} rather than a view-level
	 * {@code COALESCE(col, 'not set')} placeholder - which is why no {@link BqDelete.Builder#absentAs} is
	 * needed downstream.
	 *
	 * @param table                     the qualified Hub adjustment table to read
	 * @param constructedNameColumn     the table's level-1 constructed-name column
	 * @param constructedNameLvl2Column the table's level-2 constructed-name column
	 * @param constructedNameLvl3Column the table's level-3 constructed-name column
	 * @param dateColumn                the table's date column - named explicitly rather than assumed from
	 *                                  {@code keyColumns}' own order, so reordering either key-column list
	 *                                  can never silently point the date filter at a different column
	 * @param keyColumns                the rollback key's columns, in order
	 * @param resolvedNames             the validated level-1 constructed names to match, case-insensitively
	 * @param namesLvl2                 the optional level-2 constructed names to further match by, or
	 *                                  empty/{@code null} to not narrow by level 2
	 * @param namesLvl3                 the optional level-3 constructed names to further match by, or
	 *                                  empty/{@code null} to not narrow by level 3
	 * @param dateFrom                  the inclusive first date, as {@code yyyy-MM-dd}
	 * @param dateTo                    the inclusive last date, as {@code yyyy-MM-dd}
	 * @return the distinct key tuples found, each aligned to {@code keyColumns}, nulls preserved
	 */
	List<List<String>> readKeys(
			String table, String constructedNameColumn, String constructedNameLvl2Column,
			String constructedNameLvl3Column, String dateColumn, List<String> keyColumns,
			List<String> resolvedNames, List<String> namesLvl2, List<String> namesLvl3, String dateFrom,
			String dateTo) {
		BqRequest.Builder builder = new BqRequest.Builder().distinct().from(table);
		for (String column : keyColumns) {
			builder.select(column);
		}
		builder.whereNormalizedInStrings(constructedNameColumn, resolvedNames);
		builder.whereNormalizedInStrings(constructedNameLvl2Column, namesLvl2);
		builder.whereNormalizedInStrings(constructedNameLvl3Column, namesLvl3);
		builder.whereDateBetween(dateColumn, dateFrom, dateTo);
		BqRequest request = builder.build();
		return gateway.fetch(request, row -> keyColumns.stream().map(row::getString).toList());
	}

	/**
	 * Deletes every given key from one Hub adjustment table, split across as many {@code DELETE} jobs as
	 * {@link BqDelete.Builder#buildBatches(int)} decides are needed to stay under BigQuery's
	 * statement-length limit - exactly as {@link ConversionAdjustmentWriter#deleteExisting} does. A no-op
	 * when there is nothing to delete, since {@link BqDelete.Builder#buildBatches} requires at least one key.
	 *
	 * @param table      the qualified Hub adjustment table to delete from
	 * @param keyColumns the rollback key's columns, in order
	 * @param keys       the key tuples to delete, each aligned to {@code keyColumns}
	 * @return the number of rows removed across every batch
	 */
	long deleteKeys(String table, List<String> keyColumns, List<List<String>> keys) {
		if (keys.isEmpty()) {
			return 0;
		}
		BqDelete.Builder delete = new BqDelete.Builder().from(table).keyColumns(keyColumns);
		keys.forEach(delete::addKey);
		long removed = 0;
		for (BqDelete batch : delete.buildBatches(BqInsert.MAX_STATEMENT_BYTES)) {
			removed += writeGateway.delete(batch);
		}
		return removed;
	}
}
