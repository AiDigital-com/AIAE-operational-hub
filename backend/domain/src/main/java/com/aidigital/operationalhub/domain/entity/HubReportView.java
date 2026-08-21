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
 * JPA entity mapping the {@code hub_report_views} table - a saved (or draft) report definition
 * scoped to one campaign.
 */
@Getter
@Setter
@Entity
@Table(name = "hub_report_views")
@Cache(usage = CacheConcurrencyStrategy.READ_WRITE)
public class HubReportView extends AuditAwareEntity {

	@Id
	@NonNull
	@Column(name = "id", nullable = false)
	@GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "hub_report_views_sequence")
	@SequenceGenerator(sequenceName = "HUB_REPORT_VIEWS_SEQ", name = "hub_report_views_sequence")
	private Long id;

	@Column(name = "campaign_id", nullable = false)
	private Long campaignId;

	@Column(name = "name")
	private String name;

	/**
	 * Report type code (see {@code ReportViewType}); {@code "basic"} today.
	 */
	@Column(name = "type")
	private String type;

	/**
	 * Report status code (see {@code ReportViewStatus}): {@code "draft"} or {@code "saved"}.
	 */
	@Column(name = "status")
	private String status;

	@Column(name = "note")
	private String note;

	/**
	 * Comma-joined selected dimension ids (never null; empty string when none selected).
	 */
	@Column(name = "dimensions")
	private String dimensions;

	/**
	 * Comma-joined selected metric ids (never null; empty string when none selected).
	 */
	@Column(name = "metrics")
	private String metrics;

	/**
	 * JSON array of persisted ReportRowFilter directives ({@code {field, values}}); null when no filters saved.
	 */
	@Column(name = "filters")
	private String filters;

	/**
	 * Comma-joined on-screen column arrangement (dimension and metric ids interleaved); null or empty
	 * when the report uses the default arrangement (every dimension, then every metric).
	 */
	@Column(name = "column_order")
	private String columnOrder;

	@Override
	public boolean equals(Object o) {
		if (this == o) {
			return true;
		}
		if (!(o instanceof HubReportView other)) {
			return false;
		}
		return Objects.equals(getId(), other.getId());
	}

	@Override
	public int hashCode() {
		return Objects.hash(getId());
	}

	@Override
	public String toString() {
		return "HubReportView{" +
				"id=" + id +
				"}";
	}
}
