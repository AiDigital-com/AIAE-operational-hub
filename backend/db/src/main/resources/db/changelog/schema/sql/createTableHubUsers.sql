CREATE TABLE hub_users
(
    id            BIGINT NOT NULL,
    clerk_user_id TEXT   NOT NULL,
    email         TEXT   NOT NULL,
    display_name  TEXT,
    status        TEXT   NOT NULL,
    created_at    TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL,
    updated_at    TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT pk_hub_users PRIMARY KEY (id),
    CONSTRAINT uq_hub_users_clerk_user_id UNIQUE (clerk_user_id),
    CONSTRAINT uq_hub_users_email UNIQUE (email)
);

CREATE SEQUENCE hub_users_seq START WITH 1 INCREMENT BY 50;

CREATE INDEX idx_hub_users_status ON hub_users (status);
