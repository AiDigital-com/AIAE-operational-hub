package com.aidigital.operationalhub.externalservices.pacing.impl;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.http.HttpMethod.POST;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertion;
import com.aidigital.operationalhub.externalservices.pacing.assertion.HubAssertionSigner;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDimSourceRead;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDimSourceValues;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDimSourceSuggestions;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingDimSourceUnboundName;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingSheetProbe;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/**
 * {@link PacingSheetSourceClientImpl} against a mocked Pacing service: the three sheet-source calls,
 * the signed assertion header, and the narrow failure vocabulary these endpoints answer with.
 */
class PacingSheetSourceClientImplTest {

	private static final String BASE_URL = "http://localhost:3000";
	private static final String SIGNED_HEADER = "payload.signature";
	private static final String SLUG = "nike-ss26";

	private HubAssertion assertion() {
		return new HubAssertion("me@aidigital.com", HubAssertion.KIND_ALL, List.of(), false);
	}

	private HubAssertionSigner signer(HubAssertion assertion) {
		HubAssertionSigner signer = mock(HubAssertionSigner.class);
		when(signer.sign(assertion)).thenReturn(SIGNED_HEADER);
		return signer;
	}

	@Test
	void shouldProbeSheetAndReturnItsTabsTest() {
		// Given:
		HubAssertion assertion = assertion();
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingSheetSourceClientImpl client =
				new PacingSheetSourceClientImpl(builder.build(), signer(assertion), new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/" + SLUG + "/sheet-probe"))
				.andExpect(method(POST))
				.andExpect(header(HubAssertionSigner.HEADER_NAME, SIGNED_HEADER))
				.andExpect(content().json("{\"url\":\"https://docs.google.com/spreadsheets/d/abc\"}"))
				.andRespond(withSuccess(
						"""
						{"ok":true,"spreadsheet_id":"abc","title":"Apps","tabs":[
						  {"sheet_id":0,"title":"Source","row_count":120,"col_count":7,"header_row":0,
						   "headers":["Date","Line Item"],"sample":[[46190,"Native_695346"]],
						   "grid":[["Banner"],["Date","Line Item"],["46190","Native_695346"]]}]}
						""",
						MediaType.APPLICATION_JSON));

		// When:
		PacingSheetProbe probe = client.probeSheet(assertion, SLUG, "https://docs.google.com/spreadsheets/d/abc");

		// Then:
		assertThat(probe.ok()).isTrue();
		assertThat(probe.spreadsheetId()).isEqualTo("abc");
		assertThat(probe.title()).isEqualTo("Apps");
		assertThat(probe.tabs()).hasSize(1);
		assertThat(probe.tabs().get(0).title()).isEqualTo("Source");
		assertThat(probe.tabs().get(0).rowCount()).isEqualTo(120);
		assertThat(probe.tabs().get(0).headers()).containsExactly("Date", "Line Item");
		// A date cell arrives as a number and is kept as one here - flattening belongs at the contract
		// edge, not in the client.
		assertThat(probe.tabs().get(0).sample().get(0)).containsExactly(46190, "Native_695346");
		// The raw top of the tab rides along so a wrongly detected header row can be corrected - here
		// the real headers are on row 1, under a banner.
		assertThat(probe.tabs().get(0).grid()).hasSize(3);
		assertThat(probe.tabs().get(0).grid().get(1)).containsExactly("Date", "Line Item");
		server.verify();
	}

	@Test
	void shouldReturnUnreadableAnswerWithShareAddressRatherThanThrowingTest() {
		// Given: a file nobody shared with us - the expected first answer on a new source, which Pacing
		// reports with 200 so the caller can show it as an instruction.
		HubAssertion assertion = assertion();
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingSheetSourceClientImpl client =
				new PacingSheetSourceClientImpl(builder.build(), signer(assertion), new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/" + SLUG + "/sheet-probe"))
				.andRespond(withSuccess(
						"{\"ok\":false,\"error\":\"forbidden\",\"spreadsheet_id\":\"abc\","
								+ "\"share_with\":\"pacing@aidigital.com\"}",
						MediaType.APPLICATION_JSON));

		// When:
		PacingSheetProbe probe = client.probeSheet(assertion, SLUG, "https://docs.google.com/spreadsheets/d/abc");

		// Then:
		assertThat(probe.ok()).isFalse();
		assertThat(probe.error()).isEqualTo("forbidden");
		assertThat(probe.shareWith()).isEqualTo("pacing@aidigital.com");
		assertThat(probe.tabs()).isNull();
		server.verify();
	}

	@Test
	void shouldReadUnreadableOnEmptyProbeBodyTest() {
		// Given: a quiet upstream must never read as "a readable file with no tabs" - that would invite
		// saving a source that reads nothing.
		HubAssertion assertion = assertion();
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingSheetSourceClientImpl client =
				new PacingSheetSourceClientImpl(builder.build(), signer(assertion), new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/" + SLUG + "/sheet-probe"))
				.andRespond(withSuccess("", MediaType.APPLICATION_JSON));

		// When:
		PacingSheetProbe probe = client.probeSheet(assertion, SLUG, "https://docs.google.com/spreadsheets/d/abc");

		// Then:
		assertThat(probe.ok()).isFalse();
		assertThat(probe.error()).isEqualTo("empty_response");
		assertThat(probe.tabs()).isEmpty();
		server.verify();
	}

	@Test
	void shouldListDistinctColumnValuesTest() {
		// Given:
		HubAssertion assertion = assertion();
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingSheetSourceClientImpl client =
				new PacingSheetSourceClientImpl(builder.build(), signer(assertion), new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/" + SLUG + "/dim-source-values"))
				.andExpect(method(POST))
				.andExpect(content().json(
						"{\"spreadsheet_id\":\"abc\",\"sheet_id\":0,\"columns\":[\"Line Item\"],\"header_row\":2}"))
				.andRespond(withSuccess(
						"{\"ok\":true,\"columns\":[\"Line Item\"],\"truncated\":false,\"scanned_rows\":500,"
								+ "\"values\":[{\"values\":[\"Native_695346\"],\"rows\":31446}]}",
						MediaType.APPLICATION_JSON));

		// When:
		PacingDimSourceValues values =
				client.readValues(assertion, SLUG, "abc", 0, List.of("Line Item"), 2);

		// Then:
		assertThat(values.columns()).containsExactly("Line Item");
		assertThat(values.scannedRows()).isEqualTo(500);
		assertThat(values.truncated()).isFalse();
		assertThat(values.values()).hasSize(1);
		assertThat(values.values().get(0).values()).containsExactly("Native_695346");
		assertThat(values.values().get(0).rows()).isEqualTo(31446);
		server.verify();
	}

	@Test
	void shouldEchoRequestedColumnsWhenValuesBodyIsEmptyTest() {
		// Given: a caller lines its labels up against `columns`, so an empty echo would unlabel them.
		HubAssertion assertion = assertion();
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingSheetSourceClientImpl client =
				new PacingSheetSourceClientImpl(builder.build(), signer(assertion), new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/" + SLUG + "/dim-source-values"))
				.andRespond(withSuccess("", MediaType.APPLICATION_JSON));

		// When:
		PacingDimSourceValues values = client.readValues(assertion, SLUG, "abc", 0, List.of("App/URL"), null);

		// Then:
		assertThat(values.columns()).containsExactly("App/URL");
		assertThat(values.values()).isEmpty();
		assertThat(values.scannedRows()).isZero();
		server.verify();
	}

	@Test
	void shouldReadConfiguredSourceAndReportWhatCameBackTest() {
		// Given:
		HubAssertion assertion = assertion();
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingSheetSourceClientImpl client =
				new PacingSheetSourceClientImpl(builder.build(), signer(assertion), new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/" + SLUG + "/dim-source/apps/read"))
				.andExpect(method(POST))
				.andExpect(header(HubAssertionSigner.HEADER_NAME, SIGNED_HEADER))
				.andRespond(withSuccess(
						"{\"ok\":true,\"source_id\":\"apps\",\"rows\":60073,\"unbound_rows\":4,"
								+ "\"unparsed_cells\":0,\"bytes\":2158194,\"coverage_hint\":\"2026-10-10\"}",
						MediaType.APPLICATION_JSON));

		// When:
		PacingDimSourceRead read = client.readSource(assertion, SLUG, "apps");

		// Then:
		assertThat(read.sourceId()).isEqualTo("apps");
		assertThat(read.rows()).isEqualTo(60073);
		assertThat(read.unboundRows()).isEqualTo(4);
		assertThat(read.unparsedCells()).isZero();
		assertThat(read.bytes()).isEqualTo(2158194L);
		assertThat(read.coverageHint()).isEqualTo("2026-10-10");
		server.verify();
	}

	@Test
	void shouldReportZeroesWithTheSourceIdWhenReadBodyIsEmptyTest() {
		// Given: an empty tab is a real outcome, but it must still name the source it is about.
		HubAssertion assertion = assertion();
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingSheetSourceClientImpl client =
				new PacingSheetSourceClientImpl(builder.build(), signer(assertion), new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/" + SLUG + "/dim-source/apps/read"))
				.andRespond(withSuccess("", MediaType.APPLICATION_JSON));

		// When:
		PacingDimSourceRead read = client.readSource(assertion, SLUG, "apps");

		// Then:
		assertThat(read.sourceId()).isEqualTo("apps");
		assertThat(read.rows()).isZero();
		assertThat(read.coverageHint()).isNull();
		server.verify();
	}

	@ParameterizedTest
	@CsvSource({
			"404, UPSTREAM_NOT_FOUND",
			"429, UPSTREAM_RATE_LIMITED",
			"418, OTHER",
	})
	void shouldMapNonSuccessStatusesToTheirReasonsTest(int status, PacingFailureReason expected) {
		// Given:
		HubAssertion assertion = assertion();
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingSheetSourceClientImpl client =
				new PacingSheetSourceClientImpl(builder.build(), signer(assertion), new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/" + SLUG + "/sheet-probe"))
				.andRespond(withStatus(HttpStatus.valueOf(status)));

		// When / Then:
		assertThatThrownBy(() -> client.probeSheet(assertion, SLUG, "https://docs.google.com/spreadsheets/d/abc"))
				.isInstanceOf(PacingExternalException.class)
				.extracting("reason")
				.isEqualTo(expected);
		server.verify();
	}

	@Test
	void shouldForwardPacingsOwnDetailOnBadRequestTest() {
		// Given: a 400 here names the part of the request that was wrong, which is the difference
		// between a usable message and "bad request".
		HubAssertion assertion = assertion();
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingSheetSourceClientImpl client =
				new PacingSheetSourceClientImpl(builder.build(), signer(assertion), new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/" + SLUG + "/dim-source-values"))
				.andRespond(withStatus(HttpStatus.BAD_REQUEST)
						.body("{\"error\":\"bad_columns\",\"detail\":\"columns must be 1-3 headers\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When / Then:
		assertThatThrownBy(() -> client.readValues(assertion, SLUG, "abc", 0, List.of(), null))
				.isInstanceOf(PacingExternalException.class)
				.hasMessageContaining("HTTP 400")
				.extracting("detail")
				.isEqualTo("columns must be 1-3 headers");
		server.verify();
	}

	@Test
	void shouldDescribeAnErrorCodeWhenA400CarriesNoDetailTest() {
		// Given:
		HubAssertion assertion = assertion();
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingSheetSourceClientImpl client =
				new PacingSheetSourceClientImpl(builder.build(), signer(assertion), new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/" + SLUG + "/sheet-probe"))
				.andRespond(withStatus(HttpStatus.BAD_REQUEST)
						.body("{\"error\":\"bad_url\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When / Then:
		assertThatThrownBy(() -> client.probeSheet(assertion, SLUG, "not-a-link"))
				.isInstanceOf(PacingExternalException.class)
				.extracting("detail")
				.isEqualTo("that does not look like a Google Sheets link");
		server.verify();
	}

	@Test
	void shouldFallBackToTheRawCodeForAnUnknownErrorTest() {
		// Given: a code added on the Pacing side without a Hub-side update must still surface as
		// something rather than as a blank message.
		HubAssertion assertion = assertion();
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingSheetSourceClientImpl client =
				new PacingSheetSourceClientImpl(builder.build(), signer(assertion), new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/" + SLUG + "/sheet-probe"))
				.andRespond(withStatus(HttpStatus.BAD_REQUEST)
						.body("{\"error\":\"brand_new_code\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When / Then:
		assertThatThrownBy(() -> client.probeSheet(assertion, SLUG, "x"))
				.isInstanceOf(PacingExternalException.class)
				.extracting("detail")
				.isEqualTo("brand_new_code");
		server.verify();
	}

	@Test
	void shouldSayInvalidRequestWhenA400CarriesNothingAtAllTest() {
		// Given:
		HubAssertion assertion = assertion();
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingSheetSourceClientImpl client =
				new PacingSheetSourceClientImpl(builder.build(), signer(assertion), new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/" + SLUG + "/sheet-probe"))
				.andRespond(withStatus(HttpStatus.BAD_REQUEST));

		// When / Then:
		assertThatThrownBy(() -> client.probeSheet(assertion, SLUG, "x"))
				.isInstanceOf(PacingExternalException.class)
				.extracting("detail")
				.isEqualTo("invalid request");
		server.verify();
	}

	@Test
	void shouldTreatAnUnparseableErrorBodyAsNoFieldsRatherThanASecondFailureTest() {
		// Given: a malformed body must not throw over the failure it was describing.
		HubAssertion assertion = assertion();
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingSheetSourceClientImpl client =
				new PacingSheetSourceClientImpl(builder.build(), signer(assertion), new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/" + SLUG + "/sheet-probe"))
				.andRespond(withStatus(HttpStatus.BAD_REQUEST)
						.body("<html>not json</html>")
						.contentType(MediaType.APPLICATION_JSON));

		// When / Then:
		assertThatThrownBy(() -> client.probeSheet(assertion, SLUG, "x"))
				.isInstanceOf(PacingExternalException.class)
				.extracting("detail")
				.isEqualTo("invalid request");
		server.verify();
	}

	@Test
	void shouldTreatAnUnknownUser403AsASyncGapTest() {
		// Given: the uniform 403 rule - `unknown_user` means the Hub's employee mirror has not caught
		// up, which is a different thing to tell a person than "you may not".
		HubAssertion assertion = assertion();
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingSheetSourceClientImpl client =
				new PacingSheetSourceClientImpl(builder.build(), signer(assertion), new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/" + SLUG + "/sheet-probe"))
				.andRespond(withStatus(HttpStatus.FORBIDDEN)
						.body("{\"error\":\"unknown_user\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When / Then:
		assertThatThrownBy(() -> client.probeSheet(assertion, SLUG, "x"))
				.isInstanceOf(PacingExternalException.class)
				.extracting("reason")
				.isEqualTo(PacingFailureReason.UPSTREAM_USER_NOT_SYNCED);
		server.verify();
	}

	@Test
	void shouldTreatAnyOther403AsARealAuthorizationDecisionTest() {
		// Given:
		HubAssertion assertion = assertion();
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingSheetSourceClientImpl client =
				new PacingSheetSourceClientImpl(builder.build(), signer(assertion), new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/" + SLUG + "/dim-source/apps/read"))
				.andRespond(withStatus(HttpStatus.FORBIDDEN)
						.body("{\"error\":\"no_access\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When / Then:
		assertThatThrownBy(() -> client.readSource(assertion, SLUG, "apps"))
				.isInstanceOf(PacingExternalException.class)
				.extracting("reason")
				.isEqualTo(PacingFailureReason.UPSTREAM_FORBIDDEN);
		server.verify();
	}

	@Test
	void shouldProposeRoutesForNamesThatMatchedNothingTest() {
		// Given:
		HubAssertion assertion = assertion();
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingSheetSourceClientImpl client =
				new PacingSheetSourceClientImpl(builder.build(), signer(assertion), new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/" + SLUG + "/dim-source/apps/suggest"))
				.andExpect(method(POST))
				.andExpect(content().json("{\"kind\":\"bindings\"}"))
				.andRespond(withSuccess(
						"{\"ok\":true,\"bindings\":[{\"value\":\"Mystery row\",\"line_item_id\":\"695344\"}]}",
						MediaType.APPLICATION_JSON));

		// When:
		PacingDimSourceSuggestions out = client.suggest(
				assertion, SLUG, "apps", "bindings", null, null,
				List.of(new PacingDimSourceUnboundName("Mystery row", 7)), List.of());

		// Then:
		assertThat(out.available()).isTrue();
		assertThat(out.bindings()).hasSize(1);
		assertThat(out.bindings().get(0).value()).isEqualTo("Mystery row");
		assertThat(out.bindings().get(0).lineItemId()).isEqualTo("695344");
		// The two lists this question did not produce are empty, never null.
		assertThat(out.members()).isEmpty();
		assertThat(out.groups()).isEmpty();
		server.verify();
	}

	@Test
	void shouldReadNoModelConfiguredAsAnAnswerRatherThanAFailureTest() {
		// Given: 503 here is Pacing saying this deployment has no model connected. A red box would
		// read as "the feature is broken" for something that was never switched on.
		HubAssertion assertion = assertion();
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingSheetSourceClientImpl client =
				new PacingSheetSourceClientImpl(builder.build(), signer(assertion), new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/" + SLUG + "/dim-source/apps/suggest"))
				.andRespond(withStatus(HttpStatus.SERVICE_UNAVAILABLE)
						.body("{\"error\":\"llm_not_configured\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When:
		PacingDimSourceSuggestions out =
				client.suggest(assertion, SLUG, "apps", "groups", "app", null, List.of(), List.of());

		// Then:
		assertThat(out.available()).isFalse();
		assertThat(out.notice()).isEqualTo("we need to add ai connection");
		server.verify();
	}

	@Test
	void shouldReadNothingToReasonAboutAsAnAnswerTooTest() {
		// Given: 409 is "this sheet has not been read yet", which the Re-read button fixes.
		HubAssertion assertion = assertion();
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingSheetSourceClientImpl client =
				new PacingSheetSourceClientImpl(builder.build(), signer(assertion), new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/" + SLUG + "/dim-source/apps/suggest"))
				.andRespond(withStatus(HttpStatus.CONFLICT)
						.body("{\"error\":\"no_source_data\"}")
						.contentType(MediaType.APPLICATION_JSON));

		// When:
		PacingDimSourceSuggestions out =
				client.suggest(assertion, SLUG, "apps", "aliases", "app", "Hulu", List.of(), List.of());

		// Then:
		assertThat(out.available()).isFalse();
		assertThat(out.notice()).contains("read it first");
		server.verify();
	}

	@Test
	void shouldStillThrowOnARealSuggestFailureTest() {
		// Given: 502 means the model was asked and the call failed - that IS a fault.
		HubAssertion assertion = assertion();
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingSheetSourceClientImpl client =
				new PacingSheetSourceClientImpl(builder.build(), signer(assertion), new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/" + SLUG + "/dim-source/apps/suggest"))
				.andRespond(withStatus(HttpStatus.BAD_GATEWAY));

		// When / Then:
		assertThatThrownBy(() ->
				client.suggest(assertion, SLUG, "apps", "groups", "app", null, List.of(), List.of()))
				.isInstanceOf(PacingExternalException.class);
		server.verify();
	}

	@Test
	void shouldMapAServerErrorToOtherTest() {
		// Given:
		HubAssertion assertion = assertion();
		RestClient.Builder builder = RestClient.builder().baseUrl(BASE_URL);
		MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
		PacingSheetSourceClientImpl client =
				new PacingSheetSourceClientImpl(builder.build(), signer(assertion), new ObjectMapper());
		server.expect(requestTo(BASE_URL + "/api/dashboards/" + SLUG + "/dim-source/apps/read"))
				.andRespond(withServerError());

		// When / Then:
		assertThatThrownBy(() -> client.readSource(assertion, SLUG, "apps"))
				.isInstanceOf(PacingExternalException.class)
				.extracting("reason")
				.isEqualTo(PacingFailureReason.OTHER);
		server.verify();
	}
}
