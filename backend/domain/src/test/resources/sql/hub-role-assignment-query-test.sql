insert into hub_roles (id, role_code, display_name, description, status, is_future, created_at, updated_at)
values (10, 'ADMIN', 'Administrator', 'Administrator role', 'ACTIVE', false, now(), now()),
       (11, 'MANAGER', 'Manager', 'Manager role', 'ACTIVE', false, now(), now());

insert into hub_scope_types (id, scope_code, display_name, description, status, created_at, updated_at)
values (20, 'GLOBAL', 'Global', 'Global scope', 'ACTIVE', now(), now()),
       (21, 'DEPARTMENT', 'Department', 'Department scope', 'ACTIVE', now(), now());

insert into hub_role_assignments (id,
                                  user_id,
                                  role_id,
                                  scope_type_id,
                                  scope_id,
                                  status,
                                  created_by_user_id,
                                  created_at,
                                  updated_at)
values (1000, 100, 10, 20, null, 'ACTIVE', 900, now(), now()),
       (1001, 100, 11, 21, 777, 'ACTIVE', 900, now(), now()),
       (1002, 100, 11, 21, 888, 'ACTIVE', 900, now(), now()),
       (1003, 101, 11, 21, 777, 'ACTIVE', 900, now(), now()),
       (1004, 102, 10, 20, null, 'REVOKED', 900, now(), now());
