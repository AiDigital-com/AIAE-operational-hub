package com.aidigital.operationalhub.externalservices.bigquery.impl;

import com.google.cloud.bigquery.Job;

/**
 * How a BigQuery job is named in a log line or an error message.
 *
 * <p>Shared by the read and write clients because a job id is only useful if it is always there: an error
 * without one leaves the most expensive thing the Hub does - rebuilding a dashboard's source table -
 * unfindable in BigQuery's own job history, which is the one place that can say what it was doing when it
 * failed. Both clients therefore name every failure after the job they submitted, not only the ones that
 * came back.
 */
final class BigQueryJobs {

	/** What a job is called when there is no id to call it by. */
	private static final String UNKNOWN = "unknown";

	private BigQueryJobs() {
	}

	/**
	 * Reads a job's id as a plain string.
	 *
	 * @param job the job, may be {@code null} when submission itself failed
	 * @return the job id, or {@code "unknown"}
	 */
	static String id(Job job) {
		return job == null || job.getJobId() == null || job.getJobId().getJob() == null
				? UNKNOWN
				: job.getJobId().getJob();
	}

	/**
	 * Formats the job id for an error message, so a failure can be looked up in BigQuery's job history.
	 *
	 * @param job the job, may be {@code null} when submission itself failed
	 * @return {@code " (job=...)"}, or an empty string when there is no job to name
	 */
	static String suffix(Job job) {
		return job == null ? "" : " (job=" + id(job) + ")";
	}
}
