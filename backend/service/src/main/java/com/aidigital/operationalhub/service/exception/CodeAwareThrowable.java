package com.aidigital.operationalhub.service.exception;

/**
 * Marks exceptions carrying a stable error code for REST error responses.
 */
public interface CodeAwareThrowable {

	/**
	 * Gets the stable machine-readable error code.
	 *
	 * @return the error code
	 */
	String getCode();
}
