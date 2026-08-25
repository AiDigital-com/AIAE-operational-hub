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
 * JPA entity mapping the {@code hub_agency_owner_overrides} table: an explicit, admin-owned statement of
 * the form "when NetSuite attributes an agency to employee X, treat it as belonging to the team led by
 * employee Y". Both sides are {@code hub_users} rows, so neither can point at somebody who does not exist.
 * Consulted by {@code NetSuiteSyncReconciler} before its three automatic Team-Lead name/email-match
 * attempts, so a deliberate human decision can also correct a wrong automatic match, not only fill a gap
 * left by one.
 *
 * <p>Exists because the answer is absent from both source systems, not because the matching is weak.
 * NetSuite records an agency's owner as a free-text name; when that owner is a director, nothing in
 * NetSuite or Rippling says which of the teams beneath them the agency belongs to. {@code regional_team}
 * was measured as a candidate discriminator and rejected: every agency owned by the Brandworks Senior
 * Director carries both {@code Brand Works} and {@code House}, so there is nothing to narrow by. Other
 * owners resolve to nobody at all (one owner is spelled three ways across NetSuite, Rippling and her
 * mailbox) or to two different real employees. No heuristic can decide those; a person has to, and this
 * table is where that decision is recorded.
 *
 * <p>Because the owner is a {@code hub_users} row rather than free text, this table can only express an
 * owner whose NetSuite spelling matches their Rippling {@code display_name}. An owner spelled differently
 * in the two systems cannot be represented here at all and needs the automatic matching to be widened
 * instead.
 */
@Getter
@Setter
@Entity
@Table(name = "hub_agency_owner_overrides")
public class HubAgencyOwnerOverride extends AuditAwareEntity {

	@Id
	@NonNull
	@Column(name = "id", nullable = false)
	@GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "hub_agency_owner_overrides_sequence")
	@SequenceGenerator(sequenceName = "HUB_AGENCY_OWNER_OVERRIDES_SEQ", name = "hub_agency_owner_overrides_sequence")
	private Long id;

	/**
	 * The {@code hub_users} row of the person NetSuite records as the agency owner. Matched against an
	 * agency's {@code mpo_team_lead} through this user's own {@code display_name}, so the override applies
	 * to exactly the agencies NetSuite attributes to them.
	 */
	@Column(name = "owner_user_id", nullable = false)
	private Long ownerUserId;

	/**
	 * The {@code hub_users} row of the Team Lead whose current team should own this owner's agencies.
	 * Deliberately the Team Lead rather than {@code hub_teams.id}: {@code hub_teams} rows are keyed by
	 * {@code team_name} in {@code reconcileTeams}, so a display-name-format change creates a new row and
	 * deactivates the old one - the team this mechanism was introduced for is the fourth {@code hub_teams}
	 * row for the same team. A {@code hub_users} row survives a rename, because it is matched by email and
	 * updated in place.
	 */
	@Column(name = "team_lead_user_id", nullable = false)
	private Long teamLeadUserId;

	/**
	 * Why this override exists, in the author's own words. Mandatory and constrained non-blank at the
	 * database level: nothing in NetSuite or Rippling says which team beneath a director owns which of
	 * their agencies, so this row's whole purpose is to record a decision only a human can make. A row
	 * without a stated reason is an unattributable claim that nobody can later re-evaluate.
	 */
	@Column(name = "reason", nullable = false)
	private String reason;

	@Column(name = "status", nullable = false)
	private String status;

	@Override
	public boolean equals(Object o) {
		if (this == o) {
			return true;
		}
		if (!(o instanceof HubAgencyOwnerOverride that)) {
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
		return "HubAgencyOwnerOverride{" +
				"id=" + id +
				", ownerUserId=" + ownerUserId +
				", teamLeadUserId=" + teamLeadUserId +
				", status='" + status + '\'' +
				"}";
	}
}
