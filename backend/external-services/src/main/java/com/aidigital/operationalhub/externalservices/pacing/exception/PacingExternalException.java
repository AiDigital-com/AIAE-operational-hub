package com.aidigital.operationalhub.externalservices.pacing.exception;

/**
 * Runtime exception signalling a failure calling the Pacing service: a non-2xx response, a network or
 * timeout failure, or a failure signing the {@code X-Hub-Assertion} header.
 *
 * <p>The shared assertion secret is never included in the message or cause.
 *
 * <p>Carries a {@link PacingFailureReason} so the application layer (see {@code GlobalExceptionHandler})
 * can map different Pacing failures to different, honest HTTP status codes instead of collapsing every
 * one of them into a bare 500. Constructors that do not take a reason default to
 * {@link PacingFailureReason#OTHER}, matching this exception's original behaviour before that
 * distinction existed.
 */
public class PacingExternalException extends RuntimeException {

	private final PacingFailureReason reason;

	/**
	 * Constructs an exception with a descriptive message and {@link PacingFailureReason#OTHER}.
	 *
	 * @param message human-readable description (must not contain the shared secret)
	 */
	public PacingExternalException(String message) {
		this(PacingFailureReason.OTHER, message);
	}

	/**
	 * Constructs an exception wrapping an underlying cause, with {@link PacingFailureReason#OTHER}.
	 *
	 * @param message human-readable description
	 * @param cause   underlying exception
	 */
	public PacingExternalException(String message, Throwable cause) {
		this(PacingFailureReason.OTHER, message, cause);
	}

	/**
	 * Constructs an exception with a descriptive message and an explicit failure reason.
	 *
	 * @param reason  why the call to Pacing failed
	 * @param message human-readable description (must not contain the shared secret)
	 */
	public PacingExternalException(PacingFailureReason reason, String message) {
		super(message);
		this.reason = reason;
	}

	/**
	 * Constructs an exception wrapping an underlying cause, with an explicit failure reason.
	 *
	 * @param reason  why the call to Pacing failed
	 * @param message human-readable description
	 * @param cause   underlying exception
	 */
	public PacingExternalException(PacingFailureReason reason, String message, Throwable cause) {
		super(message, cause);
		this.reason = reason;
	}

	/**
	 * Returns why the call to Pacing failed.
	 *
	 * @return the failure reason, never {@code null}
	 */
	public PacingFailureReason getReason() {
		return reason;
	}
}
