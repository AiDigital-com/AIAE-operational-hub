CREATE TABLE hub_report_views
(
    id          BIGINT NOT NULL,
    campaign_id BIGINT NOT NULL,
    name        TEXT   NOT NULL,
    type        TEXT   NOT NULL,
    status      TEXT   NOT NULL,
    note        TEXT,
    dimensions  TEXT   NOT NULL,
    metrics     TEXT   NOT NULL,
    created_at  TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL,
    updated_at  TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT pk_hub_report_views PRIMARY KEY (id)
);

CREATE UNIQUE INDEX uq_hub_report_views_campaign_name ON hub_report_views (campaign_id, lower(name));
CREATE INDEX idx_hub_report_views_campaign_id ON hub_report_views (campaign_id);

CREATE SEQUENCE hub_report_views_seq START WITH 1 INCREMENT BY 50;
