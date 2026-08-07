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
import org.hibernate.annotations.Cache;
import org.hibernate.annotations.CacheConcurrencyStrategy;

import java.util.Objects;

/**
 * JPA entity mapping the {@code hub_teams} table.
 */
@Getter
@Setter
@Entity
@Table(name = "hub_teams")
@Cache(usage = CacheConcurrencyStrategy.READ_WRITE)
public class HubTeam extends AuditAwareEntity {

	@Id
	@NonNull
	@Column(name = "id", nullable = false)
	@GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "hub_teams_sequence")
	@SequenceGenerator(sequenceName = "HUB_TEAMS_SEQ", name = "hub_teams_sequence")
	private Long id;

	@Column(name = "team_name")
	private String teamName;

	@Column(name = "pod_key")
	private String podKey;

	@Column(name = "status")
	private String status;

	/**
	 * Whether this team was synced from NetSuite; such teams are read-only in the app.
	 */
	@Column(name = "from_netsuite", nullable = false)
	private boolean fromNetSuite;

	/**
	 * {@code hub_users.id} of this team's Team Lead, or {@code null} when not yet resolved.
	 */
	@Column(name = "team_lead_user_id")
	private Long teamLeadUserId;

	@Override
	public boolean equals(Object o) {
		if (this == o) {
			return true;
		}
		if (!(o instanceof HubTeam epicrisis)) {
			return false;
		}
		return Objects.equals(getId(), epicrisis.getId());
	}

	@Override
	public int hashCode() {
		return Objects.hash(getId());
	}

	@Override
	public String toString() {
		return "HubTeam{" +
				"id=" + id +
				"}";
	}
}
