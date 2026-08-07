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
 * JPA entity mapping the {@code hub_team_agencies} table: which IO Lines agency belongs to which
 * team. Populated by the NetSuite/Rippling sync (an agency's MPO team lead determines its team), and
 * read by team-scoped RBAC visibility. An agency belongs to at most one team.
 */
@Getter
@Setter
@Entity
@Table(name = "hub_team_agencies")
public class HubTeamAgency extends AuditAwareEntity {

	@Id
	@NonNull
	@Column(name = "id", nullable = false)
	@GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "hub_team_agencies_sequence")
	@SequenceGenerator(sequenceName = "HUB_TEAM_AGENCIES_SEQ", name = "hub_team_agencies_sequence")
	private Long id;

	/**
	 * The owning team ({@code hub_teams.id}).
	 */
	@Column(name = "team_id", nullable = false)
	private Long teamId;

	/**
	 * The IO Lines agency id this team owns.
	 */
	@Column(name = "agency_id", nullable = false)
	private Long agencyId;

	@Override
	public boolean equals(Object o) {
		if (this == o) {
			return true;
		}
		if (!(o instanceof HubTeamAgency that)) {
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
		return "HubTeamAgency{" +
				"id=" + id +
				", teamId=" + teamId +
				", agencyId=" + agencyId +
				"}";
	}
}
