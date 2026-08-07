package com.aidigital.operationalhub.application.exception.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.FieldToErrorResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.OperationalHubApiExceptionResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.OperationalHubValidationExceptionResponseV1;
import com.aidigital.operationalhub.service.exception.CodeAwareThrowable;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;
import org.springframework.validation.FieldError;

import java.time.LocalDateTime;
import java.util.List;

import static com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason.OPH_000;
import static com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason.OPH_017;

/**
 * Default {@link GlobalExceptionResponseHelper} implementation.
 */
@Component
public class GlobalExceptionResponseHelperImpl implements GlobalExceptionResponseHelper {

	private static final String DEFAULT_CORRELATION_ID = "n/a";

	/**
	 * Builds a single-error API response entity.
	 *
	 * @param exception exception carrying the response code and message
	 * @param status    HTTP status to return
	 * @return API exception response entity
	 */
	@Override
	public ResponseEntity<OperationalHubApiExceptionResponseV1> buildApiError(
			Exception exception, HttpStatus status) {
		OperationalHubApiExceptionResponseV1 response = new OperationalHubApiExceptionResponseV1();
		if (exception instanceof CodeAwareThrowable codeAwareThrowable) {
			response.setCode(codeAwareThrowable.getCode());
		} else {
			response.setCode(OPH_000.getCode());
		}
		response.setMessage(exception.getMessage());
		response.setTimestamp(LocalDateTime.now());
		response.setCorrelationId(DEFAULT_CORRELATION_ID);
		return new ResponseEntity<>(response, HttpStatusCode.valueOf(status.value()));
	}

	/**
	 * Builds a validation envelope from Spring field errors.
	 *
	 * @param errors binding field errors
	 * @return validation response body
	 */
	@Override
	public OperationalHubValidationExceptionResponseV1 buildValidationErrorMessage(
			List<FieldError> errors) {
		List<FieldToErrorResponseV1> validationErrors = errors.stream()
				.map(this::buildFieldError)
				.toList();
		return buildValidationError(validationErrors);
	}

	/**
	 * Builds a validation envelope for a single field-level error.
	 *
	 * @param field invalid field name
	 * @param error validation message
	 * @return validation response body
	 */
	@Override
	public OperationalHubValidationExceptionResponseV1 buildValidationErrorMessage(
			String field, String error) {
		return buildValidationError(List.of(buildFieldError(field, error)));
	}

	/**
	 * Builds the validation response body from already mapped field errors.
	 *
	 * @param errors mapped validation field errors
	 * @return validation response body
	 */
	public OperationalHubValidationExceptionResponseV1 buildValidationError(
			List<FieldToErrorResponseV1> errors) {
		OperationalHubValidationExceptionResponseV1 response = new OperationalHubValidationExceptionResponseV1();
		response.setTimestamp(LocalDateTime.now());
		response.setCorrelationId(DEFAULT_CORRELATION_ID);
		response.setErrors(errors);
		return response;
	}

	/**
	 * Maps a Spring {@link FieldError} to the generated OpenAPI field-error DTO.
	 *
	 * @param error Spring field error
	 * @return generated field-error DTO
	 */
	public FieldToErrorResponseV1 buildFieldError(FieldError error) {
		return buildFieldError(error.getField(), error.getDefaultMessage(), error.getCode());
	}

	/**
	 * Maps a plain field/message pair to the generated OpenAPI field-error DTO.
	 *
	 * @param field invalid field name
	 * @param error validation message
	 * @return generated field-error DTO
	 */
	public FieldToErrorResponseV1 buildFieldError(String field, String error) {
		return buildFieldError(field, error, null);
	}

	/**
	 * Maps a field, message and optional validator code to the generated OpenAPI DTO.
	 *
	 * @param field invalid field name
	 * @param error validation message
	 * @param code  Spring validator code, or {@code null} for the default Operational Hub code
	 * @return generated field-error DTO
	 */
	public FieldToErrorResponseV1 buildFieldError(String field, String error, String code) {
		FieldToErrorResponseV1 response = new FieldToErrorResponseV1();
		response.setCode(code == null ? OPH_017.getCode() : code);
		response.setField(field);
		response.setError(error == null ? OPH_017.getDescription() : error);
		return response;
	}
}
