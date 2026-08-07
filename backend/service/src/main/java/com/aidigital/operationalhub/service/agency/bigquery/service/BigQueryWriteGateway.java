package com.aidigital.operationalhub.service.agency.bigquery.service;

import com.aidigital.operationalhub.externalservices.bigquery.BigQueryWriteClient;
import com.aidigital.operationalhub.externalservices.bigquery.config.BigQueryProperties;
import com.aidigital.operationalhub.externalservices.bigquery.exception.BigQueryExternalException;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqDelete;
import com.aidigital.operationalhub.service.agency.bigquery.model.BqInsert;
import com.aidigital.operationalhub.service.exception.BusinessException;
import com.aidigital.operationalhub.service.exception.enums.OperationalHubErrorReason;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * Executes {@link BqInsert} statements against the report-rows adjustments write table on behalf of
 * report-row services, centralising the qualified table name and the
 * {@link BigQueryExternalException} → {@link BusinessException} translation that would otherwise be
 * duplicated per caller — the write-side counterpart of {@link BigQuerySearchGateway}.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class BigQueryWriteGateway {

	private final BigQueryWriteClient bigQueryWriteClient;
	private final BigQueryProperties bigQueryProperties;

	/**
	 * Returns the qualified adjustments write table name (see {@link #qualify(String)}).
	 *
	 * @return the qualified write table name
	 */
	public String writeTable() {
		return qualify(bigQueryProperties.getWriteTable());
	}

	/**
	 * Returns the qualified conversions adjustments write table name - the conversions counterpart of
	 * {@link #writeTable()}, a table of its own because a conversions row is identified by a conversion
	 * action the delivery table has no column for.
	 *
	 * @return the qualified conversions write table name
	 */
	public String conversionsWriteTable() {
		return qualify(bigQueryProperties.getConversionsWriteTable());
	}

	/**
	 * Qualifies a configured table name to a form BigQuery can resolve, mirroring
	 * {@link BigQuerySearchGateway#qualify(String)}: a name that already contains a {@code .} is
	 * returned verbatim; a bare table name is prefixed with the configured dataset when one is set.
	 *
	 * @param table the configured table name
	 * @return the qualified table name
	 */
	public String qualify(String table) {
		if (table == null || table.contains(".")) {
			return table;
		}
		String dataset = bigQueryProperties.getDataset();
		return dataset == null || dataset.isBlank() ? table : dataset + "." + table;
	}

	/**
	 * Runs the insert and returns the number of rows written.
	 *
	 * @param insert the prepared insert statement
	 * @return the number of rows written
	 * @throws BusinessException OPH_026 when the BigQuery write fails
	 */
	public long insert(BqInsert insert) {
		try {
			return bigQueryWriteClient.execute(insert.sql());
		} catch (BigQueryExternalException ex) {
			log.error("Failed to write BigQuery adjustments", ex);
			throw new BusinessException(OperationalHubErrorReason.OPH_026, ex, causeMessage(ex));
		}
	}

	/**
	 * Runs the delete and returns the number of rows removed.
	 *
	 * <p>Fails loudly rather than tolerantly, and a caller that deletes before inserting must treat that as
	 * fatal to the whole write. BigQuery has no upsert here: the delete is what makes the insert a
	 * replacement instead of an addition, so an insert that proceeded after a failed delete would leave two
	 * rows for one key - and the conversions view, unlike the delivery one, would then count both.
	 *
	 * @param delete the prepared delete statement
	 * @return the number of rows removed
	 * @throws BusinessException OPH_026 when the BigQuery delete fails
	 */
	public long delete(BqDelete delete) {
		try {
			return bigQueryWriteClient.execute(delete.sql());
		} catch (BigQueryExternalException ex) {
			log.error("Failed to delete BigQuery adjustments", ex);
			throw new BusinessException(OperationalHubErrorReason.OPH_026, ex, causeMessage(ex));
		}
	}

	/**
	 * Extracts the most specific human-readable failure reason from a write exception, preferring its
	 * cause's own message (e.g. the BigQuery SDK's "Access Denied: ..." text) over the wrapper's generic
	 * message when a cause is present, so OPH_026 tells the caller what actually went wrong rather than
	 * just that something did.
	 *
	 * @param ex the write failure
	 * @return the most specific available failure description
	 */
	String causeMessage(BigQueryExternalException ex) {
		Throwable cause = ex.getCause();
		return cause != null && cause.getMessage() != null ? cause.getMessage() : ex.getMessage();
	}
}
