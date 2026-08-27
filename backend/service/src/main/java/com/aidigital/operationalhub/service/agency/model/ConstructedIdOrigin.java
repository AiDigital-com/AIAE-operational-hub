package com.aidigital.operationalhub.service.agency.model;

/**
 * Where a constructed id shown to the user came from - PDI_117's Add Line never lets a user type one
 * directly (see {@code ResolvedConstructedId}).
 */
public enum ConstructedIdOrigin {

	/**
	 * The id belongs to a real platform entity already present in the campaign's mart data - the user
	 * selected it through the cascading picker (Add Line mode A).
	 */
	EXISTING,

	/**
	 * The id was freshly generated, deterministically, from a typed name that has no matching mart
	 * entity yet (Add Line mode B).
	 */
	GENERATED
}
