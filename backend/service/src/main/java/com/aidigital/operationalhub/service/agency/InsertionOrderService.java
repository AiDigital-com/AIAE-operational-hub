package com.aidigital.operationalhub.service.agency;

import com.aidigital.operationalhub.service.agency.model.InsertionOrderModel;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;

import java.util.List;

/**
 * Reads a campaign's real insertion orders and line items from BigQuery (the IO Lines table).
 *
 * <p>Implementations resolve and enforce the campaign's RBAC visibility before reading, exactly like
 * {@link ReportRowService}.
 */
public interface InsertionOrderService {

	/**
	 * Returns one campaign's insertion orders, each with its real line items, ordered by
	 * {@code order_id} then {@code line_item_id}.
	 *
	 * @param user       the current user
	 * @param campaignId the campaign id
	 * @return the campaign's insertion orders, never {@code null}
	 * @throws com.aidigital.operationalhub.service.exception.BusinessException OPH_025 when the
	 *                                                                          campaign is unknown or
	 *                                                                          not visible to the user,
	 *                                                                          OPH_018 when the BigQuery
	 *                                                                          read fails
	 */
	List<InsertionOrderModel> findCampaignInsertionOrders(CurrentUserModel user, long campaignId);
}
