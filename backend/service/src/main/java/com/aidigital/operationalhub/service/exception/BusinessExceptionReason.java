package com.aidigital.operationalhub.service.exception;

/**
 * Reason contract for business exceptions exposed to API clients as stable error codes.
 */
public interface BusinessExceptionReason {

	/**
	 * Gets the stable machine-readable error code.
	 *
	 * @return the error code
	 */
	String getCode();

	/**
	 * Gets the human-readable message template.
	 *
	 * @return the message template
	 */
	String getDescription();
}
