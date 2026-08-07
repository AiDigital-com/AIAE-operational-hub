CREATE TABLE hub_cache_update_event
(
    id            BIGINT NOT NULL,
    tracked_class TEXT   NOT NULL,
    updated_at    TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT pk_hub_cache_update_event PRIMARY KEY (id)
);

CREATE INDEX idx_hub_cache_update_event_updated_at ON hub_cache_update_event (updated_at);

CREATE SEQUENCE hub_cache_update_event_seq START WITH 1 INCREMENT BY 50;
