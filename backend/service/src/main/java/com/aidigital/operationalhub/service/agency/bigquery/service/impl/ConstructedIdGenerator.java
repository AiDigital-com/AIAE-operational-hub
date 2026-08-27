package com.aidigital.operationalhub.service.agency.bigquery.service.impl;

import com.aidigital.operationalhub.service.agency.bigquery.model.ConstructedIdHash;
import com.aidigital.operationalhub.service.exception.AppException;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.List;

/**
 * Generates the deterministic, namespaced constructed id an Add Line level writes when its typed name
 * has no matching mart entity (PDI_117 D2/D3) - resolved per level, so one row may mix generated ids at
 * some levels with real ones at others.
 *
 * <pre>
 * scope = the first four "_"-separated segments of the trimmed level-1 name
 *
 * constructed_id      = "OPH_" + SHA-256( [name1]        ).hex[0..16)
 * constructed_id_lvl2 = "OPH_" + SHA-256( [scope, name2] ).hex[0..16)
 * constructed_id_lvl3 = "OPH_" + SHA-256( [scope, name3] ).hex[0..16)
 * </pre>
 *
 * <p>Level 1 is a sufficient discriminator on its own - measured, not assumed: of 48 352 distinct level-1
 * names, zero are shared by more than one {@code CNB_client} (the naming convention's first four segments
 * guarantee it). Levels 2 and 3 are not: 509 of 24 077 level-2 names and 4 143 of 143 344 level-3 names
 * are free-form strings reused across different advertisers (one level-2 name spans 169 distinct
 * clients). Hashing a bare level-2/level-3 name would therefore hand two different advertisers the same
 * generated id. Mixing in {@code scope} - the campaign-level prefix, not the whole level-1 name - fixes
 * that without coupling a level-2/3 id to whichever level-1 line happened to be added first: level 2 is
 * the <em>parent</em> of level 1 (one insertion order spans many line items), so a stable, campaign-wide
 * scope is required, not the sibling line item's own name. {@code platform} is deliberately never part
 * of the hash - it stays free text, so including it would make the same entity mint two ids depending on
 * what the user happened to type.
 *
 * <p>Deterministic so the same name always yields the same id, whoever types it and on whatever date -
 * two MPOs independently adding the same new line end up naming it identically, and the same user
 * retyping it later gets the same id again, rather than a different id per attempt. (A literal re-add of
 * the exact same date and name is rejected outright - see {@code AddedRowValidator} V4 - determinism is
 * what makes that rejection meaningful instead of arbitrary.) Namespaced because no real platform id
 * observed across every platform and level starts with {@code OPH_} (PDI_117-PLAN.md 2.2), so collision
 * with a real platform id is impossible by construction, with no BigQuery read needed at write time.
 */
@Component
class ConstructedIdGenerator {

	/** The namespace prefix no real platform id has ever been observed to start with. */
	static final String PREFIX = "OPH_";

	/** How many leading "_"-separated level-1 segments make up the campaign-level {@link #scopeOf} value. */
	static final int SCOPE_SEGMENTS = 4;

	private static final int HEX_LENGTH = 16;

	/**
	 * Generates a constructed id from an ordered list of hash components (a single-element list for
	 * level 1, {@code [scope, name]} for levels 2 and 3 - see the class Javadoc).
	 *
	 * @param components the ordered, already-trimmed components to hash; none may be blank
	 * @return the {@code OPH_}-prefixed, deterministic constructed id
	 * @throws AppException when {@code components} is empty or any component is blank
	 */
	String generate(List<String> components) {
		if (components == null || components.isEmpty() || components.stream().anyMatch(this::isBlank)) {
			throw new AppException("a constructed id cannot be generated from a blank component");
		}
		return PREFIX + ConstructedIdHash.sha256Hex(components).substring(0, HEX_LENGTH);
	}

	/**
	 * The campaign-level scope mixed into a level-2/level-3 hash: the leading {@value #SCOPE_SEGMENTS}
	 * underscore-separated segments of the trimmed level-1 name (agency id, client, industry code,
	 * campaign name), joined back with {@code _}. Safe to call once the level-1 name has already passed
	 * {@code AddedRowValidator}'s sixteen-segment check (V6), which guarantees these leading segments are
	 * present; tolerates a shorter name (fewer than four segments) by scoping on however many exist,
	 * rather than failing, since a preview read may run before that name is fully typed.
	 *
	 * @param levelOneName the level-1 constructed name
	 * @return the joined leading-segment scope
	 * @throws AppException when {@code levelOneName} is blank
	 */
	String scopeOf(String levelOneName) {
		if (isBlank(levelOneName)) {
			throw new AppException("a constructed id scope cannot be derived from a blank level-1 name");
		}
		String[] segments = levelOneName.trim().split("_", -1);
		int segmentCount = Math.min(SCOPE_SEGMENTS, segments.length);
		return String.join("_", Arrays.copyOfRange(segments, 0, segmentCount));
	}

	/**
	 * Indicates whether a hash component is missing or blank.
	 *
	 * @param value the value to check
	 * @return {@code true} when {@code null} or all-whitespace
	 */
	boolean isBlank(String value) {
		return value == null || value.isBlank();
	}
}
