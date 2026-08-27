package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import java.util.List;

/**
 * PDI_117-perf: the folded V1 + three-level-resolve read's result (see
 * {@link AddedRowValidator#findScopedResolution}) - the distinct real ids each constructed-name level's
 * client-submitted name resolves to within the campaign's scope, plus whether the row's
 * platform/account/account id triple has any delivery in that same scope. One conditional-aggregate scan
 * of the adjustments view answers all four questions together, instead of the four separate scoped reads
 * this originally ran (V1 and one read per level). Package-private and local to this package's write-path
 * resolution, the same way {@link ConstructedLevelIdentity} is; not part of the public service contract.
 *
 * @param level1MatchedIds        the distinct real ids level 1's client-submitted name resolves to
 * @param level2MatchedIds        the distinct real ids level 2's client-submitted name resolves to
 * @param level3MatchedIds        the distinct real ids level 3's client-submitted name resolves to
 * @param hasKnownDeliveryAccount whether the row's platform/account/account id triple has any delivery
 *                                somewhere in the campaign's scope (PDI_117 V1)
 */
record ScopedRowResolution(
		List<String> level1MatchedIds, List<String> level2MatchedIds, List<String> level3MatchedIds,
		boolean hasKnownDeliveryAccount) {
}
