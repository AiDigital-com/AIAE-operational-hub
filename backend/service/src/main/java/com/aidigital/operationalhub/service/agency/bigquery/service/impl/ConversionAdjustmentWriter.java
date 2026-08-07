package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryConversionsViewColumns;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqDelete;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqInsert;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqRequest;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqSql;
import com.aidigital.operationalhub.service.agency.bigquery.model.CampaignDeliveryScope;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQuerySearchGateway;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQueryWriteGateway;
import com.aidigital.operationalhub.service.agency.model.ConversionAdjustmentRowModel;
import com.aidigital.operationalhub.service.entity.HubSyncLockService;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryConversionsViewColumns.ADJUSTED_METRICS;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryConversionsViewColumns.CONVERSIONS;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryConversionsViewColumns.CREATED_AT;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryConversionsViewColumns.CREATED_BY;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryConversionsViewColumns.LAST_MODIFIED_AT;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryConversionsViewColumns.LAST_MODIFIED_BY;
import static com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryConversionsViewColumns.NATURAL_KEY;

/**
 * Writes conversions adjustments, replacing whatever was there before.
 *
 * <p>Delete-then-insert, which is how the reporting tool this mirrors keeps its own adjustment tables
 * single-valued. BigQuery has no upsert to lean on, so the replacement is spelled out in two statements.
 *
 * <p>What it is not is the only thing standing between an edit and a doubled figure. The view reduces its
 * adjustments with a last-write-wins {@code QUALIFY} before joining them (see
 * {@link BigQueryConversionsViewColumns}), and its partition is a subset of the natural key, so two rows for
 * one key collapse to the later one there whether or not we delete. What the delete does earn is worth
 * keeping all the same: an append-only table grows a row per edit forever and is scanned in full on every
 * read; and {@code QUALIFY} keeps *every* row tied for the maximum, so two rows stamped in the same
 * microsecond would both survive and both be summed. Replacing rather than appending makes our table hold
 * one row per key by construction, which is a property worth having rather than reasoning about.
 *
 * <p>The delete is scoped to this table alone. The view unions it with the tool's own adjustments table, and
 * a hub write must not silently drop what the tool wrote - the {@code QUALIFY} decides between them by
 * timestamp, which is the intended behaviour on both sides.
 *
 * <p>The consequence to know about is that the pair is not atomic. If the delete succeeds and the insert
 * then fails, the key is left with no adjustment at all and the report falls back to the mart's own figure -
 * an edit lost, rather than a wrong number shown. That is the same failure the tool has, and it is the right
 * way round.
 *
 * <p>Because it is not atomic, it is also not safely concurrent for the same natural key, so the pair runs
 * under cross-node locks derived from those keys. Without them two writers interleaving as delete, delete,
 * insert, insert leave two rows for one key, and if their stamps tie the view sums both.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ConversionAdjustmentWriter {

	/**
	 * Prefix for conversion adjustment locks. The suffix is a hash of the row's natural key, so disjoint rows
	 * can be adjusted concurrently while overlapping rows still reject the second writer.
	 */
	private static final String WRITE_LOCK_PREFIX = "conversion_adjustments:key:";

	private static final byte LOCK_NULL_MARKER = 1;

	private static final byte LOCK_VALUE_MARKER = 2;

	private final BigQuerySearchGateway gateway;
	private final BigQueryWriteGateway writeGateway;
	private final HubSyncLockService syncLockService;

	/**
	 * Replaces the given adjustments for an already-resolved campaign: validate, collapse to one row per
	 * key, delete those keys, insert their replacements, then drop the cached report reads a write can have
	 * changed.
	 *
	 * @param scope       the resolved campaign delivery scope
	 * @param user        the current user
	 * @param adjustments the adjustments to write
	 * @return the number of rows written
	 */
	long replaceAdjustments(
			CampaignDeliveryScope scope, CurrentUserModel user, List<ConversionAdjustmentRowModel> adjustments) {
		validateAdjustments(adjustments, scope);
		List<ConversionAdjustmentRowModel> latestPerKey = collapseByKey(adjustments);
		List<String> acquiredLocks = acquireLocks(lockNames(latestPerKey));
		try {
			long removed = deleteExisting(latestPerKey);
			long written = insertAll(user, latestPerKey);
			gateway.evictSearchCache();
			log.info(
					"Replaced conversion adjustments for campaign {}: {} removed, {} written",
					scope.campaign().id(), removed, written);
			return written;
		} finally {
			releaseLocks(acquiredLocks);
		}
	}

	/**
	 * Acquires every lock in a stable order, releasing any earlier acquisitions if a later key is already
	 * being written by another node.
	 *
	 * @param lockNames the lock names to acquire
	 * @return the lock names this call acquired
	 * @throws BusinessException OPH_033 when any overlapping conversion key is already being written
	 */
	List<String> acquireLocks(List<String> lockNames) {
		List<String> acquiredLocks = new ArrayList<>();
		for (String lockName : lockNames) {
			if (!syncLockService.tryAcquire(lockName)) {
				releaseLocks(acquiredLocks);
				throw new BusinessException(OperationalHubErrorReason.OPH_033);
			}
			acquiredLocks.add(lockName);
		}
		return acquiredLocks;
	}

	/**
	 * Releases acquired locks in reverse order, best-effort, so one failed release does not prevent the rest
	 * from being made available again.
	 *
	 * @param lockNames the lock names to release
	 */
	void releaseLocks(List<String> lockNames) {
		for (int i = lockNames.size() - 1; i >= 0; i--) {
			String lockName = lockNames.get(i);
			try {
				syncLockService.release(lockName);
			} catch (RuntimeException ex) {
				log.warn("Failed to release conversion adjustment lock {}", lockName, ex);
			}
		}
	}

	/**
	 * Builds the distinct lock names required by a batch, sorted so concurrent requests that touch multiple
	 * keys acquire them in the same order.
	 *
	 * @param adjustments the collapsed adjustments to lock
	 * @return stable lock names for the natural keys in this batch
	 */
	List<String> lockNames(List<ConversionAdjustmentRowModel> adjustments) {
		return adjustments.stream()
				.map(adjustment -> lockName(keyValues(adjustment)))
				.distinct()
				.sorted()
				.toList();
	}

	/**
	 * Builds a non-reversible, deterministic lock name for one conversion natural key.
	 *
	 * @param keyValues one row's natural-key values
	 * @return the lock name stored in {@code hub_sync_lock}
	 */
	String lockName(List<String> keyValues) {
		return WRITE_LOCK_PREFIX + digest(keyValues);
	}

	/**
	 * Hashes natural-key values with explicit null/value markers and value lengths so different key shapes
	 * cannot collide before hashing through string concatenation ambiguity.
	 *
	 * @param keyValues one row's natural-key values
	 * @return lowercase SHA-256 hex
	 */
	String digest(List<String> keyValues) {
		try {
			MessageDigest digest = MessageDigest.getInstance("SHA-256");
			for (String keyValue : keyValues) {
				if (keyValue == null) {
					digest.update(LOCK_NULL_MARKER);
				} else {
					byte[] value = keyValue.getBytes(StandardCharsets.UTF_8);
					digest.update(LOCK_VALUE_MARKER);
					digest.update(ByteBuffer.allocate(Integer.BYTES).putInt(value.length).array());
					digest.update(value);
				}
			}
			return bytesToHex(digest.digest());
		} catch (NoSuchAlgorithmException ex) {
			throw new IllegalStateException("SHA-256 is not available", ex);
		}
	}

	/**
	 * Converts bytes to lowercase hexadecimal text.
	 *
	 * @param bytes the bytes to encode
	 * @return lowercase hex
	 */
	String bytesToHex(byte[] bytes) {
		StringBuilder hex = new StringBuilder(bytes.length * 2);
		for (byte value : bytes) {
			hex.append(Character.forDigit((value >> 4) & 0xF, 16));
			hex.append(Character.forDigit(value & 0xF, 16));
		}
		return hex.toString();
	}

	/**
	 * Rejects a batch that cannot be written as asked: one with nothing in it, a row missing part of the
	 * identity its conversions would have to be found by, a row setting no value, or a row whose mart
	 * constructed name is outside the resolved campaign scope.
	 *
	 * <p>The last of those is a boundary check, not a data-quality one. This table has no campaign columns
	 * of its own - the view splits {@code constructed_name} to derive them - so the name in the payload is
	 * the only thing deciding which campaign a written row lands in. Left unchecked, a caller with access
	 * to one campaign could adjust the conversions of any other. The boundary is the same line-item-derived
	 * mart constructed-name scope that reporting uses, not the Hub/NetSuite campaign name, because those
	 * names do not always match the mart segment.
	 *
	 * @param adjustments the adjustments to check
	 * @param scope       the resolved campaign delivery scope every adjustment must belong to
	 * @throws BusinessException OPH_027 when the batch cannot be written
	 */
	void validateAdjustments(List<ConversionAdjustmentRowModel> adjustments, CampaignDeliveryScope scope) {
		if (adjustments == null || adjustments.isEmpty()) {
			throw new BusinessException(OperationalHubErrorReason.OPH_027, "at least one adjustment is required");
		}
		Set<String> requestedConstructedNames = new LinkedHashSet<>();
		for (ConversionAdjustmentRowModel adjustment : adjustments) {
			if (isBlank(adjustment.date()) || isBlank(adjustment.constructedName())
					|| isBlank(adjustment.conversionAction())) {
				throw new BusinessException(
						OperationalHubErrorReason.OPH_027,
						"a conversion adjustment requires a date, a level-1 name and a conversion action");
			}
			if (adjustment.conversions() == null) {
				throw new BusinessException(
						OperationalHubErrorReason.OPH_027, "a conversion adjustment must set a conversions value");
			}
			AdjustmentValueValidator.requireIsoDateValue(adjustment.date(), "conversion adjustment date");
			AdjustmentValueValidator.requireFiniteNonNegative(CONVERSIONS, adjustment.conversions());
			requestedConstructedNames.add(adjustment.constructedName());
		}
		requireScopedConstructedNames(requestedConstructedNames, scope);
	}

	/**
	 * Checks that every adjustment's level-1 name is part of the campaign's mart delivery scope. The scope
	 * itself is derived from NetSuite line item ids, so this keeps writes aligned with report-builder reads
	 * even when the Hub campaign/client names differ from the mart naming segments.
	 *
	 * @param requestedConstructedNames the requested level-1 names
	 * @param scope                     the resolved campaign delivery scope
	 * @throws BusinessException OPH_027 when a name belongs outside this campaign
	 */
	void requireScopedConstructedNames(Set<String> requestedConstructedNames, CampaignDeliveryScope scope) {
		Set<String> allowedConstructedNames = fetchAllowedConstructedNames(scope, requestedConstructedNames);
		for (String constructedName : requestedConstructedNames) {
			if (!allowedConstructedNames.contains(constructedName)) {
				throw new BusinessException(
						OperationalHubErrorReason.OPH_027,
						"'" + constructedName + "' does not belong to this campaign");
			}
		}
	}

	/**
	 * Reads the scoped level-1 names needed by this write, narrowed to the requested names so a campaign
	 * with a large delivery history does not have to fetch the whole scope for a small edit.
	 *
	 * @param scope                     the resolved campaign delivery scope
	 * @param requestedConstructedNames names present in the write request
	 * @return names that are both requested and allowed by the campaign scope
	 */
	Set<String> fetchAllowedConstructedNames(
			CampaignDeliveryScope scope, Set<String> requestedConstructedNames) {
		if (requestedConstructedNames.isEmpty()) {
			return Set.of();
		}
		BqRequest request = new BqRequest.Builder()
				.from(scope.constructedNames())
				.select(CampaignDeliveryScopeResolver.CONSTRUCTED_NAME_ALIAS)
				.whereInStrings(
						CampaignDeliveryScopeResolver.CONSTRUCTED_NAME_ALIAS,
						List.copyOf(requestedConstructedNames))
				.orderBy(BqSql.col(CampaignDeliveryScopeResolver.CONSTRUCTED_NAME_ALIAS))
				.build();
		return new LinkedHashSet<>(gateway.fetch(
				request, row -> row.getString(CampaignDeliveryScopeResolver.CONSTRUCTED_NAME_ALIAS)));
	}

	/**
	 * Reduces the batch to one adjustment per key, keeping the last one given.
	 *
	 * <p>Two rows for one key in a single request would otherwise both be inserted after one delete, and
	 * both would then carry the same {@code last_modified_at} - so not even a last-write-wins reader could
	 * separate them. Collapsing here means a spreadsheet that names the same day, line item and action
	 * twice resolves to the value further down it, rather than to the sum of the two.
	 *
	 * @param adjustments the adjustments as given
	 * @return one adjustment per key, in the order the keys first appeared
	 */
	List<ConversionAdjustmentRowModel> collapseByKey(List<ConversionAdjustmentRowModel> adjustments) {
		Map<List<String>, ConversionAdjustmentRowModel> byKey = new LinkedHashMap<>();
		for (ConversionAdjustmentRowModel adjustment : adjustments) {
			byKey.put(keyValues(adjustment), adjustment);
		}
		return List.copyOf(byKey.values());
	}

	/**
	 * Removes whatever adjustment rows already exist for the given keys, so the insert that follows
	 * replaces them instead of adding to them.
	 *
	 * @param adjustments the adjustments about to be written, one per key
	 * @return the number of rows removed across every batch
	 */
	long deleteExisting(List<ConversionAdjustmentRowModel> adjustments) {
		BqDelete.Builder delete = new BqDelete.Builder()
				.from(writeGateway.conversionsWriteTable())
				.keyColumns(NATURAL_KEY)
				// The identity we hold was read through the view, which emits COALESCE(col, 'not set'). So a
				// value of 'not set' here may be a NULL in the table, and an exact-match delete would miss the
				// row it means to replace - leaving the insert to add a second one for the same key. Text
				// columns only: the date is a DATE, and BigQuery rejects COALESCE(DATE, 'not set') outright.
				.absentAs(
						BigQueryConversionsViewColumns.ABSENT_VALUE,
						BigQueryConversionsViewColumns.TEXT_NATURAL_KEY);
		for (ConversionAdjustmentRowModel adjustment : adjustments) {
			delete.addKey(keyValues(adjustment));
		}
		long removed = 0;
		for (BqDelete batch : delete.buildBatches(BqInsert.MAX_STATEMENT_BYTES)) {
			removed += writeGateway.delete(batch);
		}
		return removed;
	}

	/**
	 * Appends the given adjustments, split across as many INSERT jobs as
	 * {@link BqInsert.Builder#buildBatches(int)} decides are needed to stay under BigQuery's
	 * statement-length limit.
	 *
	 * @param user        the current user, stamped into created_by/last_modified_by
	 * @param adjustments the adjustments to write, one per key
	 * @return the number of rows written across every batch
	 */
	long insertAll(CurrentUserModel user, List<ConversionAdjustmentRowModel> adjustments) {
		BqInsert.Builder insert = new BqInsert.Builder()
				.into(writeGateway.conversionsWriteTable())
				.columns(adjustmentColumns());
		for (ConversionAdjustmentRowModel adjustment : adjustments) {
			insert.addRow(toAdjustmentColumns(user, adjustment));
		}
		long written = 0;
		for (BqInsert batch : insert.buildBatches(BqInsert.MAX_STATEMENT_BYTES)) {
			written += writeGateway.insert(batch);
		}
		return written;
	}

	/**
	 * The whitelisted, fixed-order column list every adjustment row's rendered values (see
	 * {@link #toAdjustmentColumns}) are positionally aligned to: the natural key, the one metric written,
	 * and the audit columns.
	 *
	 * <p>The six metrics not listed are left out rather than written as zero. The view falls back to the
	 * mart's own value for any metric an adjustment leaves null, and zero would instead assert that the day
	 * had none.
	 *
	 * @return the conversions write table's writable columns, in order
	 */
	List<String> adjustmentColumns() {
		List<String> columns = new ArrayList<>(NATURAL_KEY);
		columns.add(CONVERSIONS);
		columns.add(ADJUSTED_METRICS);
		columns.add(CREATED_AT);
		columns.add(CREATED_BY);
		columns.add(LAST_MODIFIED_AT);
		columns.add(LAST_MODIFIED_BY);
		return List.copyOf(columns);
	}

	/**
	 * Renders one adjustment's values, positionally aligned to {@link #adjustmentColumns()}. The
	 * created/last-modified stamps are the current user's email and a server-evaluated
	 * {@code CURRENT_DATETIME()}, never a client-supplied timestamp.
	 *
	 * @param user       the current user
	 * @param adjustment the adjustment to render
	 * @return the rendered row values, in {@link #adjustmentColumns()} order
	 */
	List<String> toAdjustmentColumns(CurrentUserModel user, ConversionAdjustmentRowModel adjustment) {
		String userEmail = BqInsert.stringValue(user.email());
		String now = BqInsert.currentTimestamp();
		List<String> values = new ArrayList<>();
		keyValues(adjustment).forEach(value -> values.add(BqInsert.stringValue(value)));
		values.add(BqInsert.numberValue(adjustment.conversions()));
		values.add(BqInsert.stringValue(adjustment.adjustedMetrics()));
		values.add(now);
		values.add(userEmail);
		values.add(now);
		values.add(userEmail);
		return List.copyOf(values);
	}

	/**
	 * One adjustment's raw key values in {@link BigQueryConversionsViewColumns#NATURAL_KEY} order - read by
	 * the delete that removes the row, the insert that writes it, and the collapse that decides two
	 * adjustments are about the same row, so all three agree on what a key is by construction.
	 *
	 * <p>{@link Arrays#asList} rather than {@link List#of}: an absent level is a legitimate key value here,
	 * and it has to survive as {@code null} all the way through. The delete turns it into {@code IS NULL},
	 * the insert writes {@code NULL} back, and the collapse compares it as unequal to any value - three
	 * behaviours that all depend on the null not having been flattened into a placeholder on the way in.
	 *
	 * @param adjustment the adjustment to read
	 * @return the key values, in natural-key order, nulls preserved
	 */
	List<String> keyValues(ConversionAdjustmentRowModel adjustment) {
		return Arrays.asList(
				adjustment.date(),
				adjustment.platform(),
				adjustment.account(),
				adjustment.accountId(),
				adjustment.conversionAction(),
				adjustment.conversionCategory(),
				adjustment.constructedName(),
				adjustment.constructedId(),
				adjustment.constructedNameLvl2(),
				adjustment.constructedIdLvl2(),
				adjustment.constructedNameLvl3(),
				adjustment.constructedIdLvl3());
	}

	/**
	 * Indicates whether a value is absent or whitespace only.
	 *
	 * @param value the value to test
	 * @return {@code true} when the value carries nothing usable
	 */
	boolean isBlank(String value) {
		return value == null || value.isBlank();
	}
}
