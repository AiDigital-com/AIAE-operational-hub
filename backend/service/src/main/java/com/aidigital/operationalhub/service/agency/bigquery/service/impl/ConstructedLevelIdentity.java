package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

/**
 * One constructed-name level's resolved identity for an added row (PDI_117 D2) - either a real mart
 * entity's own name/id (V2/V5) or a freshly generated name/id (D3/V8). Package-private and local to this
 * package's write-path resolution; not part of the public service contract.
 *
 * @param name the level's name - the mart's own value when resolved, the client's typed value when generated
 * @param id   the level's id - a real platform id when resolved, an {@code OPH_}-namespaced generated id
 *             otherwise
 */
record ConstructedLevelIdentity(String name, String id) {

}
