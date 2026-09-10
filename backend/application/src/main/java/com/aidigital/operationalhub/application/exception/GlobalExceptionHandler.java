package com.aidigital.operationalhub.application.exception;

import com.aidigital.operationalhub.application.api.v1.generated.model.OperationalHubApiExceptionResponseV1;
import com.aidigital.operationalhub.application.api.v1.generated.model.OperationalHubValidationExceptionResponseV1;
import com.aidigital.operationalhub.application.exception.mapper.GlobalExceptionResponseHelper;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingExternalException;
import com.aidigital.operationalhub.externalservices.pacing.exception.PacingFailureReason;
import com.aidigital.operationalhub.service.exception.AppException;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import jakarta.validation.ConstraintViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.lang.NonNull;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

import java.util.Map;

import static com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason.OPH_000;
import static com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason.OPH_014;
import static com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason.OPH_015;
import static com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason.OPH_016;
import static com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason.OPH_024;
import static com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason.OPH_025;
import static com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason.OPH_027;
import static com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason.OPH_032;
import static com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason.OPH_051;
import static com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason.OPH_052;
import static com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason.OPH_053;
import static com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason.OPH_054;
import static com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason.OPH_055;
import static org.springframework.http.HttpStatus.BAD_REQUEST;
import static org.springframework.http.HttpStatus.CONFLICT;
import static org.springframework.http.HttpStatus.FORBIDDEN;
import static org.springframework.http.HttpStatus.INTERNAL_SERVER_ERROR;
import static org.springframework.http.HttpStatus.NOT_FOUND;
import static org.springframework.http.HttpStatus.PAYLOAD_TOO_LARGE;
import static org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE;
import static org.springframework.http.HttpStatus.TOO_MANY_REQUESTS;
import static org.springframework.http.HttpStatus.UNAUTHORIZED;

/**
 * Advice for exception mapping to REST API format.
 */
@ControllerAdvice
public class GlobalExceptionHandler extends ResponseEntityExceptionHandler {

	private static final Logger LOG = LoggerFactory.getLogger(GlobalExceptionHandler.class);
	private static final String REQUEST_FIELD = "request";

	private static final Map<String, HttpStatus> BUSINESS_EXCEPTION_CODES = Map.of(
			OPH_014.getCode(), NOT_FOUND,
			OPH_024.getCode(), FORBIDDEN,
			OPH_025.getCode(), NOT_FOUND,
			OPH_032.getCode(), TOO_MANY_REQUESTS);

	/**
	 * Maps each {@link PacingFailureReason} to the HTTP status the Hub's own caller should see.
	 *
	 * <p>{@link PacingFailureReason#UPSTREAM_UNAUTHORIZED} (Pacing answered 401) is deliberately mapped
	 * to 500, not passed through as 401. A 401 from Pacing means the two services' shared HMAC secrets
	 * disagree - a server misconfiguration the calling user had nothing to do with. The Hub's own
	 * frontend logs a user out on any 401 it sees from the Hub
	 * ({@code frontend/src/shared/api/client.ts}: {@code if (response.status === 401) await
	 * runtimeConfig.onUnauthorized();}); passing this through would log people out because of an ops
	 * mistake, not anything they did. See {@code GlobalExceptionHandlerTest} for the regression test
	 * pinning this mapping.
	 *
	 * <p>{@link PacingFailureReason#UPSTREAM_USER_NOT_SYNCED} (Pacing answered 403/{@code unknown_user})
	 * is likewise not passed through as 403: that would read as "you are forbidden", when the truth is
	 * "the Hub knows you but Pacing's user mirror does not yet" - a sync gap, not an authorization
	 * decision. Mapped to 409 with the distinct {@code OPH_053} code instead.
	 */
	private static final Map<PacingFailureReason, HttpStatus> PACING_FAILURE_STATUSES = Map.of(
			PacingFailureReason.UNREACHABLE, SERVICE_UNAVAILABLE,
			PacingFailureReason.UPSTREAM_UNAUTHORIZED, INTERNAL_SERVER_ERROR,
			PacingFailureReason.UPSTREAM_USER_NOT_SYNCED, CONFLICT,
			PacingFailureReason.UPSTREAM_NOT_FOUND, NOT_FOUND,
			PacingFailureReason.OTHER, INTERNAL_SERVER_ERROR);

	private static final Map<PacingFailureReason, OperationalHubErrorReason> PACING_FAILURE_CODES = Map.of(
			PacingFailureReason.UNREACHABLE, OPH_051,
			PacingFailureReason.UPSTREAM_UNAUTHORIZED, OPH_052,
			PacingFailureReason.UPSTREAM_USER_NOT_SYNCED, OPH_053,
			PacingFailureReason.UPSTREAM_NOT_FOUND, OPH_054,
			PacingFailureReason.OTHER, OPH_055);

	private final GlobalExceptionResponseHelper responseHelper;

	/**
	 * Creates the exception handler.
	 *
	 * @param responseHelper helper that builds generated OpenAPI response DTOs
	 */
	public GlobalExceptionHandler(GlobalExceptionResponseHelper responseHelper) {
		this.responseHelper = responseHelper;
	}

	/**
	 * Handles service-layer business exceptions with stable Operational Hub codes.
	 *
	 * @param exception the business exception
	 * @return API error response with mapped HTTP status
	 */
	@ExceptionHandler(BusinessException.class)
	public ResponseEntity<OperationalHubApiExceptionResponseV1> handleBusinessException(
			BusinessException exception) {
		return responseHelper.buildApiError(
				exception, BUSINESS_EXCEPTION_CODES.getOrDefault(exception.getCode(), BAD_REQUEST));
	}

	/**
	 * Handles authenticated callers without sufficient permissions.
	 *
	 * @param exception the access-denied exception
	 * @return 403 API error response
	 */
	@ExceptionHandler(AccessDeniedException.class)
	public ResponseEntity<OperationalHubApiExceptionResponseV1> handleAccessDenied(
			AccessDeniedException exception) {
		return responseHelper.buildApiError(new BusinessException(OPH_015), FORBIDDEN);
	}

	/**
	 * Handles authentication failures raised inside MVC.
	 *
	 * @param exception the authentication exception
	 * @return 401 API error response
	 */
	@ExceptionHandler(AuthenticationException.class)
	public ResponseEntity<OperationalHubApiExceptionResponseV1> handleAuthentication(
			AuthenticationException exception) {
		return responseHelper.buildApiError(new BusinessException(OPH_016), UNAUTHORIZED);
	}

	/**
	 * Handles a multipart upload exceeding the configured file/request size limit. Overrides the base
	 * class's built-in handling (rather than adding a separate {@code @ExceptionHandler}, which would
	 * collide with it) the same way {@link #handleMethodArgumentNotValid} does.
	 *
	 * @param exception the upload-size exception
	 * @param headers   response headers passed by Spring MVC
	 * @param status    response status passed by Spring MVC
	 * @param request   current web request
	 * @return 413 API error response
	 */
	@Override
	protected ResponseEntity<Object> handleMaxUploadSizeExceededException(
			MaxUploadSizeExceededException exception,
			@NonNull HttpHeaders headers,
			@NonNull HttpStatusCode status,
			@NonNull WebRequest request) {
		ResponseEntity<OperationalHubApiExceptionResponseV1> response = responseHelper.buildApiError(
				new BusinessException(OPH_027, "the uploaded file is too large"), PAYLOAD_TOO_LARGE);
		return new ResponseEntity<>(response.getBody(), response.getStatusCode());
	}

	/**
	 * Handles request-body validation failures raised by Spring MVC.
	 *
	 * @param exception the validation exception
	 * @param headers   response headers passed by Spring MVC
	 * @param status    response status passed by Spring MVC
	 * @param request   current web request
	 * @return 400 validation error response
	 */
	@Override
	public ResponseEntity<Object> handleMethodArgumentNotValid(
			MethodArgumentNotValidException exception,
			@NonNull HttpHeaders headers,
			@NonNull HttpStatusCode status,
			@NonNull WebRequest request) {
		return new ResponseEntity<>(
				responseHelper.buildValidationErrorMessage(exception.getBindingResult().getFieldErrors()),
				BAD_REQUEST);
	}

	/**
	 * Handles validation failures raised outside request-body binding.
	 *
	 * @param exception the validation exception
	 * @return 400 validation error response
	 */
	@ExceptionHandler(ConstraintViolationException.class)
	public ResponseEntity<OperationalHubValidationExceptionResponseV1> handleConstraintViolation(
			ConstraintViolationException exception) {
		return new ResponseEntity<>(
				responseHelper.buildValidationErrorMessage(REQUEST_FIELD, exception.getMessage()),
				BAD_REQUEST);
	}

	/**
	 * Handles Pacing integration failures, mapping the exception's {@link PacingFailureReason} to a
	 * distinct, honest HTTP status (see {@link #PACING_FAILURE_STATUSES}) instead of collapsing every
	 * non-2xx Pacing response and every network failure into one bare 500.
	 *
	 * @param exception the Pacing failure
	 * @return API error response with the status mapped from the failure's reason
	 */
	@ExceptionHandler(PacingExternalException.class)
	public ResponseEntity<OperationalHubApiExceptionResponseV1> handlePacingExternalException(
			PacingExternalException exception) {
		LOG.error("Pacing request failed ({}): {}", exception.getReason(), exception.getMessage(), exception);
		HttpStatus status = PACING_FAILURE_STATUSES.getOrDefault(exception.getReason(), INTERNAL_SERVER_ERROR);
		OperationalHubErrorReason reason = PACING_FAILURE_CODES.getOrDefault(exception.getReason(), OPH_055);
		return responseHelper.buildApiError(new BusinessException(reason), status);
	}

	/**
	 * Handles technical application exceptions that carry no client-facing business code.
	 *
	 * @param exception the application exception
	 * @return 500 API error response
	 */
	@ExceptionHandler(AppException.class)
	public ResponseEntity<OperationalHubApiExceptionResponseV1> handleAppException(AppException exception) {
		LOG.error("Application exception while processing request", exception);
		return responseHelper.buildApiError(new BusinessException(OPH_000), INTERNAL_SERVER_ERROR);
	}

	/**
	 * Handles unexpected exceptions as opaque internal errors.
	 *
	 * @param exception the unexpected exception
	 * @return 500 API error response
	 */
	@ExceptionHandler(Exception.class)
	public ResponseEntity<OperationalHubApiExceptionResponseV1> handleUnexpected(Exception exception) {
		LOG.error("Unhandled exception while processing request", exception);
		return responseHelper.buildApiError(new BusinessException(OPH_000), INTERNAL_SERVER_ERROR);
	}
}
