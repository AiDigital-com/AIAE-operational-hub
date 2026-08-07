package com.aidigital.operationalhub.service.agency.bigquery.model;

import java.util.List;

/**
 * A single page of {@link BigQuerySearchGateway#fetchPage} results: the mapped rows for this page and
 * the total number of matching rows across every page.
 *
 * @param content the mapped rows for this page
 * @param total   the total number of matching rows across all pages
 * @param <T>     the mapped row type
 */
public record BqPage<T>(List<T> content, long total) {

}
