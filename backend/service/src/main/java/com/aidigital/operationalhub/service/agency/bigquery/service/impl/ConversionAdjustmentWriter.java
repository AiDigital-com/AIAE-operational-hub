package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.service.agency.bigquery.model.BigQueryConversionsViewColumns;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqDelete;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqInsert;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQuerySearchGateway;
import com.aidigital.operationalhub.service.agency.bigquery.service.BigQueryWriteGateway;
import com.aidigital.operationalhub.service.agency.model.CampaignModel;
import com.aidigital.operationalhub.service.agency.model.ConversionAdjustmentRowModel;
import com.aidigital.operationalhub.service.entity.HubSyncLockService;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

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
 * <p>Because it is not atomic, it is also not safely concurrent, so the pair runs under a cross-node lock
 * ({@link #WRITE_LOCK}). Without it two writers interleaving as delete, delete, insert, insert leave two
 * rows for one key, and if their stamps tie the view sums both.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ConversionAdjustmentWriter {

	/**
	 * Where the client sits in an underscore-separated constructed name, matching the position the
	 * conversions view reads {@code CNB_client} from.
	 */
	static final int CLIENT_SEGMENT = 1;

	/**
	 * Where the campaign name sits in an underscore-separated constructed name, matching the position the
	 * conversions view reads {@code CNB_campaign_name} from.
	 */
	static final int CAMPAIGN_SEGMENT = 3;

	/**
	 * The lock every conversions write takes for the length of its delete-then-insert pair.
	 *
	 * <p>One lock for every campaign rather than one per campaign, which is coarser than the hazard needs.
	 * The primitive is a conditional {@code UPDATE} on a seeded row, so a per-campaign name would need a row
	 * per campaign created on demand, and the race in creating those rows is a second concurrency problem to
	 * get right. These uploads are manual, occasional and short; two people adjusting different campaigns in
	 * the same few seconds get asked to retry, which is a fair price for a guarantee that holds across nodes.
	 */
	private static final String WRITE_LOCK = "conversion_adjustments";

	private static final String SEGMENT_SEPARATOR = "_";

	private final BigQuerySearchGateway gateway;
	private final BigQueryWriteGateway writeGateway;
	private final HubSyncLockService syncLockService;

	/**
	 * Replaces the given adjustments for an already-resolved campaign: validate, collapse to one row per
	 * key, delete those keys, insert their replacements, then drop the cached report reads a write can have
	 * changed.
	 *
	 * @param campaign    the resolved campaign
	 * @param user        the current user
	 * @param adjustments the adjustments to write
	 * @return the number of rows written
	 */
	long replaceAdjustments(
			CampaignModel campaign, CurrentUserModel user, List<ConversionAdjustmentRowModel> adjustments) {
		validateAdjustments(adjustments, campaign);
		List<ConversionAdjustmentRowModel> latestPerKey = collapseByKey(adjustments);
		if (!syncLockService.tryAcquire(WRITE_LOCK)) {
			throw new BusinessException(OperationalHubErrorReason.OPH_033);
		}
		try {
			long removed = deleteExisting(latestPerKey);
			long written = insertAll(user, latestPerKey);
			gateway.evictSearchCache();
			log.info(
					"Replaced conversion adjustments for campaign {}: {} removed, {} written",
					campaign.id(), removed, written);
			return written;
		} finally {
			syncLockService.release(WRITE_LOCK);
		}
	}

	/**
	 * Rejects a batch that cannot be written as asked: one with nothing in it, a row missing part of the
	 * identity its conversions would have to be found by, a row setting no value, or a row belonging to a
	 * campaign other than the resolved one.
	 *
	 * <p>The last of those is a boundary check, not a data-quality one. This table has no campaign columns
	 * of its own - the view splits {@code constructed_name} to derive them - so the name in the payload is
	 * the only thing deciding which campaign a written row lands in. Left unchecked, a caller with access
	 * to one campaign could adjust the conversions of any other.
	 *
	 * @param adjustments the adjustments to check
	 * @param campaign    the resolved campaign every adjustment must belong to
	 * @throws BusinessException OPH_027 when the batch cannot be written
	 */
	void validateAdjustments(List<ConversionAdjustmentRowModel> adjustments, CampaignModel campaign) {
		if (adjustments == null || adjustments.isEmpty()) {
			throw new BusinessException(OperationalHubErrorReason.OPH_027, "at least one adjustment is required");
		}
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
			requireSameCampaign(adjustment, campaign);
		}
	}

	/**
	 * Checks that an adjustment's level-1 name carries the resolved campaign's client and campaign name in
	 * the positions the view reads them from. A segment whose expected value is unknown on the resolved
	 * campaign is not checked - there is nothing to compare it against, and refusing every write in that
	 * case would block a campaign for a reason the user cannot act on.
	 *
	 * @param adjustment the adjustment to check
	 * @param campaign   the resolved campaign
	 * @throws BusinessException OPH_027 when the name belongs to another campaign
	 */
	void requireSameCampaign(ConversionAdjustmentRowModel adjustment, CampaignModel campaign) {
		if (campaign.name() == null) {
			// Nothing to compare the name against, so there is no boundary - and this table has no other.
			// Refusing costs a campaign with no name its conversions editing; allowing would let any name
			// through, including another client's.
			throw new BusinessException(
					OperationalHubErrorReason.OPH_027,
					"this campaign has no name to check an adjustment's level-1 name against");
		}
		String[] segments = adjustment.constructedName().split(SEGMENT_SEPARATOR, -1);
		boolean sameClient = matchesSegment(segments, CLIENT_SEGMENT, campaign.clientName());
		boolean sameCampaign = matchesSegment(segments, CAMPAIGN_SEGMENT, campaign.name());
		if (!sameClient || !sameCampaign) {
			throw new BusinessException(
					OperationalHubErrorReason.OPH_027,
					"'" + adjustment.constructedName() + "' does not belong to this campaign");
		}
	}

	/**
	 * Indicates whether a constructed name's given segment equals the expected value, treating an unknown
	 * expected value as a match and an absent segment as a mismatch.
	 *
	 * <p>Only the client can now be unknown here - {@link #requireSameCampaign} refuses outright when the
	 * campaign has no name - and a campaign whose client is unnamed is still bounded by the campaign
	 * segment, which is the narrower of the two.
	 *
	 * @param segments the constructed name split on its separator
	 * @param index    the segment position to compare
	 * @param expected the value the segment must equal, or {@code null} when unknown
	 * @return {@code true} when the segment matches or there is nothing to match against
	 */
	boolean matchesSegment(String[] segments, int index, String expected) {
		if (expected == null) {
			return true;
		}
		return index < segments.length && expected.equals(segments[index]);
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
