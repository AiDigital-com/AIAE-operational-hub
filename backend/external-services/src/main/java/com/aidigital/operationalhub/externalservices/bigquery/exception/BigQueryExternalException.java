package com.aidigital.operationalhub.externalservices.bigquery.exception;

/**
 * Runtime exception signalling a failure when interacting with Google BigQuery.
 *
 * <p>Covers API errors, query failures, and credential failures.
 * Credentials are never included in the message or cause.
 */
public class BigQueryExternalException extends RuntimeException {

	/**
	 * Constructs an exception with a descriptive message.
	 *
	 * @param message human-readable description (must not contain credentials)
	 */
	public BigQueryExternalException(String message) {
		super(message);
	}

	/**
	 * Constructs an exception wrapping an underlying cause.
	 *
	 * @param message human-readable description
	 * @param cause   underlying exception
	 */
	public BigQueryExternalException(String message, Throwable cause) {
		super(message, cause);
	}
}
