package com.aidigital.operationalhub.service.campaignshare;

import com.aidigital.operationalhub.externalservices.pacing.model.PacingCreateLineItem;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLineItemPlanUpdate;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;

import java.util.List;

/**
 * Keeps a campaign's people list in step with who owns pacings on it (2026-10-23): whoever creates a
 * pacing, saves a plan onto a campaign, or receives a pacing in a transfer is put on each of its
 * campaigns as a {@code pacing_created} share, granted by the acting user. Idempotent - an existing
 * share, manual or automatic, is never duplicated or overwritten - and always inserted rather than
 * skipped for people who already see the campaign through their team: the row records why the person
 * is there, and keeps their access to their own pacing's campaigns stable when the nightly sync moves
 * agencies between teams.
 *
 * <p>Every method runs AFTER the Pacing write succeeded and never fails the request that triggered
 * it: a grant that cannot be written is logged at error level, since the person still sees their
 * pacing through their team almost always, and the pacing itself must not read as "not created".
 */
public interface CampaignShareAutoGrantService {

	/**
	 * After a successful pacing create: the creator on every campaign of the line items. Also forgets
	 * the cached campaigns-with-pacings set, so the creator's team sees the new pacing at once.
	 *
	 * @param creator   the user who created the pacing
	 * @param lineItems the line items the pacing was created from
	 */
	void grantAfterPacingCreate(CurrentUserModel creator, List<PacingCreateLineItem> lineItems);

	/**
	 * After a successful plan save: the saver on every campaign of the saved line items (which adds
	 * them on the campaigns the save brought in; the others already hold a row). Also forgets the
	 * cached campaigns-with-pacings set.
	 *
	 * @param saver     the user who saved the plan
	 * @param lineItems the whole line-item set the plan now has
	 */
	void grantAfterPlanSave(CurrentUserModel saver, List<PacingLineItemPlanUpdate> lineItems);

	/**
	 * After a successful ownership transfer: the new owner on every campaign of the pacing, granted by
	 * whoever transferred it.
	 *
	 * @param actor                the user who transferred the pacing
	 * @param pacingId             the pacing id (Pacing's own UUID primary key)
	 * @param newOwnerPacingUserId the recipient's Pacing user id
	 */
	void grantAfterOwnerTransfer(CurrentUserModel actor, String pacingId, String newOwnerPacingUserId);
}
