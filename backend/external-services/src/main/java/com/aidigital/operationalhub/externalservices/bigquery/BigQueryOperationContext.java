package com.aidigital.operationalhub.externalservices.bigquery;

import org.springframework.stereotype.Component;

/**
 * Names the operation whose BigQuery jobs are currently being run, so a job can be attributed to it.
 *
 * <p>Attribution has to happen somewhere, and the useful unit is the operation a user triggered, not the
 * individual statement: the question worth answering is "what does opening a report cost", and a report page
 * is several jobs. Passing that name down through every gateway and service signature would put a telemetry
 * argument in front of every read in the codebase; holding it per thread costs one bean and touches nothing
 * that runs a query.
 *
 * <p>Set once at the edge - {@code BigQueryOperationInterceptor} for HTTP requests, the scheduler for its own
 * job - and cleared when that work finishes. Every BigQuery read and write reads it to label the job and tag
 * its meters. Unset reads as {@link #UNLABELLED} rather than failing: a missing label must not stop a query.
 *
 * <p>Thread-confined by design. A job submitted from a worker thread the edge never touched is
 * {@link #UNLABELLED}, which is honest - nothing on that thread knows what asked for it.
 */
@Component
public class BigQueryOperationContext {

	/** What an operation is called when nothing named it. */
	public static final String UNLABELLED = "unlabelled";

	/** BigQuery accepts lowercase letters, digits, dashes and underscores in a label value. */
	private static final String ILLEGAL_LABEL_CHARACTERS = "[^a-z0-9_-]";

	/** BigQuery's own limit on a label value. */
	private static final int MAX_LABEL_LENGTH = 63;

	private final ThreadLocal<String> operation = new ThreadLocal<>();

	/**
	 * Names the operation this thread is now working on, normalised to what BigQuery accepts as a label.
	 *
	 * @param name the operation name, in any casing; {@code null} or blank clears the name
	 */
	public void set(String name) {
		if (name == null || name.isBlank()) {
			clear();
			return;
		}
		String normalised = name.toLowerCase().replaceAll(ILLEGAL_LABEL_CHARACTERS, "_");
		operation.set(normalised.length() <= MAX_LABEL_LENGTH
				? normalised
				: normalised.substring(0, MAX_LABEL_LENGTH));
	}

	/**
	 * Returns the operation this thread is working on.
	 *
	 * @return the operation name, or {@link #UNLABELLED} when nothing named it
	 */
	public String current() {
		String name = operation.get();
		return name == null ? UNLABELLED : name;
	}

	/**
	 * Forgets the operation, so the next piece of work on this thread starts unnamed.
	 */
	public void clear() {
		operation.remove();
	}
}
