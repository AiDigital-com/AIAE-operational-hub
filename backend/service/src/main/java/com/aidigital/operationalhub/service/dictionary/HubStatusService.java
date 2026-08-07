package com.aidigital.operationalhub.service.dictionary;

import com.aidigital.operationalhub.domain.enums.HubStatus;

import java.util.List;

/**
 * Provides the lifecycle status dictionary sourced from the {@link HubStatus} enum.
 *
 * <p>Statuses are a fixed code dictionary rather than a database entity, so this service exposes the
 * enum values for the user-management filters without touching a repository.
 */
public interface HubStatusService {

	/**
	 * Lists all lifecycle statuses.
	 *
	 * @return all {@link HubStatus} values
	 */
	List<HubStatus> listStatuses();
}
