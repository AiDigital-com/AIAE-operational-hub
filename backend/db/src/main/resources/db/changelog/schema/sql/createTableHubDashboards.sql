CREATE TABLE hub_dashboards
(
    id                    BIGINT NOT NULL,
    campaign_id           BIGINT NOT NULL,
    name                  TEXT   NOT NULL,
    type                  TEXT   NOT NULL,
    status                TEXT   NOT NULL,
    -- Which optional columns the user kept. The mandatory ones are the type's own contract and are not
    -- stored: a row saying "the locked columns are included" would be a row that can disagree with the code.
    optional_columns      TEXT,
    -- The BigQuery table this dashboard's data source was written to, and what it cost to write. All three
    -- are null until the source is created, which is exactly what tells Draft from Live - the status column
    -- would otherwise be a second answer to the same question, free to drift from the table's existence.
    source_table          TEXT,
    source_row_count      BIGINT,
    source_created_at     TIMESTAMP(6) WITHOUT TIME ZONE,
    -- The campaign name as the dashboard should show it, which the user may edit before confirming (US-020).
    -- Not the campaign's own name: a client-facing dashboard often wants a shorter or cleaner label.
    display_campaign_name TEXT,
    created_at            TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL,
    updated_at            TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT pk_hub_dashboards PRIMARY KEY (id)
);

CREATE UNIQUE INDEX uq_hub_dashboards_campaign_name ON hub_dashboards (campaign_id, lower(name));
CREATE INDEX idx_hub_dashboards_campaign_id ON hub_dashboards (campaign_id);

CREATE SEQUENCE hub_dashboards_seq START WITH 1 INCREMENT BY 50;
