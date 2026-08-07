package com.aidigital.operationalhub.service.exception;

import java.io.Serial;

/**
 * General-purpose unchecked exception for technical and programming errors that do not map to a
 * stable, client-facing business code. Use this instead of raw {@code IllegalArgumentException},
 * {@code IllegalStateException} and similar JDK runtime exceptions; surface client-facing,
 * rule-driven failures through the coded business exception instead.
 */
public class AppException extends RuntimeException {

	@Serial
	private static final long serialVersionUID = 3746247532968115123L;

	/**
	 * Creates an exception with a plain message.
	 *
	 * @param message the detail message
	 */
	public AppException(String message) {
		super(message);
	}

	/**
	 * Creates an exception with a formatted message and original cause.
	 *
	 * @param message the message template
	 * @param cause   the original cause
	 * @param args    the message template arguments
	 */
	public AppException(String message, Throwable cause, Object... args) {
		super(String.format(message, args), cause);
	}

	/**
	 * Creates an exception with a formatted message.
	 *
	 * @param message the message template
	 * @param args    the message template arguments
	 */
	public AppException(String message, Object... args) {
		super(String.format(message, args));
	}

	/**
	 * Creates an exception with a plain message and original cause.
	 *
	 * @param message the detail message
	 * @param cause   the original cause
	 */
	public AppException(String message, Throwable cause) {
		super(message, cause);
	}
}
