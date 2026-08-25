CREATE TABLE hub_agency_owner_overrides
(
    id                 BIGINT        NOT NULL,
    owner_user_id      BIGINT        NOT NULL,
    team_lead_user_id  BIGINT        NOT NULL,
    reason             VARCHAR(1000) NOT NULL,
    status             VARCHAR(32)   NOT NULL,
    created_at         TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL,
    updated_at         TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT pk_hub_agency_owner_overrides PRIMARY KEY (id),
    CONSTRAINT fk_hub_agency_owner_overrides_owner
        FOREIGN KEY (owner_user_id) REFERENCES hub_users (id),
    CONSTRAINT fk_hub_agency_owner_overrides_team_lead
        FOREIGN KEY (team_lead_user_id) REFERENCES hub_users (id),
    -- One statement per owner: two rows for the same owner would silently contradict each other.
    CONSTRAINT uq_hub_agency_owner_overrides_owner UNIQUE (owner_user_id),
    -- The reason is the row's payload, not decoration: nothing in NetSuite or Rippling says which team
    -- beneath a director owns their agencies, so the row exists only to record a human decision.
    -- NOT NULL alone would admit a blank string and make the requirement vacuous.
    CONSTRAINT ck_hub_agency_owner_overrides_reason CHECK (length(trim(reason)) > 0)
);

CREATE INDEX idx_hub_agency_owner_overrides_status ON hub_agency_owner_overrides (status);

CREATE SEQUENCE hub_agency_owner_overrides_seq START WITH 1 INCREMENT BY 50;
