package com.aidigital.operationalhub.service.pacingsync;

import com.aidigital.operationalhub.service.pacingsync.model.PacingAudienceSyncSummary;

/**
 * Pushes each pacing's Hub-resolved audience — the emails RBAC entitles to open it beyond the owner
 * and delegates — to Pacing's {@code POST /api/internal/pacing-audience}.
 *
 * <p>This is the Hub-side answer to Pacing's §1 loss of the role model: Pacing's per-pacing mirror
 * Google Sheet used to grant access to the owner's manager chain, admins and the owner's team by
 * reading roles from its own database; those columns are gone, and per the migration's core split
 * ("Pacing applies access decisions, it does not make them") they must not come back. Instead this
 * service resolves the same audience from Hub RBAC and pushes it daily; Pacing stores each list
 * whole and its daily ACL sweep applies it. The owner and active delegates are NOT in these lists —
 * Pacing computes those locally so a delegation revoke changes sheet access immediately rather than
 * on the next daily push.
 */
public interface PacingAudienceSyncService {

	/**
	 * Performs a full, idempotent push: reads every pacing's id and owner from Pacing, resolves each
	 * pacing's audience from Hub RBAC (admins and ALL-scoped roles see every pacing; TEAM-scoped
	 * co-members see their team-mates' pacings), and pushes the per-pacing lists back. Full
	 * replacement per pacing, so an access revocation on the Hub side lands as the email's absence in
	 * the next push.
	 *
	 * @return a summary of what was sent and what Pacing did with it
	 */
	PacingAudienceSyncSummary sync();
}
