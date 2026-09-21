package com.aidigital.operationalhub.service.rbac.impl;

import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.service.entity.HubUserService;
import com.aidigital.operationalhub.service.rbac.AssignableOwnerService;
import com.aidigital.operationalhub.service.rbac.model.AssignableOwner;
import com.aidigital.operationalhub.service.rbac.model.PacingEntitlement;
import com.aidigital.operationalhub.service.rbac.model.PacingScope;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

/**
 * Resolves the people a pacing may be handed to (§11, US-131).
 *
 * <p>The set comes straight from the caller's own Pacing scope rather than from a second notion of
 * "my team": what you can see, you can assign to. Two scope kinds behave differently and both are
 * deliberate:
 *
 * <ul>
 *   <li><b>owners</b> — the scope already carries the Pacing user ids of everyone in reach
 *       (themselves plus their teams), so the list is those people, looked up for names.
 *   <li><b>all</b> — an admin's scope carries NO ids; it means "everything". There is nothing to
 *       look up, so this returns every Hub user that has a Pacing identity. Returning an empty list
 *       instead would leave admins — the people most likely to be fixing a bad assignment — unable
 *       to reassign anything.
 * </ul>
 *
 * <p>A {@code campaigns} scope resolves to nobody: it says which campaigns a Client Services person
 * may see, which answers nothing about who may own a pacing. That is an empty list, not a refusal —
 * the screen simply has no choices to offer.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AssignableOwnerServiceImpl implements AssignableOwnerService {

	private final HubUserService hubUserService;

	/**
	 * {@inheritDoc}
	 */
	@Override
	public List<AssignableOwner> resolveFor(PacingEntitlement entitlement) {
		PacingScope scope = entitlement == null ? null : entitlement.scope();
		if (scope == null) {
			return List.of();
		}
		if (PacingScope.KIND_ALL.equals(scope.kind())) {
			return toOwners(hubUserService.findAll());
		}
		if (!PacingScope.KIND_OWNERS.equals(scope.kind()) || scope.ids().isEmpty()) {
			return List.of();
		}
		Set<String> inScope = Set.copyOf(scope.ids());
		return toOwners(hubUserService.findAll().stream()
				.filter(user -> user.getPacingUserId() != null && inScope.contains(user.getPacingUserId()))
				.toList());
	}

	/**
	 * Maps Hub users onto the assignable-owner shape, dropping anyone Pacing has never heard of.
	 *
	 * <p>A user without {@code pacingUserId} is skipped rather than listed: naming them to Pacing is
	 * impossible, and offering a choice that the transfer would then refuse is worse than not
	 * offering it. Logged with a count, because a growing number means the §2 sync is falling behind
	 * — not that these people legitimately cannot own anything.
	 *
	 * @param users the Hub users to map
	 * @return assignable owners, sorted by name
	 */
	List<AssignableOwner> toOwners(List<HubUser> users) {
		List<AssignableOwner> owners = users.stream()
				.filter(user -> user.getPacingUserId() != null)
				.map(user -> new AssignableOwner(user.getPacingUserId(), user.getDisplayName(), user.getEmail()))
				.sorted(Comparator.comparing(AssignableOwner::name, Comparator.nullsLast(String::compareToIgnoreCase)))
				.toList();
		int skipped = users.size() - owners.size();
		if (skipped > 0) {
			log.info("assignable-owners: {} of {} users have no pacing_user_id yet and were omitted", skipped,
					users.size());
		}
		return owners;
	}
}
