package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.InsertionOrderLineItemV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.InsertionOrderV1;
import com.aidigital.operationalhub.service.agency.model.InsertionOrderModel;
import com.aidigital.operationalhub.service.agency.model.LineItemModel;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Maps insertion order/line item service models into the generated contract.
 */
@Component
public class InsertionOrderContractMapper {

	/**
	 * Maps a list of insertion order models into the generated contract.
	 *
	 * @param models the insertion order models
	 * @return the generated insertion order list, never {@code null}
	 */
	public List<InsertionOrderV1> toV1(List<InsertionOrderModel> models) {
		return models.stream().map(this::toV1).toList();
	}

	/**
	 * Maps a single insertion order model into the generated contract.
	 *
	 * @param model the insertion order model
	 * @return the generated insertion order V1
	 */
	InsertionOrderV1 toV1(InsertionOrderModel model) {
		InsertionOrderV1 v1 = new InsertionOrderV1();
		v1.setOrderId(model.orderId());
		v1.setOrderNumber(model.orderNumber());
		v1.setStatus(model.status());
		v1.setStartDate(model.startDate());
		v1.setEndDate(model.endDate());
		v1.setBudget(model.budget());
		v1.setMediaTactics(model.mediaTactics() == null ? List.of() : model.mediaTactics());
		v1.setLineItems(model.lineItems() == null ? List.of() : model.lineItems().stream().map(this::toV1).toList());
		return v1;
	}

	/**
	 * Maps a single line item model into the generated contract.
	 *
	 * @param model the line item model
	 * @return the generated line item V1
	 */
	InsertionOrderLineItemV1 toV1(LineItemModel model) {
		InsertionOrderLineItemV1 v1 = new InsertionOrderLineItemV1();
		v1.setLineItemId(model.lineItemId());
		v1.setDescription(model.description());
		v1.setMediaTactic(model.mediaTactic());
		v1.setRateType(model.rateType());
		v1.setBudget(model.budget());
		v1.setStartDate(model.startDate());
		v1.setEndDate(model.endDate());
		return v1;
	}
}
