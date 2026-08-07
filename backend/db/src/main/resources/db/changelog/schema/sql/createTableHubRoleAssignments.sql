CREATE TABLE hub_role_assignments
(
    id                 BIGINT NOT NULL,
    user_id            BIGINT NOT NULL,
    role_id            BIGINT NOT NULL,
    scope_type_id      BIGINT NOT NULL,
    scope_id           BIGINT,
    status             TEXT   NOT NULL,
    created_by_user_id BIGINT,
    created_at         TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL,
    updated_at         TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT pk_hub_role_assignments PRIMARY KEY (id),
    CONSTRAINT fk_hub_role_assignments_user
        FOREIGN KEY (user_id) REFERENCES hub_users (id),
    CONSTRAINT fk_hub_role_assignments_role
        FOREIGN KEY (role_id) REFERENCES hub_roles (id),
    CONSTRAINT fk_hub_role_assignments_scope_type
        FOREIGN KEY (scope_type_id) REFERENCES hub_scope_types (id),
    CONSTRAINT fk_hub_role_assignments_created_by_user
        FOREIGN KEY (created_by_user_id) REFERENCES hub_users (id)
);

CREATE SEQUENCE hub_role_asgnm_seq START WITH 1 INCREMENT BY 50;

CREATE INDEX idx_hub_role_assignments_user_id ON hub_role_assignments (user_id);
CREATE INDEX idx_hub_role_assignments_role_id ON hub_role_assignments (role_id);
CREATE INDEX idx_hub_role_assignments_scope ON hub_role_assignments (scope_type_id, scope_id);

CREATE UNIQUE INDEX uq_hub_role_assignment_scoped
    ON hub_role_assignments (user_id, role_id, scope_type_id, scope_id) WHERE scope_id IS NOT NULL;
CREATE UNIQUE INDEX uq_hub_role_assignment_unscoped
    ON hub_role_assignments (user_id, role_id, scope_type_id) WHERE scope_id IS NULL;
