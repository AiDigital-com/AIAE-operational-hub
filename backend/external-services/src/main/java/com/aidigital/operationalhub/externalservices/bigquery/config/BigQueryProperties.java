package com.aidigital.operationalhub.externalservices.bigquery.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * Runtime-tunable properties for the BigQuery adapter.
 *
 * <p>All fields bind from the {@code app.external.bigquery.*} namespace.
 *
 * <p>Typical {@code application.yml} stubs:
 * <pre>
 * app:
 *   external:
 *     bigquery:
 *       enabled: ${BIGQUERY_ENABLED:false}
 *       stub-enabled: ${BIGQUERY_STUB_ENABLED:false}
 *       credentials-location: ${BIGQUERY_CREDENTIALS_LOCATION:}
 *       project-id: ${BIGQUERY_PROJECT_ID:}
 *       dataset: ${BIGQUERY_DATASET:}
 *       location: ${BIGQUERY_LOCATION:US}
 *       job-timeout-ms: ${BIGQUERY_JOB_TIMEOUT_MS:30000}
 *       table-write-timeout-ms: ${BIGQUERY_TABLE_WRITE_TIMEOUT_MS:600000}
 *       io-lines-table: ${BIGQUERY_IO_LINES_TABLE:project.dataset.table}
 *       rippling-employees-table: ${BIGQUERY_RIPPLING_EMPLOYEES_TABLE:project.dataset.table}
 *       adjustments-view: ${BIGQUERY_ADJUSTMENTS_VIEW:project.dataset.table}
 *       write-table: ${BIGQUERY_ADJUSTMENTS_TABLE:project.dataset.table}
 *       conversions-view: ${BIGQUERY_CONVERSIONS_VIEW:project.dataset.table}
 *       conversions-write-table: ${BIGQUERY_CONVERSIONS_TABLE:project.dataset.table}
 *       plans-table: ${BIGQUERY_PLANS_TABLE:project.dataset.table}
 *       dashboard-dataset: ${BIGQUERY_DASHBOARD_DATASET:project.dataset}
 * </pre>
 *
 * <p>The table properties ({@code ioLinesTable}, {@code ripplingEmployeesTable},
 * {@code adjustmentsView}, {@code writeTable}, {@code conversionsView},
 * {@code conversionsWriteTable}) are each a fully-qualified {@code project.dataset.table} name used
 * verbatim as the query source; {@code projectId} only sets the BigQuery job's billing project.
 *
 * <p>Two read/write pairs, one shape: delivery actuals live in {@code adjustmentsView} over
 * {@code writeTable}, conversions in {@code conversionsView} over {@code conversionsWriteTable}. In
 * both, the view merges the base mart with the hub's own appended adjustments and resolves conflicts
 * by latest {@code last_modified_at}; the hub only ever appends to the write table.
 *
 * <p>Security: {@code credentialsJson} holds the service-account key as inline JSON (supplied via a
 * secret/env at deploy time). Never commit credentials JSON.
 */
@ConfigurationProperties(prefix = "app.external.bigquery")
@Validated
public class BigQueryProperties {

	private boolean enabled = false;
	private boolean stubEnabled = false;
	private String credentialsJson = "";
	private String projectId = "";
	private String dataset = "";
	private String location = "US";
	private long jobTimeoutMs = 30000;
	private long tableWriteTimeoutMs = 600000;
	/**
	 * Bytes a single read may be billed for before BigQuery refuses to run it, or {@code 0} for no limit.
	 *
	 * <p>Left unset by default: a limit that rejects a legitimate report is worse than an expensive one, and
	 * nobody knows yet what a legitimate report costs. Set it once the {@code bigquery.query.bytes.billed}
	 * distribution has a few weeks of production data behind it.
	 */
	private long maxBytesBilled = 0;
	private String ioLinesTable = "silken-quasar-376417.netsuite.netsuite_campaigns_with_ids_fresh_data";
	private String ripplingEmployeesTable = "silken-quasar-376417.custom_task_data.rippling_employees";
	private String adjustmentsView = "silken-quasar-376417.operational_hub.platform_mart_adjustments_view_op_hub";
	private String writeTable = "silken-quasar-376417.operational_hub.platform_mart_operational_hub_adjustements";
	private String conversionsView = "silken-quasar-376417.operational_hub.conversions_mart_adjustments_view_op_hub";
	private String conversionsWriteTable =
			"silken-quasar-376417.operational_hub.conversions_mart_operational_hub_adjustments";
	private String plansTable = "silken-quasar-376417.aidigital_database.elevate_plans_n_benches";
	private String dashboardDataset = "silken-quasar-376417.gs_templates";

	/**
	 * Returns whether the BigQuery integration is enabled.
	 *
	 * @return {@code true} if BigQuery is active
	 */
	public boolean isEnabled() {
		return enabled;
	}

	/**
	 * Sets whether the BigQuery integration is enabled.
	 *
	 * @param enabled {@code true} to enable
	 */
	public void setEnabled(boolean enabled) {
		this.enabled = enabled;
	}

	/**
	 * Returns whether the in-memory stub client is active (local dev without credentials).
	 *
	 * @return {@code true} when stub mode is enabled
	 */
	public boolean isStubEnabled() {
		return stubEnabled;
	}

	/**
	 * Sets whether the in-memory stub client is active.
	 *
	 * @param stubEnabled {@code true} to use the in-memory stub client
	 */
	public void setStubEnabled(boolean stubEnabled) {
		this.stubEnabled = stubEnabled;
	}

	/**
	 * Returns the service-account key as inline JSON.
	 *
	 * @return the credentials JSON string; empty when not configured
	 */
	public String getCredentialsJson() {
		return credentialsJson;
	}

	/**
	 * Sets the service-account key as inline JSON.
	 *
	 * @param credentialsJson the credentials JSON string
	 */
	public void setCredentialsJson(String credentialsJson) {
		this.credentialsJson = credentialsJson;
	}

	/**
	 * Returns the Google Cloud project ID.
	 *
	 * @return project ID
	 */
	public String getProjectId() {
		return projectId;
	}

	/**
	 * Sets the Google Cloud project ID.
	 *
	 * @param projectId project ID
	 */
	public void setProjectId(String projectId) {
		this.projectId = projectId;
	}

	/**
	 * Returns the BigQuery dataset name.
	 *
	 * @return dataset name
	 */
	public String getDataset() {
		return dataset;
	}

	/**
	 * Sets the BigQuery dataset name.
	 *
	 * @param dataset dataset name
	 */
	public void setDataset(String dataset) {
		this.dataset = dataset;
	}

	/**
	 * Returns the BigQuery dataset location (e.g. {@code "US"}, {@code "EU"}).
	 *
	 * @return location string
	 */
	public String getLocation() {
		return location;
	}

	/**
	 * Sets the BigQuery dataset location.
	 *
	 * @param location location string
	 */
	public void setLocation(String location) {
		this.location = location;
	}

	/**
	 * Returns the maximum time, in milliseconds, a single BigQuery query job may run before it is
	 * cancelled. Applied both as the job's own {@code jobTimeoutMs} deadline and as the SDK client's
	 * retry-total-timeout budget, so a hung BigQuery job cannot pin a caller thread indefinitely.
	 *
	 * @return the query job timeout, in milliseconds
	 */
	public long getJobTimeoutMs() {
		return jobTimeoutMs;
	}

	/**
	 * Sets the maximum time, in milliseconds, a single BigQuery query job may run before it is
	 * cancelled.
	 *
	 * @param jobTimeoutMs the query job timeout, in milliseconds
	 */
	public void setJobTimeoutMs(long jobTimeoutMs) {
		this.jobTimeoutMs = jobTimeoutMs;
	}

	/**
	 * Returns the maximum time, in milliseconds, a table-building write may run before it is cancelled.
	 *
	 * <p>Separate from {@link #getJobTimeoutMs()}, which bounds a query answering a request. A dashboard's
	 * data source rebuilds a whole table from a campaign's entire history, so it is minutes' work where a
	 * paged read is seconds'. Sharing the read budget would time the write out on any campaign of size - and a
	 * BigQuery job outlives the client that stopped waiting for it, so the table would still be written while
	 * the Hub recorded a failure.
	 *
	 * @return the table-write timeout, in milliseconds
	 */
	public long getTableWriteTimeoutMs() {
		return tableWriteTimeoutMs;
	}

	/**
	 * Sets the maximum time, in milliseconds, a table-building write may run.
	 *
	 * @param tableWriteTimeoutMs the table-write timeout, in milliseconds
	 */
	public void setTableWriteTimeoutMs(long tableWriteTimeoutMs) {
		this.tableWriteTimeoutMs = tableWriteTimeoutMs;
	}

	/**
	 * Returns the per-read bytes-billed ceiling, or {@code 0} when a read may bill any amount.
	 *
	 * <p>A read over the ceiling fails before it runs rather than running expensively, which is why the
	 * default is off: the point of measuring first is to learn what a legitimate report costs.
	 *
	 * @return the bytes-billed ceiling for one read, or {@code 0} for no limit
	 */
	public long getMaxBytesBilled() {
		return maxBytesBilled;
	}

	/**
	 * Sets the per-read bytes-billed ceiling; {@code 0} disables the limit.
	 *
	 * @param maxBytesBilled the bytes-billed ceiling for one read, or {@code 0} for no limit
	 */
	public void setMaxBytesBilled(long maxBytesBilled) {
		this.maxBytesBilled = maxBytesBilled;
	}

	/**
	 * Returns the fully-qualified IO Lines table ({@code project.dataset.table}), used verbatim as the
	 * query source.
	 *
	 * @return fully-qualified IO lines table
	 */
	public String getIoLinesTable() {
		return ioLinesTable;
	}

	/**
	 * Sets the fully-qualified IO Lines table ({@code project.dataset.table}).
	 *
	 * @param ioLinesTable fully-qualified IO lines table
	 */
	public void setIoLinesTable(String ioLinesTable) {
		this.ioLinesTable = ioLinesTable;
	}

	/**
	 * Returns the fully-qualified Rippling employees table ({@code project.dataset.table}), used
	 * verbatim as the query source.
	 *
	 * @return fully-qualified rippling employees table
	 */
	public String getRipplingEmployeesTable() {
		return ripplingEmployeesTable;
	}

	/**
	 * Sets the fully-qualified Rippling employees table.
	 *
	 * @param ripplingEmployeesTable fully-qualified rippling employees table
	 */
	public void setRipplingEmployeesTable(String ripplingEmployeesTable) {
		this.ripplingEmployeesTable = ripplingEmployeesTable;
	}

	/**
	 * Returns the fully-qualified op-hub adjustments view ({@code project.dataset.table}), used
	 * verbatim as the query source. A read-only view merging the base {@code platform_mart} delivery
	 * data with the {@code platform_mart_operational_hub_adjustements} manual adjustments table,
	 * resolving conflicts by latest {@code last_modified_at} — the merge happens server-side in
	 * BigQuery, never in application code.
	 *
	 * @return fully-qualified adjustments view
	 */
	public String getAdjustmentsView() {
		return adjustmentsView;
	}

	/**
	 * Sets the fully-qualified op-hub adjustments view.
	 *
	 * @param adjustmentsView fully-qualified adjustments view
	 */
	public void setAdjustmentsView(String adjustmentsView) {
		this.adjustmentsView = adjustmentsView;
	}

	/**
	 * Returns the fully-qualified, append-only adjustments table
	 * ({@code project.dataset.table}) that {@link #getAdjustmentsView()} merges over the base
	 * {@code platform_mart} data. Every inline edit or manually-added report row is written here as a
	 * new row stamped with {@code last_modified_at}; existing rows are never updated or deleted — the
	 * view's latest-{@code last_modified_at}-wins rule resolves conflicts on read.
	 *
	 * @return fully-qualified adjustments write table
	 */
	public String getWriteTable() {
		return writeTable;
	}

	/**
	 * Sets the fully-qualified adjustments write table.
	 *
	 * @param writeTable fully-qualified adjustments write table
	 */
	public void setWriteTable(String writeTable) {
		this.writeTable = writeTable;
	}

	/**
	 * Returns the fully-qualified conversions view ({@code project.dataset.table}) - the delivery view's
	 * counterpart for conversions, at a grain of its own: per day, per level-1 name, per conversion
	 * action. A report reads its conversions from here and attaches them to its delivery rows.
	 *
	 * @return fully-qualified conversions view
	 */
	public String getConversionsView() {
		return conversionsView;
	}

	/**
	 * Sets the fully-qualified conversions view.
	 *
	 * @param conversionsView fully-qualified conversions view
	 */
	public void setConversionsView(String conversionsView) {
		this.conversionsView = conversionsView;
	}

	/**
	 * Returns the fully-qualified conversions adjustments table ({@code project.dataset.table}) that
	 * {@link #getConversionsView()} merges over the base {@code conversions_mart} data.
	 *
	 * <p>Unlike {@link #getWriteTable()}, this one is not append-only: its view merges by
	 * {@code COALESCE} with no latest-wins guard, so a second row for a key already adjusted multiplies
	 * the joined row instead of superseding it. A write here replaces the key's row rather than adding to
	 * it.
	 *
	 * @return fully-qualified conversions write table
	 */
	public String getConversionsWriteTable() {
		return conversionsWriteTable;
	}

	/**
	 * Sets the fully-qualified conversions write table.
	 *
	 * @param conversionsWriteTable fully-qualified conversions write table
	 */
	public void setConversionsWriteTable(String conversionsWriteTable) {
		this.conversionsWriteTable = conversionsWriteTable;
	}

	/**
	 * Returns the fully-qualified plans and benchmarks table ({@code project.dataset.table}) - the campaign
	 * targets, benchmarks, short names and goals the reporting spreadsheets write, one row per plan version.
	 *
	 * <p>Written by the spreadsheet tool, not by the Hub. A dashboard reads it to label itself and to know
	 * whether its campaign is measured on cost per action; nothing here ever writes to it.
	 *
	 * @return fully-qualified plans and benchmarks table
	 */
	public String getPlansTable() {
		return plansTable;
	}

	/**
	 * Sets the fully-qualified plans and benchmarks table.
	 *
	 * @param plansTable fully-qualified plans and benchmarks table
	 */
	public void setPlansTable(String plansTable) {
		this.plansTable = plansTable;
	}

	/**
	 * Returns the dataset ({@code project.dataset}, without a table) that dashboard data sources are written
	 * into - the same one the reporting spreadsheets write theirs to, because the ClicData templates read
	 * from there.
	 *
	 * @return the dashboard data-source dataset
	 */
	public String getDashboardDataset() {
		return dashboardDataset;
	}

	/**
	 * Sets the dataset dashboard data sources are written into.
	 *
	 * @param dashboardDataset the dashboard data-source dataset, as {@code project.dataset}
	 */
	public void setDashboardDataset(String dashboardDataset) {
		this.dashboardDataset = dashboardDataset;
	}
}
