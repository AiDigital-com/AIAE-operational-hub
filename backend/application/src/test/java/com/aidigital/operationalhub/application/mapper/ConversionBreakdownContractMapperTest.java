package com.aidigital.operationalhub.application.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.ConversionAdjustmentRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ConversionAdjustmentRowV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ConversionBreakdownRequestV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.ConversionBreakdownV1;
import com.aidigital.operationalhub.service.agency.model.ConversionBreakdownQuery;
import com.aidigital.operationalhub.service.agency.model.ConversionRowModel;
import com.aidigital.operationalhub.service.agency.model.WorkbookAdjustmentRow;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for {@link ConversionBreakdownContractMapper}.
 *
 * <p>The load-bearing one is the write direction: an edited row has to leave here shaped exactly like a
 * row read out of the spreadsheet, because that is what lets one matching-and-writing path serve both.
 */
class ConversionBreakdownContractMapperTest {

	private final ConversionBreakdownContractMapper mapper = new ConversionBreakdownContractMapper();

	@Test
	void shouldGiveTheServiceTheDateTheWayTheMartSpellsItTest() {
		// Given: a request whose date is typed, as the contract has it
		ConversionBreakdownRequestV1 request = new ConversionBreakdownRequestV1()
				.date(LocalDate.of(2026, 4, 23))
				.levelOneName("barr_SCOT_Fall Campaign_Display")
				.levelThreeName("RON-Competitive Conquesting")
				.channel("Display");

		// When:
		ConversionBreakdownQuery query = mapper.toQuery(request);

		// Then: yyyy-MM-dd, which is how the conversions view stores it - the read compares strings
		assertThat(query.date()).isEqualTo("2026-04-23");
		assertThat(query.levelOneName()).isEqualTo("barr_SCOT_Fall Campaign_Display");
		assertThat(query.levelThreeName()).isEqualTo("RON-Competitive Conquesting");
		assertThat(query.channel()).isEqualTo("Display");
	}

	@Test
	void shouldLeaveTheDateNullWhenTheRequestOmitsItTest() {
		// Given + When: a request with no date at all
		ConversionBreakdownQuery query = mapper.toQuery(new ConversionBreakdownRequestV1());

		// Then: null rather than a formatting failure - the service decides what an incomplete row means
		assertThat(query.date()).isNull();
	}

	@Test
	void shouldRenderTheRowsBehindACellTest() {
		// Given: one conversions row as the service reports it
		ConversionRowModel row = new ConversionRowModel(
				"2026-04-23", "dv_360_dlv", "And Barr", "7701360891",
				"All Pages", "not set",
				"barr_SCOT_Fall Campaign_Display", "LI-1",
				"Florida", "IO-1",
				"RON-Competitive Conquesting", "CR-1",
				4444.0);

		// When:
		ConversionBreakdownV1 breakdown = mapper.toBreakdown(List.of(row));

		// Then: identity, the two names worth reading, and the figure
		assertThat(breakdown.getRows()).hasSize(1);
		assertThat(breakdown.getRows().get(0).getConversionAction()).isEqualTo("All Pages");
		assertThat(breakdown.getRows().get(0).getConversionCategory()).isEqualTo("not set");
		assertThat(breakdown.getRows().get(0).getCreativeName()).isEqualTo("RON-Competitive Conquesting");
		assertThat(breakdown.getRows().get(0).getConversions()).isEqualTo(4444.0);
	}

	@Test
	void shouldShapeAnEditedRowLikeASpreadsheetRowTest() {
		// Given: a row edited in the report
		ConversionAdjustmentRequestV1 request = new ConversionAdjustmentRequestV1().rows(List.of(
				new ConversionAdjustmentRowV1()
						.date("2026-04-23")
						.lineItemId("LI-1")
						.insertionOrderId("IO-1")
						.creativeId("CR-1")
						.conversionAction("All Pages")
						.conversionCategory("not set")
						.conversions(4444.0)));

		// When:
		List<WorkbookAdjustmentRow> rows = mapper.toSubmittedRows(request);

		// Then: cells keyed by the template's own headers, so the row is matched by the same key an
		// uploaded row is. Nothing but the key and the figure is sent - the stored identity is taken from
		// the matched mart row, never from the request.
		assertThat(rows).hasSize(1);
		assertThat(rows.get(0).sourceRowNumber()).isEqualTo(1);
		assertThat(rows.get(0).cells())
				.containsEntry("date", "2026-04-23")
				.containsEntry("line_item_id", "LI-1")
				.containsEntry("insertion_order_id", "IO-1")
				.containsEntry("creative_id", "CR-1")
				.containsEntry("conversion_action", "All Pages")
				.containsEntry("conversion_category", "not set")
				.containsEntry("conversions", "4444.0")
				.hasSize(7);
	}

	@Test
	void shouldNumberTheSubmittedRowsFromOneTest() {
		// Given: three edited rows
		ConversionAdjustmentRequestV1 request = new ConversionAdjustmentRequestV1().rows(List.of(
				new ConversionAdjustmentRowV1().date("2026-04-23").conversions(1.0),
				new ConversionAdjustmentRowV1().date("2026-04-23").conversions(2.0),
				new ConversionAdjustmentRowV1().date("2026-04-23").conversions(3.0)));

		// When:
		List<WorkbookAdjustmentRow> rows = mapper.toSubmittedRows(request);

		// Then: the number is what an error message points at, so it has to mean the row's place in what
		// the user submitted
		assertThat(rows).extracting(WorkbookAdjustmentRow::sourceRowNumber).containsExactly(1, 2, 3);
	}

	@Test
	void shouldTreatAnAbsentRequestAsNothingToApplyTest() {
		// Given + When: no body, and a body with no rows
		List<WorkbookAdjustmentRow> fromNull = mapper.toSubmittedRows(null);
		List<WorkbookAdjustmentRow> fromEmpty = mapper.toSubmittedRows(new ConversionAdjustmentRequestV1());

		// Then: empty, not a failure - the service already short-circuits an empty submission
		assertThat(fromNull).isEmpty();
		assertThat(fromEmpty).isEmpty();
	}
}
