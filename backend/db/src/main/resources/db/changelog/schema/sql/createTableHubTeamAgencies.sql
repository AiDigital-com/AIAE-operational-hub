CREATE TABLE hub_team_agencies
(
    id         BIGINT NOT NULL,
    team_id    BIGINT NOT NULL,
    agency_id  BIGINT NOT NULL,
    created_at TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL,
    updated_at TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT pk_hub_team_agencies PRIMARY KEY (id),
    CONSTRAINT fk_hub_team_agencies_team
        FOREIGN KEY (team_id) REFERENCES hub_teams (id),
    CONSTRAINT uq_hub_team_agencies_agency UNIQUE (agency_id)
);

CREATE INDEX idx_hub_team_agencies_team_id ON hub_team_agencies (team_id);

CREATE SEQUENCE hub_team_agencies_seq START WITH 1 INCREMENT BY 50;
