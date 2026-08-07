package com.aidigital.operationalhub.domain.entity;

import jakarta.persistence.Column;
import jakarta.persistence.EntityListeners;
import jakarta.persistence.MappedSuperclass;
import lombok.Getter;
import lombok.Setter;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.annotation.LastModifiedDate;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;

import java.time.LocalDateTime;

/**
 * Base class for entities that track creation and modification timestamps.
 *
 * <p>Timestamps are managed automatically by Spring Data JPA auditing: {@code created_at} is set on
 * insert and {@code updated_at} is set on insert and refreshed on every update. Auditing requires
 * {@code @EnableJpaAuditing} to be active in the application context.
 */
@Getter
@Setter
@MappedSuperclass
@EntityListeners(AuditingEntityListener.class)
public abstract class AuditAwareEntity {

	@CreatedDate
	@Column(name = "created_at")
	private LocalDateTime createdAt;

	@LastModifiedDate
	@Column(name = "updated_at")
	private LocalDateTime updatedAt;
}
