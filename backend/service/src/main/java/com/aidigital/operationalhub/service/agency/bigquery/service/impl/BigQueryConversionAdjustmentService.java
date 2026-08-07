package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.service.agency.CampaignService;
import com.aidigital.operationalhub.service.agency.ConversionAdjustmentService;
import com.aidigital.operationalhub.service.agency.bigquery.model.CampaignDeliveryScope;
import com.aidigital.operationalhub.service.agency.model.CampaignModel;
import com.aidigital.operationalhub.service.agency.model.ConversionAdjustmentRowModel;
import com.aidigital.operationalhub.service.agency.model.ConversionBreakdownQuery;
import com.aidigital.operationalhub.service.agency.model.ConversionKey;
import com.aidigital.operationalhub.service.agency.model.ConversionRowExportModel;
import com.aidigital.operationalhub.service.agency.model.ConversionRowModel;
import com.aidigital.operationalhub.service.agency.model.ReportRowDateRangeModel;
import com.aidigital.operationalhub.service.agency.model.WorkbookAdjustmentRow;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

/**
 * BigQuery-backed implementation of {@link ConversionAdjustmentService}.
 *
 * <p>Holds the boundary and the order of operations, and nothing else. Every request resolves the campaign
 * first - which is what enforces the user's visibility - and then hands off: {@link ConversionRowReader}
 * for the rows, {@link ConversionTemplateDiffer} for what an uploaded file is asking for, and
 * {@link ConversionAdjustmentWriter} for making it so. The three were one class until the write grew a lock,
 * a validator and a campaign-boundary check, at which point "read, compare, write" stopped being visible in
 * it.
 */
@Service
@RequiredArgsConstructor
public class BigQueryConversionAdjustmentService implements ConversionAdjustmentService {

	private final CampaignService campaignService;
	private final CampaignDeliveryScopeResolver scopeResolver;
	private final ConversionRowReader reader;
	private final ConversionTemplateDiffer differ;
	private final ConversionAdjustmentWriter writer;

	@Override
	public ConversionRowExportModel findConversionRows(
			CurrentUserModel user, long campaignId, ReportRowDateRangeModel dateRange) {
		CampaignDeliveryScope scope = conversionScope(user, campaignId);
		return reader.findRows(scope, dateRange);
	}

	@Override
	public List<ConversionRowModel> findConversionRowsBehind(
			CurrentUserModel user, long campaignId, ConversionBreakdownQuery query) {
		CampaignDeliveryScope scope = conversionScope(user, campaignId);
		// Whether level 3 narrows the breakdown is the report's rule, not the caller's: a client naming the
		// channel is describing its row, not asking for a matching strategy.
		boolean campaignLevel = ReportRowConversionsSql.isCampaignLevelChannel(query.channel());
		return reader.findRowsBehind(
				scope, query.date(), query.levelOneName(), query.levelThreeName(), campaignLevel);
	}

	@Override
	public int applyConversionAdjustments(
			CurrentUserModel user, long campaignId, List<WorkbookAdjustmentRow> uploadedRows) {
		CampaignDeliveryScope scope = conversionScope(user, campaignId);
		if (uploadedRows.isEmpty()) {
			// Short-circuited before the baseline read: with no rows there is nothing to narrow that read by,
			// so it would scan the campaign's entire conversions history to then diff nothing against it.
			return 0;
		}
		Map<ConversionKey, List<ConversionRowModel>> baseline = reader.baselineByKey(scope, uploadedRows);
		List<ConversionAdjustmentRowModel> models = differ.diff(uploadedRows, baseline);
		return models.isEmpty() ? 0 : (int) writer.replaceAdjustments(scope, user, models);
	}

	/**
	 * Resolves the visible Hub campaign, then builds a conversions-mart constructed-name scope using the
	 * same line-item bridge as reporting. The Hub/NetSuite campaign name can differ from the mart campaign
	 * segment, so conversion reads and writes are scoped by line-item-derived mart {@code constructed_name}
	 * values instead of by {@code CNB_campaign_name = campaign.name()}.
	 *
	 * @param user       the current user
	 * @param campaignId the campaign id
	 * @return the campaign delivery scope to use against the conversions mart
	 */
	CampaignDeliveryScope conversionScope(CurrentUserModel user, long campaignId) {
		CampaignModel campaign = campaignService.getVisibleCampaignIdentity(user, campaignId);
		return scopeResolver.forConversions(campaign);
	}
}
