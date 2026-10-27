package com.aidigital.operationalhub.service.campaignshare.impl;

import com.aidigital.operationalhub.domain.entity.HubUser;
import com.aidigital.operationalhub.domain.enums.CampaignShareSource;
import com.aidigital.operationalhub.externalservices.pacing.PacingCampaignAccessClient;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCampaignPacing;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCampaignRef;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingCreateLineItem;
import com.aidigital.operationalhub.externalservices.pacing.model.PacingLineItemPlanUpdate;
import com.aidigital.operationalhub.service.campaignshare.CampaignShareAutoGrantService;
import com.aidigital.operationalhub.service.entity.HubUserService;
import com.aidigital.operationalhub.service.rbac.PacingCampaignIndexService;
import com.aidigital.operationalhub.service.rbac.model.CurrentUserModel;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.Collection;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;

/**
 * Default {@link CampaignShareAutoGrantService}. Parses the campaign ids Pacing carries as text, hands
 * them to {@link CampaignShareGrantWriter}, and swallows - loudly - anything that goes wrong, since
 * the Pacing write this follows has already succeeded.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CampaignShareAutoGrantServiceImpl implements CampaignShareAutoGrantService {

	private final CampaignShareGrantWriter grantWriter;
	private final HubUserService hubUserService;
	private final PacingCampaignAccessClient pacingCampaignAccessClient;
	private final PacingCampaignIndexService pacingCampaignIndexService;

	@Override
	public void grantAfterPacingCreate(CurrentUserModel creator, List<PacingCreateLineItem> lineItems) {
		Set<Long> campaignIds = parseCampaignIds(lineItems.stream().map(PacingCreateLineItem::campaignId).toList());
		grantQuietly("pacing create", creator.id(), creator.id(), campaignIds);
		evictIndexQuietly();
	}

	@Override
	public void grantAfterPlanSave(CurrentUserModel saver, List<PacingLineItemPlanUpdate> lineItems) {
		Set<Long> campaignIds = parseCampaignIds(lineItems.stream().map(PacingLineItemPlanUpdate::campaignId).toList());
		grantQuietly("plan save", saver.id(), saver.id(), campaignIds);
		evictIndexQuietly();
	}

	@Override
	public void grantAfterOwnerTransfer(CurrentUserModel actor, String pacingId, String newOwnerPacingUserId) {
		try {
			Optional<HubUser> recipient = hubUserService.findByPacingUserId(newOwnerPacingUserId);
			if (recipient.isEmpty()) {
				log.error("Auto-share after owner transfer skipped: no Hub user carries pacingUserId={} (pacingId={})",
						newOwnerPacingUserId, pacingId);
				return;
			}
			PacingCampaignPacing pacing = pacingCampaignAccessClient.getPacing(pacingId);
			Set<Long> campaignIds = parseCampaignIds(pacing.campaigns().stream().map(PacingCampaignRef::id).toList());
			grantWriter.grant(actor.id(), recipient.get().getId(), campaignIds, CampaignShareSource.PACING_CREATED);
		} catch (RuntimeException ex) {
			log.error("Auto-share after owner transfer failed: pacingId={}, newOwnerPacingUserId={}, byUserId={}",
					pacingId, newOwnerPacingUserId, actor.id(), ex);
		}
	}

	/**
	 * Writes the grant, logging rather than throwing on failure: the request this follows has done its
	 * real work already.
	 *
	 * @param what            which write this follows, for the log line
	 * @param actorUserId     who is granting
	 * @param recipientUserId who receives
	 * @param campaignIds     the campaigns
	 */
	void grantQuietly(String what, Long actorUserId, Long recipientUserId, Collection<Long> campaignIds) {
		if (campaignIds.isEmpty()) {
			return;
		}
		try {
			grantWriter.grant(actorUserId, recipientUserId, campaignIds, CampaignShareSource.PACING_CREATED);
		} catch (RuntimeException ex) {
			log.error("Auto-share after {} failed: toUserId={}, campaignIds={}",
					what, recipientUserId, campaignIds, ex);
		}
	}

	/**
	 * Forgets the cached campaigns-with-pacings set so the team sees a new pacing at once, logging
	 * rather than throwing on failure for the same reason as {@link #grantQuietly}.
	 */
	void evictIndexQuietly() {
		try {
			pacingCampaignIndexService.evict();
		} catch (RuntimeException ex) {
			log.error("Could not evict the campaigns-with-pacings cache after a pacing write", ex);
		}
	}

	/**
	 * Parses Pacing's text campaign ids into NetSuite ids, dropping blanks, non-numbers and repeats.
	 *
	 * @param rawIds the ids as Pacing carries them, nulls allowed
	 * @return the distinct numeric ids, sorted
	 */
	Set<Long> parseCampaignIds(Collection<String> rawIds) {
		Set<Long> result = new TreeSet<>();
		for (String raw : rawIds) {
			if (raw == null || raw.isBlank()) {
				continue;
			}
			try {
				result.add(Long.parseLong(raw.trim()));
			} catch (NumberFormatException ex) {
				log.warn("Ignoring a non-numeric campaign id on a pacing line item: {}", raw);
			}
		}
		return Objects.requireNonNullElse(result, Set.of());
	}
}
