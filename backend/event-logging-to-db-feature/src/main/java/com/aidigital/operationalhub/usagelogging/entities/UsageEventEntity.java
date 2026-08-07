// UsageEventEntity — JPA mapping for usage_events. The matching Liquibase
// changelog lives in the `migrations` module at
// migrations/src/main/resources/db/changelog/changes/0001-usage-events.xml — that's
// intentional: every migration in the project sits in `migrations`, never alongside
// the @Entity that consumes it. PostgresUsageLogger maps record → entity at
// the persistence boundary.

package com.aidigital.operationalhub.usagelogging.entities;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.Hibernate;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.Map;

/**
 * Persistence model for a usage logging event.
 *
 * <p>This feature module is intentionally self-contained: it owns its Long
 * database id and ID-based {@code equals}/{@code hashCode} directly instead of
 * extending a shared base class, so the whole feature can be removed without
 * leaving an internal Maven edge behind.
 *
 * <p>Transient instances (id == null) are equal only to themselves and hash to
 * 0; do not place transient usage events into hash-based collections before
 * persistence, because assigning the generated id changes {@code hashCode}.
 */
@Entity
@Table(name = "usage_events")
@Getter
@Setter
@NoArgsConstructor
public class UsageEventEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "event_id", unique = true, nullable = false)
    private String eventId;

    @Column(name = "event_timestamp", nullable = false)
    private LocalDateTime eventTimestamp;

    @Column(nullable = false)
    private String service;

    private String environment;

    @Column(name = "event_type", nullable = false)
    private String eventType;

    private String action;

    @Column(name = "user_id")
    private String userId;

    @Column(name = "user_email")
    private String userEmail;

    private String status;

    @Column(name = "duration_ms")
    private Long durationMs;

    @Column(name = "attributes", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Object> attributes;

    @Column(name = "error_message")
    private String errorMessage;

    @Column(name = "client_ip")
    private String clientIp;

    @Column(name = "user_agent")
    private String userAgent;

    /**
     * Hibernate-proxy-compatible identity equality: two entities are equal only
     * when both have the same non-null id and the same effective entity type.
     *
     * @param other candidate to compare against
     * @return true when both entities share a non-null id and entity type
     */
    @Override
    public final boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        if (other == null || Hibernate.getClass(this) != Hibernate.getClass(other)) {
            return false;
        }
        UsageEventEntity that = (UsageEventEntity) other;
        return id != null && id.equals(that.id);
    }

    /**
     * Stable hash derived from the entity type while transient and from the id
     * once assigned.
     *
     * @return identity-based hash code
     */
    @Override
    public final int hashCode() {
        return id != null ? id.hashCode() : 0;
    }
}
