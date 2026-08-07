package com.aidigital.operationalhub.application.exception.mapper;

import com.aidigital.operationalhub.application.api.v1.generated.model.OperationalHubApiExceptionResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.OperationalHubValidationExceptionResponseV1;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.FieldError;

import java.util.List;

/**
 * Builds OpenAPI error response DTOs for the global exception handler.
 */
public interface GlobalExceptionResponseHelper {

	/**
	 * Builds a single-error API response entity.
	 *
	 * @param exception exception carrying the response code and message
	 * @param status    HTTP status to return
	 * @return API exception response entity
	 */
	ResponseEntity<OperationalHubApiExceptionResponseV1> buildApiError(Exception exception, HttpStatus status);

	/**
	 * Builds a validation envelope from Spring field errors.
	 *
	 * @param errors binding field errors
	 * @return validation response body
	 */
	OperationalHubValidationExceptionResponseV1 buildValidationErrorMessage(List<FieldError> errors);

	/**
	 * Builds a validation envelope for a single field-level error.
	 *
	 * @param field invalid field name
	 * @param error validation message
	 * @return validation response body
	 */
	OperationalHubValidationExceptionResponseV1 buildValidationErrorMessage(String field, String error);
}
