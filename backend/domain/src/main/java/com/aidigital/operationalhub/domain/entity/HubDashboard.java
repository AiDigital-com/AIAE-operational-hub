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

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Objects;

/**
 * JPA entity mapping the {@code hub_dashboards} table - one dashboard definition scoped to a campaign,
 * and the BigQuery data source it has been written to, if any.
 *
 * <p>A dashboard is not a report. A report is read in the Hub and its columns are the user's own choice; a
 * dashboard exists to hand one fixed-schema table to ClicData, which renders it. That is why the selected
 * columns are not stored here the way a report's are - the type dictates them, and only the handful the user
 * may switch off is worth recording (see {@link #optionalColumns}).
 */
@Getter
@Setter
@Entity
@Table(name = "hub_dashboards")
@Cache(usage = CacheConcurrencyStrategy.READ_WRITE)
public class HubDashboard extends AuditAwareEntity {

	@Id
	@NonNull
	@Column(name = "id", nullable = false)
	@GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "hub_dashboards_sequence")
	@SequenceGenerator(sequenceName = "HUB_DASHBOARDS_SEQ", name = "hub_dashboards_sequence")
	private Long id;

	@Column(name = "campaign_id", nullable = false)
	private Long campaignId;

	@Column(name = "name")
	private String name;

	/**
	 * Dashboard type code (see {@code DashboardType}); {@code "basic"} is the only one built today.
	 *
	 * <p>The type is the schema: it decides which dimensions and metrics the data source carries, so it is
	 * chosen when the dashboard is created and never edited afterwards. Changing it would silently redefine
	 * the columns of a table ClicData is already pointing at.
	 */
	@Column(name = "type")
	private String type;

	/**
	 * Dashboard status code (see {@code DashboardStatus}): {@code "draft"} or {@code "live"}.
	 */
	@Column(name = "status")
	private String status;

	/**
	 * Comma-joined ids of the optional columns the user kept - exactly those, so an empty string means none
	 * of them were kept.
	 *
	 * <p>Only the optional ones. The mandatory columns are the type's own contract, and storing them would
	 * create a row that can disagree with the code about what "Basic" means.
	 *
	 * <p>The value is total: the contract requires it, so "kept nothing" is written as an empty string and
	 * never confused with "nobody said". Read literally, without a default - a fallback here would be a
	 * second opinion about the schema, and the only honest one belongs to the type.
	 */
	@Column(name = "optional_columns")
	private String optionalColumns;

	/**
	 * JSON array of persisted dashboard dataset filters ({@code {field, values}}); null when no filters are
	 * saved.
	 */
	@Column(name = "filters")
	private String filters;

	/**
	 * Comma-separated column ids in the order the user arranged the preview; null or empty while they have
	 * not rearranged it, both read as "no order".
	 *
	 * <p>This is how the preview is read, not what the data source contains: the written table always
	 * carries the type's own column order, because that is what the ClicData template binds to. Null
	 * rather than a full default list, so a column the order does not mention - the optional pair,
	 * switched back on after a drag - can fall in behind the ones it does.
	 */
	@Column(name = "column_order")
	private String columnOrder;

	/**
	 * Inclusive first dataset date applied to preview rows and source writes; null means open-ended.
	 */
	@Column(name = "date_from")
	private LocalDate dateFrom;

	/**
	 * Inclusive last dataset date applied to preview rows and source writes; null means open-ended.
	 */
	@Column(name = "date_to")
	private LocalDate dateTo;

	/**
	 * The fully-qualified BigQuery table the data source was written to; null until it has been.
	 *
	 * <p>This is the one field the whole feature exists to produce - it is what a user copies into ClicData.
	 * Null here is what makes a dashboard a draft; see {@link #status}, which records the same fact for
	 * listing and must be kept in step with it.
	 */
	@Column(name = "source_table")
	private String sourceTable;

	/**
	 * How many rows the last write put in {@link #sourceTable}; null until the source exists.
	 */
	@Column(name = "source_row_count")
	private Long sourceRowCount;

	/**
	 * When the data source was last written; null until it has been.
	 */
	@Column(name = "source_created_at")
	private LocalDateTime sourceCreatedAt;

	/**
	 * The campaign name as the dashboard should display it, which the user may edit before confirming.
	 *
	 * <p>Deliberately not the campaign's own name: the Hub's name carries internal conventions, and a
	 * client-facing dashboard usually wants a cleaner label. Null means nobody has changed it, so the
	 * campaign's name applies.
	 */
	@Column(name = "display_campaign_name")
	private String displayCampaignName;

	@Override
	public boolean equals(Object o) {
		if (this == o) {
			return true;
		}
		if (!(o instanceof HubDashboard other)) {
			return false;
		}
		return id != null && id.equals(other.getId());
	}

	@Override
	public int hashCode() {
		return Objects.hashCode(id);
	}
}
