package com.aidigital.operationalhub.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NonNull;
import lombok.Setter;
import org.hibernate.annotations.Cache;
import org.hibernate.annotations.CacheConcurrencyStrategy;
import org.hibernate.annotations.Immutable;

import java.util.Objects;

/**
 * JPA entity mapping the {@code hub_scope_types} dictionary table.
 */
@Getter
@Setter
@Entity
@Immutable
@Table(name = "hub_scope_types")
@Cache(usage = CacheConcurrencyStrategy.READ_ONLY)
public class HubScopeType extends AuditAwareEntity {

	@Id
	@NonNull
	@Column(name = "id", nullable = false)
	private Long id;

	@Column(name = "scope_code")
	private String scopeCode;

	@Column(name = "display_name")
	private String displayName;

	@Column(name = "description")
	private String description;

	@Column(name = "status")
	private String status;

	@Override
	public boolean equals(Object o) {
		if (this == o) {
			return true;
		}
		if (!(o instanceof HubScopeType epicrisis)) {
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
		return "HubScopeType{" +
				"id=" + id +
				"}";
	}
}
