package com.aidigital.operationalhub.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.SequenceGenerator;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NonNull;
import lombok.Setter;

import java.util.Objects;

/**
 * JPA entity mapping the {@code hub_campaign_shares} table: a NetSuite campaign shared with one Hub
 * user from inside the campaign ("Add people"). The row widens that user's visibility to the campaign
 * and, through the Pacing scope the Hub signs, to every pacing under it - whatever team they are on.
 * Removing access deletes the row.
 */
@Getter
@Setter
@Entity
@Table(name = "hub_campaign_shares")
public class HubCampaignShare extends AuditAwareEntity {

	@Id
	@NonNull
	@Column(name = "id", nullable = false)
	@GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "hub_campaign_shares_sequence")
	@SequenceGenerator(sequenceName = "HUB_CAMPAIGN_SHARES_SEQ", name = "hub_campaign_shares_sequence")
	private Long id;

	/**
	 * The NetSuite campaign id that was shared.
	 */
	@Column(name = "campaign_id", nullable = false)
	private Long campaignId;

	/**
	 * The person the campaign was shared with ({@code hub_users.id}).
	 */
	@Column(name = "user_id", nullable = false)
	private Long userId;

	/**
	 * Who shared it ({@code hub_users.id}).
	 */
	@Column(name = "granted_by_user_id", nullable = false)
	private Long grantedByUserId;

	/**
	 * Where the share came from (see {@code com.aidigital.operationalhub.domain.enums.CampaignShareSource}):
	 * "Add people" on the campaign, or the automatic grant that follows owning a pacing on it.
	 */
	@Column(name = "source", nullable = false)
	private String source;

	@Override
	public boolean equals(Object o) {
		if (this == o) {
			return true;
		}
		if (!(o instanceof HubCampaignShare that)) {
			return false;
		}
		return Objects.equals(getId(), that.getId());
	}

	@Override
	public int hashCode() {
		return Objects.hash(getId());
	}

	@Override
	public String toString() {
		return "HubCampaignShare{" +
				"id=" + id +
				", campaignId=" + campaignId +
				", userId=" + userId +
				", grantedByUserId=" + grantedByUserId +
				", source=" + source +
				"}";
	}
}
