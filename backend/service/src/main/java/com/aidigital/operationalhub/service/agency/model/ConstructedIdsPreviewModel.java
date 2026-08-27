package com.aidigital.operationalhub.service.agency.model;

/**
 * The three constructed-name levels' previewed ids for an Add Line mode B row (PDI_117), each hashed
 * from its own name independently.
 *
 * @param level1 the level-1 (line-item-level) resolved id
 * @param level2 the level-2 (insertion-order-level) resolved id
 * @param level3 the level-3 (campaign-level) resolved id
 */
public record ConstructedIdsPreviewModel(
		ResolvedConstructedId level1, ResolvedConstructedId level2, ResolvedConstructedId level3) {

}
