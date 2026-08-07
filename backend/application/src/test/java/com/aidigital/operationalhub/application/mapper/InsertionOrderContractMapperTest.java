package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.InsertionOrderLineItemV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.InsertionOrderV1;
import com.aidigital.operationalhub.service.agency.model.InsertionOrderModel;
import com.aidigital.operationalhub.service.agency.model.LineItemModel;
import org.instancio.Instancio;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link InsertionOrderContractMapper}.
 */
class InsertionOrderContractMapperTest {

	private final InsertionOrderContractMapper mapper = new InsertionOrderContractMapper();

	@Test
	void shouldMapEveryFieldTest() {
		// Given:
		InsertionOrderModel model = Instancio.create(InsertionOrderModel.class);

		// When:
		InsertionOrderV1 v1 = mapper.toV1(model);

		// Then:
		assertThat(v1.getOrderId()).isEqualTo(model.orderId());
		assertThat(v1.getOrderNumber()).isEqualTo(model.orderNumber());
		assertThat(v1.getStatus()).isEqualTo(model.status());
		assertThat(v1.getStartDate()).isEqualTo(model.startDate());
		assertThat(v1.getEndDate()).isEqualTo(model.endDate());
		assertThat(v1.getBudget()).isEqualTo(model.budget());
		assertThat(v1.getMediaTactics()).isEqualTo(model.mediaTactics());
		assertThat(v1.getLineItems()).hasSize(model.lineItems().size());
	}

	@Test
	void shouldMapEveryLineItemFieldTest() {
		// Given:
		LineItemModel model = Instancio.create(LineItemModel.class);
		InsertionOrderModel io = new InsertionOrderModel(
				1L, "SO1", "Live", "2026-01-01", "2026-12-31", 1000.0, List.of("Display"), List.of(model));

		// When:
		InsertionOrderLineItemV1 v1 = mapper.toV1(io).getLineItems().get(0);

		// Then:
		assertThat(v1.getLineItemId()).isEqualTo(model.lineItemId());
		assertThat(v1.getDescription()).isEqualTo(model.description());
		assertThat(v1.getMediaTactic()).isEqualTo(model.mediaTactic());
		assertThat(v1.getRateType()).isEqualTo(model.rateType());
		assertThat(v1.getBudget()).isEqualTo(model.budget());
		assertThat(v1.getStartDate()).isEqualTo(model.startDate());
		assertThat(v1.getEndDate()).isEqualTo(model.endDate());
	}

	@Test
	void shouldMapNullMediaTacticsAndLineItemsToEmptyListsTest() {
		// Given:
		InsertionOrderModel model = new InsertionOrderModel(1L, "SO1", "Live", null, null, null, null, null);

		// When:
		InsertionOrderV1 v1 = mapper.toV1(model);

		// Then:
		assertThat(v1.getMediaTactics()).isEmpty();
		assertThat(v1.getLineItems()).isEmpty();
	}

	@Test
	void shouldMapAListOfInsertionOrdersTest() {
		// Given:
		List<InsertionOrderModel> models = List.of(
				Instancio.create(InsertionOrderModel.class), Instancio.create(InsertionOrderModel.class));

		// When:
		List<InsertionOrderV1> result = mapper.toV1(models);

		// Then:
		assertThat(result).hasSize(2);
	}
}
