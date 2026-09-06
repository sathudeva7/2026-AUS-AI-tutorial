-- 001_people_and_access
--
-- Who works at an agency, what they may do, and when they are reachable.
-- Lead, catalogue and audit tables come in a later migration.
--
-- Shared database, shared schema: every tenant lives in these tables and is
-- separated by `tenant_id`, which IS the Clerk organization id. Identity comes
-- from Clerk; authorization comes from here.
--
-- Safe to run against a fresh Supabase project's SQL editor.

begin;

create extension if not exists citext;

-- ---------------------------------------------------------------------------
-- tenants
-- ---------------------------------------------------------------------------
-- `id` is the Clerk org_id, so there is no mapping table and no second
-- identifier to keep in step. `name` is a CACHE of Clerk's organization name:
-- the student widget is public and renders with no Clerk session, so the
-- backend must be able to serve it without an API call. Clerk stays
-- authoritative — sync from the organization.updated webhook, and never let
-- the admin UI write this column directly.
create table tenants (
    id                text primary key,
    name              text        not null,

    phone             text,
    address_line1     text,
    address_line2     text,
    city              text,
    region            text,
    postal_code       text,
    country           char(2),

    -- Seeds a new user's `timezone` and nothing more. Times render in the
    -- VIEWER's zone (CLAUDE.md) — an agency with branches in two countries
    -- has no single correct clock, so this is not a rendering authority.
    default_timezone  text        not null default 'UTC',

    -- Operational suspend. A suspended agency's agent stops answering.
    active            boolean     not null default true,

    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),

    -- E.164. Without a stored format you get '077 123 4567' and
    -- '+94771234567' in the same column and can neither compare nor dial them.
    constraint tenants_phone_e164
        check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$')
);

-- ---------------------------------------------------------------------------
-- permissions — the closed catalogue
-- ---------------------------------------------------------------------------
-- Global, not per tenant, and seeded by migration only. Owners compose roles
-- by picking from this list; they cannot invent a key, because a key that no
-- code path checks is a setting that silently does nothing.
create table permissions (
    key            text primary key,
    description    text    not null,
    -- Keys to the kingdom. Granting these piecemeal would make someone an
    -- owner by the back door, so they are never individually grantable.
    is_owner_only  boolean not null default false,

    -- Not redundant with the primary key: it is the target the
    -- user_permissions composite foreign key needs. See that table.
    unique (key, is_owner_only)
);

-- ---------------------------------------------------------------------------
-- roles
-- ---------------------------------------------------------------------------
-- Per tenant, so an agency can retune what "counsellor" means for them and
-- add roles of their own. counsellor / manager / owner are seeded at signup
-- with is_system = true.
create table roles (
    id           uuid        primary key default gen_random_uuid(),
    tenant_id    text        not null references tenants(id) on delete cascade,
    name         text        not null,
    description  text,
    is_system    boolean     not null default false,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),

    unique (tenant_id, name),
    -- The target for composite foreign keys from children. Redundant for
    -- uniqueness (id is already the PK), required for the FK.
    unique (tenant_id, id)
);

create table role_permissions (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       text not null,
    role_id         uuid not null,
    permission_key  text not null references permissions(key) on delete restrict,

    -- (tenant_id, role_id) rather than role_id alone: a role_permissions row
    -- cannot be attached to another agency's role.
    foreign key (tenant_id, role_id)
        references roles(tenant_id, id) on delete cascade,

    unique (role_id, permission_key)
);

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
-- One row per (agency, person). The same human working at two agencies gets
-- two rows, which is why both unique constraints are tenant-scoped: their
-- email legitimately repeats across tenants.
--
-- `clerk_user_id` is nullable on purpose. An owner invites a counsellor and
-- assigns their countries BEFORE that person accepts, so the row must exist
-- while there is no Clerk user yet. It is filled by the
-- organizationMembership.created webhook, which also flips status to 'active'.
create table users (
    id             uuid        primary key default gen_random_uuid(),
    tenant_id      text        not null references tenants(id) on delete cascade,

    -- Verified identity. Never match a person on email: emails change, and
    -- they are guessable.
    clerk_user_id  text,

    email          citext      not null,
    name           text,
    -- Product contact, not HR: a counsellor gets called about an escalation.
    work_phone     text,

    role_id        uuid        not null,
    timezone       text        not null default 'UTC',

    -- A boolean cannot tell "has not accepted yet" from "switched off", and
    -- the roster renders those differently. Routing skips anything not active.
    status         text        not null default 'invited',

    invited_at     timestamptz,
    accepted_at    timestamptz,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),

    -- RESTRICT is what makes "a role in use cannot be deleted" a database
    -- guarantee rather than a rule someone has to remember.
    foreign key (tenant_id, role_id)
        references roles(tenant_id, id) on delete restrict,

    unique (tenant_id, email),
    -- Postgres allows many NULLs under a unique constraint, so every pending
    -- invite coexists here.
    unique (tenant_id, clerk_user_id),
    unique (tenant_id, id),

    constraint users_status_valid
        check (status in ('invited', 'active', 'deactivated')),
    constraint users_work_phone_e164
        check (work_phone is null or work_phone ~ '^\+[1-9][0-9]{6,14}$'),
    -- An active user with no Clerk link could never sign in; that row is a bug.
    constraint users_active_is_linked
        check (status <> 'active' or clerk_user_id is not null)
);

-- ---------------------------------------------------------------------------
-- user_permissions — per-user top-ups
-- ---------------------------------------------------------------------------
--   effective permissions = the role's permissions ∪ the user's own grants
--
-- Grants only ever ADD. There is deliberately no revoke: a plain union keeps
-- "why can Priya do this?" answerable in one query, where a three-way
-- resolution would not. Someone who needs less gets a lower role.
create table user_permissions (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       text not null,
    user_id         uuid not null,
    permission_key  text not null,

    -- Privilege escalation is exactly what you want a trail for when someone
    -- asks how a counsellor came to be editing the catalogue.
    granted_by      uuid,
    granted_at      timestamptz not null default now(),

    -- Pinned false, and paired with permission_key against
    -- permissions(key, is_owner_only). An owner-only permission has no row
    -- matching (key, false), so the foreign key has nothing to point at and
    -- the insert fails. A plain CHECK cannot do this — it cannot read another
    -- table — and this needs no trigger.
    is_owner_only   boolean not null default false,

    foreign key (tenant_id, user_id)
        references users(tenant_id, id) on delete cascade,
    -- The audit row outlives the granter leaving. The column list on SET NULL
    -- is required, not stylistic: a bare SET NULL on a composite key nulls
    -- EVERY column in it, including tenant_id, which is NOT NULL — so deleting
    -- a granter would fail outright. Naming granted_by nulls only that column.
    -- (Postgres 15+; Supabase is well past that.)
    foreign key (tenant_id, granted_by)
        references users(tenant_id, id) on delete set null (granted_by),
    foreign key (permission_key, is_owner_only)
        references permissions(key, is_owner_only) on delete restrict,

    constraint user_permissions_not_owner_only
        check (is_owner_only = false),
    unique (user_id, permission_key)
);

-- ---------------------------------------------------------------------------
-- user_countries — routing ownership AND lead visibility
-- ---------------------------------------------------------------------------
-- A table rather than an array on users: an array carries neither a foreign
-- key nor a constraint, and `assigned_at` answers "who owned UK in March?".
--
-- Several users may own one country, so assignment needs an explicit
-- tie-break rule in application code — never a silent round-robin.
create table user_countries (
    id           uuid        primary key default gen_random_uuid(),
    tenant_id    text        not null,
    user_id      uuid        not null,
    country      char(2)     not null,
    assigned_at  timestamptz not null default now(),

    foreign key (tenant_id, user_id)
        references users(tenant_id, id) on delete cascade,

    unique (user_id, country)
);

-- ---------------------------------------------------------------------------
-- availability_rules
-- ---------------------------------------------------------------------------
-- The recurring weekly pattern. Times are WALL CLOCK, read against
-- users.timezone — "9 to 5" with no zone is a missed call when the counsellor
-- is in Colombo and the student is in London. Booked appointments are a
-- different table and store absolute timestamptz.
create table availability_rules (
    id           uuid        primary key default gen_random_uuid(),
    tenant_id    text        not null,
    user_id      uuid        not null,
    day_of_week  smallint    not null,
    start_time   time        not null,
    end_time     time        not null,
    created_at   timestamptz not null default now(),

    foreign key (tenant_id, user_id)
        references users(tenant_id, id) on delete cascade,

    constraint availability_day_of_week_range
        check (day_of_week between 0 and 6),
    constraint availability_end_after_start
        check (end_time > start_time)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
-- Every lookup starts from a tenant, so tenant_id leads each composite.
create index users_tenant_status_idx        on users (tenant_id, status);
create index users_tenant_role_idx          on users (tenant_id, role_id);
create index users_clerk_user_id_idx        on users (clerk_user_id);
create index roles_tenant_idx               on roles (tenant_id);
create index role_permissions_role_idx      on role_permissions (role_id);
create index user_permissions_user_idx      on user_permissions (user_id);
create index user_permissions_granted_by_idx on user_permissions (granted_by);
-- Routing: "who owns this student's country?"
create index user_countries_tenant_country_idx on user_countries (tenant_id, country);
create index availability_user_day_idx      on availability_rules (user_id, day_of_week);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
-- In the database so the column cannot drift when a row is touched outside
-- the application.
create or replace function set_updated_at() returns trigger as $fn$
begin
    new.updated_at = now();
    return new;
end;
$fn$ language plpgsql;

create trigger tenants_set_updated_at before update on tenants
    for each row execute function set_updated_at();
create trigger roles_set_updated_at before update on roles
    for each row execute function set_updated_at();
create trigger users_set_updated_at before update on users
    for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Seed: the permission catalogue
-- ---------------------------------------------------------------------------
-- Scope is expressed as a permission rather than hardcoded per role, so the
-- per-user override mechanism covers visibility as well as capability: a
-- counsellor who needs full sight gets granted leads.read.all, through the
-- same machinery that gives them catalogue.write.
insert into permissions (key, description, is_owner_only) values
    ('leads.read.owned',        'See leads in owned countries, plus the whole unassigned queue', false),
    ('leads.read.all',          'See every lead in the agency, regardless of country',           false),
    ('leads.write',             'Work a lead: notes, facts, status',                             false),
    ('leads.assign',            'Reassign a lead to another user',                               false),
    ('catalogue.read',          'Read programmes and entry requirements',                        false),
    ('catalogue.flag',          'Raise a correction against a catalogue entry',                  false),
    ('catalogue.write',         'Create and edit programmes',                                    false),
    ('catalogue.verify',        'Clear the verification queue so an entry reaches students',     false),
    ('users.edit',              'Edit a roster member',                                          false),
    ('users.invite',            'Invite a counsellor to the agency',                             true),
    ('users.countries.manage',  'Set who owns which country',                                    true),
    ('roles.manage',            'Create and edit roles',                                         true),
    ('tenant.settings',         'Agency details and tenant-wide configuration',                  true);

commit;

-- ---------------------------------------------------------------------------
-- Not here, on purpose
-- ---------------------------------------------------------------------------
-- The three default roles are seeded PER TENANT at signup, in application
-- code, because no tenant exists at migration time. That hook belongs in the
-- create-agency flow, alongside seeding the creator as owner.
--
-- No RLS policies: tenant scoping is enforced in the application layer first.
-- RLS driven by `SET LOCAL app.tenant_id` is a later defence-in-depth pass,
-- and it buys nothing until the backend stops connecting as an admin role.
