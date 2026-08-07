package com.aidigital.operationalhub.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.SequenceGenerator;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NonNull;
import lombok.Setter;
import org.hibernate.annotations.Cache;
import org.hibernate.annotations.CacheConcurrencyStrategy;

import java.util.Objects;

/**
 * JPA entity mapping the {@code hub_role_assignments} table.
 */
@Getter
@Setter
@Entity
@Table(name = "hub_role_assignments")
@Cache(usage = CacheConcurrencyStrategy.READ_WRITE)
public class HubRoleAssignment extends AuditAwareEntity {

	@Id
	@NonNull
	@Column(name = "id", nullable = false)
	@GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "hub_role_assignments_sequence")
	@SequenceGenerator(sequenceName = "HUB_ROLE_ASGNM_SEQ", name = "hub_role_assignments_sequence")
	private Long id;

	@Column(name = "user_id")
	private Long userId;

	@ManyToOne(fetch = FetchType.LAZY)
	@JoinColumn(name = "role_id")
	private HubRole role;

	@ManyToOne(fetch = FetchType.LAZY)
	@JoinColumn(name = "scope_type_id")
	private HubScopeType scopeType;

	@Column(name = "scope_id")
	private Long scopeId;

	@Column(name = "status")
	private String status;

	@Column(name = "created_by_user_id")
	private Long createdByUserId;

	@Override
	public boolean equals(Object o) {
		if (this == o) {
			return true;
		}
		if (!(o instanceof HubRoleAssignment epicrisis)) {
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
		return "HubRoleAssignment{" +
				"id=" + id +
				"}";
	}
}
