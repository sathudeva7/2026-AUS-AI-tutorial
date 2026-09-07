-- 002_simplify_access
--
-- Reverses part of 001: roles become a fixed enum on `users` rather than
-- tenant-owned rows, and the permission catalogue moves into Python.
--
-- What survives is the part that earned its place: a user may be granted
-- individual permissions on top of their role, so a counsellor can edit the
-- catalogue without being promoted to manager and inheriting every lead in
-- the agency.
--
--   effective permissions = ROLE_PERMISSIONS[user.role] ∪ user_permissions
--
-- Cost of a new agency drops from 30 rows to 2. What is given up is agencies
-- defining roles of their own; that needs a migration again, which is the
-- right trade while there are three roles and no customer asking.
--
-- 001 has already been applied, so it is left untouched. This is the fix.

begin;

-- ---------------------------------------------------------------------------
-- users: role_id -> role
-- ---------------------------------------------------------------------------
-- text + CHECK rather than a Postgres enum type, matching how `status` is
-- already done in 001: changing a CHECK is an ordinary migration, where
-- ALTER TYPE ... ADD VALUE has its own rules and cannot be undone.
alter table users
    add column role text not null default 'counsellor';

alter table users
    add constraint users_role_valid
        check (role in ('counsellor', 'manager', 'owner'));

-- Dropping the column takes its foreign key to roles with it, which is what
-- has to happen before `roles` can go.
alter table users drop column role_id;

-- ---------------------------------------------------------------------------
-- user_permissions: same purpose, simpler guts
-- ---------------------------------------------------------------------------
-- 001 blocked owner-only grants with a composite foreign key against
-- permissions(key, is_owner_only). Clever, and unnecessary once the catalogue
-- is a code constant: the CHECK below simply does not list the owner-only
-- keys, so there is nothing to grant.
--
-- Recreated rather than altered — it carried three constraints and a column
-- that all have to go, and a fresh table is easier to read than the four
-- ALTERs that would get there.
drop table user_permissions;

create table user_permissions (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       text not null,
    user_id         uuid not null,

    -- Only the grantable keys are listed. users.invite,
    -- users.countries.manage and tenant.settings are owner-only and are
    -- absent on purpose: granting them piecemeal would make someone an owner
    -- by the back door. Keep this list in step with permissions.py.
    permission_key  text not null,

    -- Privilege escalation is exactly what you want a trail for when someone
    -- asks how a counsellor came to be editing the catalogue.
    granted_by      uuid,
    granted_at      timestamptz not null default now(),

    foreign key (tenant_id, user_id)
        references users(tenant_id, id) on delete cascade,
    -- The column list is required, not stylistic: a bare SET NULL on a
    -- composite key nulls every column in it, including tenant_id, which is
    -- NOT NULL. Naming granted_by nulls only that column.
    foreign key (tenant_id, granted_by)
        references users(tenant_id, id) on delete set null (granted_by),

    constraint user_permissions_key_grantable
        check (permission_key in (
            'leads.read.owned',
            'leads.read.all',
            'leads.write',
            'leads.assign',
            'catalogue.read',
            'catalogue.flag',
            'catalogue.write',
            'catalogue.verify',
            'users.edit'
        )),

    unique (user_id, permission_key)
);

create index user_permissions_user_idx on user_permissions (user_id);
create index user_permissions_granted_by_idx on user_permissions (granted_by);

-- ---------------------------------------------------------------------------
-- The tables the code constant replaces
-- ---------------------------------------------------------------------------
-- role_permissions first: it references both of the others.
drop table role_permissions;
drop table roles;
drop table permissions;

-- ---------------------------------------------------------------------------
-- Indexes on users
-- ---------------------------------------------------------------------------
-- users_tenant_role_idx in 001 was on role_id, and went with the column.
drop index if exists users_tenant_role_idx;
create index users_tenant_role_idx on users (tenant_id, role);

commit;

-- ---------------------------------------------------------------------------
-- Not here, on purpose
-- ---------------------------------------------------------------------------
-- The role -> permission map lives in student_agent/permissions.py. It is the
-- single place permissions resolve; two implementations would disagree
-- eventually. `roles.manage` is gone from the catalogue — there are no role
-- rows left to manage.
