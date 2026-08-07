CREATE TABLE hub_scope_types
(
    id           BIGINT NOT NULL,
    scope_code   TEXT   NOT NULL,
    display_name TEXT   NOT NULL,
    description  TEXT,
    status       TEXT   NOT NULL,
    created_at   TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL,
    updated_at   TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT pk_hub_scope_types PRIMARY KEY (id),
    CONSTRAINT uq_hub_scope_types_scope_code UNIQUE (scope_code)
);
