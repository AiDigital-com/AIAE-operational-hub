package com.aidigital.operationalhub.application.exception;

import com.aidigital.operationalhub.application.api.v1.generated.model.OperationalHubApiExceptionResponseV1;
import com.aidigital.operationalhub.application.exception.mapper.GlobalExceptionResponseHelper;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason;
import com.aidigital.operationalhub.service.exception.BusinessException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.verify;

/**
 * Unit tests for {@link GlobalExceptionHandler}.
 */
@ExtendWith(MockitoExtension.class)
class GlobalExceptionHandlerTest {

	@Mock
	private GlobalExceptionResponseHelper responseHelper;

	@Test
	void shouldMapMaxUploadSizeExceededToPayloadTooLargeTest() {
		// Given:
		GlobalExceptionHandler handler = new GlobalExceptionHandler(responseHelper);
		OperationalHubApiExceptionResponseV1 body = new OperationalHubApiExceptionResponseV1();
		doReturn(new ResponseEntity<>(body, HttpStatus.PAYLOAD_TOO_LARGE))
				.when(responseHelper).buildApiError(any(BusinessException.class), eq(HttpStatus.PAYLOAD_TOO_LARGE));

		// When:
		ResponseEntity<Object> result = handler.handleMaxUploadSizeExceededException(
				new MaxUploadSizeExceededException(1024L), null, null, null);

		// Then:
		assertThat(result.getStatusCode()).isEqualTo(HttpStatus.PAYLOAD_TOO_LARGE);
		assertThat(result.getBody()).isSameAs(body);
		ArgumentCaptor<BusinessException> exception = ArgumentCaptor.forClass(BusinessException.class);
		verify(responseHelper).buildApiError(exception.capture(), eq(HttpStatus.PAYLOAD_TOO_LARGE));
		assertThat(exception.getValue().getCode()).isEqualTo("OPH_027");
	}

	/**
	 * Pins the full Pacing failure -> HTTP status mapping table, including the two deliberate
	 * non-pass-throughs: a Pacing 401 (shared-secret mismatch) must not become a Hub 401 - the Hub's own
	 * frontend logs a user out on any 401 it sees from the Hub - and a Pacing 403 (unknown_user) must
	 * not become a Hub 403, since that reads as "you are forbidden" rather than "not yet synced".
	 *
	 * @param reason         the recorded {@link PacingFailureReason}
	 * @param expectedStatus the HTTP status the Hub's own caller must see
	 * @param expectedCode   the stable Operational Hub error code the Hub's own caller must see
	 */
	@ParameterizedTest
	@CsvSource({
			"UNREACHABLE, SERVICE_UNAVAILABLE, OPH_051",
			"UPSTREAM_UNAUTHORIZED, INTERNAL_SERVER_ERROR, OPH_052",
			"UPSTREAM_USER_NOT_SYNCED, CONFLICT, OPH_053",
			"UPSTREAM_NOT_FOUND, NOT_FOUND, OPH_054",
			"OTHER, INTERNAL_SERVER_ERROR, OPH_055"
	})
	void shouldMapEachPacingFailureReasonToItsHttpStatusTest(
			PacingFailureReason reason, HttpStatus expectedStatus, String expectedCode) {
		// Given:
		GlobalExceptionHandler handler = new GlobalExceptionHandler(responseHelper);
		OperationalHubApiExceptionResponseV1 body = new OperationalHubApiExceptionResponseV1();
		doReturn(new ResponseEntity<>(body, expectedStatus))
				.when(responseHelper).buildApiError(any(BusinessException.class), eq(expectedStatus));

		// When:
		ResponseEntity<OperationalHubApiExceptionResponseV1> result =
				handler.handlePacingExternalException(new PacingExternalException(reason, "boom"));

		// Then:
		assertThat(result.getStatusCode()).isEqualTo(expectedStatus);
		ArgumentCaptor<BusinessException> exception = ArgumentCaptor.forClass(BusinessException.class);
		verify(responseHelper).buildApiError(exception.capture(), eq(expectedStatus));
		assertThat(exception.getValue().getCode()).isEqualTo(expectedCode);
	}
}
