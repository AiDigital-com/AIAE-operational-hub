CREATE TABLE hub_roles
(
    id           BIGINT  NOT NULL,
    role_code    TEXT    NOT NULL,
    display_name TEXT    NOT NULL,
    description  TEXT,
    status       TEXT    NOT NULL,
    is_future    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL,
    updated_at   TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT pk_hub_roles PRIMARY KEY (id),
    CONSTRAINT uq_hub_roles_role_code UNIQUE (role_code)
);
