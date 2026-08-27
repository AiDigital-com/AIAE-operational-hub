package com.aidigital.operationalhub.service.agency.bigquery.model;

import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * Which whitelisted name/id column pair the Add Line name-resolution read (PDI_117) uses for one
 * constructed-name level - the same three levels {@code BigQueryReportRowService} already selects for
 * every report row, named the way the OpenAPI contract's {@code ConstructedEntityLevelEnumV1} names them.
 */
@Getter
@RequiredArgsConstructor
public enum ConstructedEntityLevel {

	/**
	 * The level-1 constructed name/id - the line item on most platforms.
	 */
	LVL1(BigQueryAdjustmentsViewColumns.CONSTRUCTED_NAME, BigQueryAdjustmentsViewColumns.CONSTRUCTED_ID),

	/**
	 * The level-2 constructed name/id - the insertion order on most platforms.
	 */
	LVL2(BigQueryAdjustmentsViewColumns.CONSTRUCTED_NAME_LVL2, BigQueryAdjustmentsViewColumns.CONSTRUCTED_ID_LVL2),

	/**
	 * The level-3 constructed name/id - the creative on most platforms.
	 */
	LVL3(BigQueryAdjustmentsViewColumns.CONSTRUCTED_NAME_LVL3, BigQueryAdjustmentsViewColumns.CONSTRUCTED_ID_LVL3);

	private final String nameColumn;
	private final String idColumn;
}
