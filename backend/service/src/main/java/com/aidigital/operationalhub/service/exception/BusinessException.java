package com.aidigital.operationalhub.service.exception;

import lombok.EqualsAndHashCode;
import lombok.Getter;

import java.io.Serial;

/**
 * Single business exception type for service-layer failures with different stable codes.
 */
@Getter
@EqualsAndHashCode(callSuper = false)
public class BusinessException extends RuntimeException implements CodeAwareThrowable {

	@Serial
	private static final long serialVersionUID = 1L;

	private final String code;
	private final String message;

	/**
	 * Creates a business exception with a formatted message.
	 *
	 * @param reason stable business error reason
	 * @param params message template parameters
	 */
	public BusinessException(BusinessExceptionReason reason, Object... params) {
		code = reason.getCode();
		message = String.format(reason.getDescription(), params);
	}

	/**
	 * Creates a business exception with a formatted message and original cause.
	 *
	 * @param reason stable business error reason
	 * @param cause  original exception
	 * @param params message template parameters
	 */
	public BusinessException(BusinessExceptionReason reason, Throwable cause, Object... params) {
		super(cause);
		code = reason.getCode();
		message = String.format(reason.getDescription(), params);
	}

	@Override
	public String getMessage() {
		return message;
	}
}
