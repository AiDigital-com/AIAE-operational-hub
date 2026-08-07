package com.aidigital.operationalhub.application.exception;

import com.aidigital.operationalhub.application.api.v1.generated.model.OperationalHubApiExceptionResponseV1;
import com.aidigital.operationalhub.application.exception.mapper.GlobalExceptionResponseHelper;
import com.aidigital.operationalhub.service.exception.BusinessException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
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
}
