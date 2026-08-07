CREATE TABLE hub_teams
(
    id         BIGINT NOT NULL,
    team_name  TEXT   NOT NULL,
    pod_key    TEXT,
    status     TEXT   NOT NULL,
    created_at TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL,
    updated_at TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT pk_hub_teams PRIMARY KEY (id),
    CONSTRAINT uq_hub_teams_team_name UNIQUE (team_name)
);

CREATE INDEX idx_hub_teams_pod_key ON hub_teams (pod_key);
CREATE INDEX idx_hub_teams_status ON hub_teams (status);

CREATE SEQUENCE hub_teams_seq START WITH 1 INCREMENT BY 50;