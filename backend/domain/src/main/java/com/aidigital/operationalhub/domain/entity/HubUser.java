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
 * JPA entity mapping the {@code hub_users} table.
 */
@Getter
@Setter
@Entity
@Table(name = "hub_users")
@Cache(usage = CacheConcurrencyStrategy.READ_WRITE)
public class HubUser extends AuditAwareEntity {

	@Id
	@NonNull
	@Column(name = "id", nullable = false)
	@GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "hub_users_sequence")
	@SequenceGenerator(sequenceName = "HUB_USERS_SEQ", name = "hub_users_sequence")
	private Long id;

	@Column(name = "clerk_user_id")
	private String clerkUserId;

	@Column(name = "email")
	private String email;

	@Column(name = "display_name")
	private String displayName;

	@Column(name = "status")
	private String status;

	/**
	 * Seniority grade code (see {@code com.aidigital.operationalhub.domain.enums.Grade}), or {@code null}
	 * when not yet synced/classified.
	 */
	@Column(name = "grade")
	private String grade;

	/**
	 * This employee's {@code user_id} in Pacing's own {@code access.users} table (a UUID, stored as
	 * text), written back by the Pacing user sync (§2 of the migration plan). {@code null} until the
	 * first successful sync for this user — a brand-new Hub employee has no Pacing row yet.
	 */
	@Column(name = "pacing_user_id")
	private String pacingUserId;

	@Override
	public boolean equals(Object o) {
		if (this == o) {
			return true;
		}
		if (!(o instanceof HubUser epicrisis)) {
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
		return "HubUserEntity{" +
				"id=" + id +
				"}";
	}
}
