-- Seeds the local admin user so a fresh database can be logged into.
--
-- Signing in never creates a Hub user: it only links a Clerk identity to a row the NetSuite/Rippling
-- sync already wrote (UserProvisioningService), and that sync is started by the daily scheduler or by
-- POST /api/v1/sync, which needs manage-roles. On an empty database nobody can do either, so this
-- seeds one ADMIN (scope ALL). The sync never downgrades an existing ADMIN.
--
-- Idempotent. Run by scripts/local-db.sh with psql variables:
--   admin_email      required
--   admin_name       optional
--   admin_clerk_id   optional; when empty the first login links the row by email

\set ON_ERROR_STOP on

begin;

insert into hub_users (id, clerk_user_id, email, display_name, status, created_at, updated_at)
values (nextval('hub_users_seq'), nullif(:'admin_clerk_id', ''), lower(:'admin_email'),
        nullif(:'admin_name', ''), 'ACTIVE', now(), now())
on conflict ((lower(email))) do update
    set clerk_user_id = coalesce(excluded.clerk_user_id, hub_users.clerk_user_id),
        display_name  = coalesce(hub_users.display_name, excluded.display_name),
        status        = 'ACTIVE',
        updated_at    = now();

insert into hub_role_assignments (id, user_id, role_id, scope_type_id, scope_id, status, created_at, updated_at)
select nextval('hub_role_asgnm_seq'), u.id, r.id, s.id, null, 'ACTIVE', now(), now()
from hub_users u
         join hub_roles r on r.role_code = 'ADMIN'
         join hub_scope_types s on s.scope_code = 'ALL'
where lower(u.email) = lower(:'admin_email')
  and not exists (select 1
                  from hub_role_assignments a
                  where a.user_id = u.id
                    and a.role_id = r.id
                    and a.scope_type_id = s.id
                    and a.scope_id is null);

update hub_role_assignments a
set status = 'ACTIVE', updated_at = now()
from hub_users u, hub_roles r, hub_scope_types s
where a.user_id = u.id and a.role_id = r.id and a.scope_type_id = s.id and a.scope_id is null
  and lower(u.email) = lower(:'admin_email') and r.role_code = 'ADMIN' and s.scope_code = 'ALL'
  and a.status <> 'ACTIVE';

commit;

select u.id, u.email, u.clerk_user_id, u.status, r.role_code, s.scope_code, a.status as assignment_status
from hub_users u
         join hub_role_assignments a on a.user_id = u.id
         join hub_roles r on r.id = a.role_id
         join hub_scope_types s on s.id = a.scope_type_id
where lower(u.email) = lower(:'admin_email');
