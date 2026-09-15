-- 005_catalogue
--
-- What this consultancy has CHECKED: institutions, programmes, their intakes
-- and their entry requirements.
--
-- The decision this migration rests on: A PROGRAMME IS NOT VISIBLE TO STUDENTS
-- UNTIL A PERSON HAS VERIFIED IT. That is not a convention the API enforces —
-- it is `programmes_published_is_verified` below, so no code path, no import
-- script and no future extraction job can reach students without a human in
-- between. The agent may not state a fee from its own knowledge; this is where
-- that promise stops being a prompt instruction and becomes a constraint.
--
-- Until now the catalogue existed twice and neither copy was a table:
-- `mocks/seeds/programmes.json` (what the agent reads, no tenant_id at all)
-- and a TypeScript fixture with a session overlay (what the console edits).
-- Editing a programme could not change what a student was told. This is the
-- table both of those become.
--
-- Sources, AI extractions, proposals and flags — the URL-paste pipeline — are
-- 006. The `unique (tenant_id, id)` targets they need are already here.

begin;

-- ---------------------------------------------------------------------------
-- institutions
-- ---------------------------------------------------------------------------
-- Split out from `programmes` because the seed types "Camden Metropolitan
-- University" once per programme, and a renamed university or a corrected
-- website then has to be found in every row that spells it.
--
-- Tenant-owned, not global. Two agencies holding a row each for the same
-- university is the correct outcome: `verified_at` on the programmes beneath
-- it is an assertion by THAT agency, and a shared institution would imply a
-- shared verification that nobody made.
create table institutions (
    id          uuid        primary key default gen_random_uuid(),
    tenant_id   text        not null references tenants(id) on delete cascade,

    name        text        not null,

    -- The institution's home country. The PROGRAMME carries its own (see
    -- below); this one is for "where is this university" and may be null
    -- while a draft is being filled in.
    country     char(2),
    website     text,

    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),

    -- The target the composite foreign keys below need.
    unique (tenant_id, id),

    constraint institutions_name_not_blank
        check (btrim(name) <> ''),
    constraint institutions_country_iso
        check (country is null or country ~ '^[A-Z]{2}$')
);

-- Case-insensitive, so "camden metropolitan university" does not become a
-- second university. An expression index rather than a table constraint
-- because `unique (tenant_id, name)` cannot hold an expression.
create unique index institutions_tenant_name_idx
    on institutions (tenant_id, lower(name));

-- ---------------------------------------------------------------------------
-- programmes
-- ---------------------------------------------------------------------------
-- One offering. Every figure the agent is allowed to state about a fee, a
-- deadline or an entry requirement comes from here or from its children.
create table programmes (
    id                      uuid        primary key default gen_random_uuid(),
    tenant_id               text        not null references tenants(id) on delete cascade,

    -- Nullable for the same reason almost everything here is: a draft exists
    -- before it is complete. `programmes_published_is_complete` is what makes
    -- it mandatory at the moment it starts mattering.
    institution_id          uuid,

    name                    text        not null,

    -- Deliberately NOT a closed set, unlike `status` and `fact_key`. An
    -- agency's "integrated masters", "top-up" or "pathway" year is a real
    -- programme, and refusing to store one because this list was written
    -- without it is worse than a slug in a column. The console already
    -- expects that: `levelLabel` passes an unrecognised value through rather
    -- than blanking it. Lowercase is enforced because `search_programmes`
    -- matches `level` exactly, and "Masters" that never matches "masters" is
    -- a programme that silently cannot be found.
    level                   text,
    field                   text,

    -- The OFFERING's country, not the institution's. A branch campus in Dubai
    -- is not in its parent's country, and this is the column routing reads:
    -- leads are assigned by `user_countries`, and the coverage banner asks
    -- which catalogue destinations have no owner. Both work in ISO alpha-2,
    -- and the seed catalogue's "UK" is not a code in it — GB is. The alias map
    -- in the frontend exists only because this column did not, and Britain was
    -- reported permanently unowned however many people owned GB.
    --
    -- The CHECK below is SHAPE ONLY, and deliberately so: "UK" and "XX" are
    -- both two uppercase letters and neither is a country. The register lives
    -- in `services/geo.normalise_country`, which every write path must go
    -- through — the same division of labour this table uses for `rule` below,
    -- and the one 001 already made for `tenants.country`. A copy of ISO 3166
    -- in a CHECK would be a third register to hold in step, updatable only by
    -- a migration whenever the world changes.
    country                 char(2),
    city                    text,

    -- Minor units, never a float (CLAUDE.md). This is a figure quoted to a
    -- student who will budget on it.
    tuition_per_year_minor  bigint,
    -- The programme's own currency. No tenant-level default overrides it: an
    -- agency in Colombo sending students to Melbourne quotes AUD.
    currency                char(3),
    duration_months         int,

    -- draft     — being written. Invisible to the agent.
    -- published — verified, and the only status `search_programmes` may read.
    -- archived  — withdrawn. Kept, because past `tool_calls` name this id and
    --             the dashboard rebuilds shortlists from them; deleting the
    --             row turns a completed shortlist into a dangling reference.
    status                  text        not null default 'draft',

    -- null = NEVER CHECKED, which is a different claim from "checked long
    -- ago". The console fixture wrote 1970-01-01 to force a copy into the
    -- needs-check list; a date nobody verified on is a lie the freshness
    -- query would repeat.
    verified_at             timestamptz,
    verified_by             uuid,

    created_by              uuid,
    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now(),

    foreign key (tenant_id, institution_id)
        references institutions(tenant_id, id) on delete restrict,

    -- RESTRICT on both, for the reason lead_documents and meetings already
    -- established: provenance outlives the person. SET NULL would rewrite
    -- "Priya verified this fee" into "nobody verified this fee" the moment
    -- Priya's row went away — and `programmes_verified_pair` would then be
    -- violated by a row that was legal when written. Users are deactivated,
    -- not deleted, so in normal operation neither fires.
    foreign key (tenant_id, verified_by)
        references users(tenant_id, id) on delete restrict,
    foreign key (tenant_id, created_by)
        references users(tenant_id, id) on delete restrict,

    -- The target 006's proposals and flags will point at.
    unique (tenant_id, id),

    constraint programmes_name_not_blank
        check (btrim(name) <> ''),
    constraint programmes_status_valid
        check (status in ('draft', 'published', 'archived')),
    constraint programmes_level_lowercase
        check (level is null or level = lower(level)),
    constraint programmes_country_iso
        check (country is null or country ~ '^[A-Z]{2}$'),
    constraint programmes_currency_iso
        check (currency is null or currency ~ '^[A-Z]{3}$'),

    -- A price is an amount AND a currency. "24500" with no currency is not a
    -- cheaper programme, it is an unanswerable question.
    constraint programmes_price_pair
        check ((tuition_per_year_minor is null) = (currency is null)),
    constraint programmes_tuition_not_negative
        check (tuition_per_year_minor is null or tuition_per_year_minor >= 0),
    constraint programmes_duration_positive
        check (duration_months is null or duration_months > 0),

    -- Same pairing meetings uses for its cancelled_* trio, and for the same
    -- reason: the stamp and the person who made it cannot disagree about
    -- whether verification happened.
    constraint programmes_verified_pair
        check ((verified_at is null) = (verified_by is null)),

    -- -----------------------------------------------------------------------
    -- The two constraints this table exists for.
    -- -----------------------------------------------------------------------
    -- 1. Published means a PERSON checked it.
    --
    -- `verified_by` is a users row, so only something acting as a real member
    -- of this agency can set it. An import script, an overnight refresh job
    -- or 006's extraction pipeline cannot publish by writing a status — the
    -- database refuses the row. This is the product's central promise ("the
    -- agent may not state a fee from its own knowledge") stated where no code
    -- path can route around it.
    constraint programmes_published_is_verified
        check (status <> 'published' or verified_at is not null),

    -- 2. Published means ANSWERABLE.
    --
    -- A student asking "how much and how long?" about a live programme must
    -- get an answer, not a dash. These stay nullable while a draft is being
    -- written — which is exactly what a half-filled extraction produces — and
    -- become mandatory at the moment the row becomes visible. The editor's
    -- action bar already computes this list to decide whether Save may
    -- publish; this is the same rule, in the one place that cannot be
    -- bypassed by a second client.
    constraint programmes_published_is_complete
        check (status <> 'published' or (
            institution_id         is not null
            and level              is not null
            and field              is not null
            and country            is not null
            and tuition_per_year_minor is not null
            and duration_months    is not null
        ))
);

-- ---------------------------------------------------------------------------
-- programme_intakes
-- ---------------------------------------------------------------------------
-- A month you can start in, and THE DEADLINE FOR THAT MONTH.
--
-- The model this replaces had one `application_deadline` on the programme for
-- every intake it offered. January and September close months apart, so a
-- single column means the agent quotes the wrong date to whichever half of
-- the students it was not written for. The freshness queue already knew this
-- — its fixture raises "Application deadline · 2027-09 intake" — against a
-- shape that could not store one.
create table programme_intakes (
    id                   uuid        primary key default gen_random_uuid(),
    tenant_id            text        not null,
    programme_id         uuid        not null,

    -- 'YYYY-MM'. A month, not a date: universities open "September 2027", and
    -- inventing the 1st would put a day on screen that nobody published.
    intake               char(7)     not null,

    application_deadline date,

    -- A closed intake is kept, not deleted. It is how "you have missed this
    -- one, the next is January" gets answered, and history nobody can see is
    -- history that gets re-researched.
    is_open              boolean     not null default true,

    created_at           timestamptz not null default now(),

    foreign key (tenant_id, programme_id)
        references programmes(tenant_id, id) on delete cascade,

    unique (tenant_id, programme_id, intake),

    constraint programme_intakes_month_format
        check (intake ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')

    -- Deliberately NO constraint that the deadline falls before the intake.
    -- Rolling admission, clearing and late offers are all normal, and a
    -- database error is the wrong way to find out this university does them.
);

-- ---------------------------------------------------------------------------
-- programme_requirements
-- ---------------------------------------------------------------------------
-- What a student must satisfy, in two registers: `rule` is what
-- `check_requirements` evaluates, `description` is what the student is told.
-- Both are required. A rule with no description produces a verdict the agent
-- cannot explain; a description with no rule produces a requirement nothing
-- checks.
create table programme_requirements (
    id            uuid        primary key default gen_random_uuid(),
    tenant_id     text        not null,
    programme_id  uuid        not null,

    -- Names the lead_facts key this tests, so requirement and fact are paired
    -- mechanically instead of the model guessing which of a student's details
    -- is relevant.
    fact_key      text        not null,

    -- Machine-ish text, e.g. 'bachelor_years>=4'. NOT constrained here, on
    -- purpose, and for the reason lead_facts gives for leaving `value`
    -- unvalidated: the grammar lives in the evaluator, and a regex here would
    -- be the same rule stated twice, in a language that cannot run it. The
    -- write path validates against the evaluator itself — a rule nothing
    -- evaluates is an entry requirement that silently never fires, which is
    -- worse than no requirement because the row looks complete.
    rule          text        not null,
    description   text        not null,

    -- A failed optional requirement dents confidence; a failed mandatory one
    -- ends the match. Copied through to RequirementCheck so scoring needs no
    -- second join.
    mandatory     boolean     not null default true,

    sort_order    smallint    not null default 0,

    created_at    timestamptz not null default now(),

    foreign key (tenant_id, programme_id)
        references programmes(tenant_id, id) on delete cascade,

    unique (tenant_id, id),

    -- The same seven keys as lead_facts_key_valid. A requirement keyed to
    -- something that is not a fact can never be evaluated, and the two lists
    -- drifting would mean a requirement that is legal to write and impossible
    -- to check. db/tests asserts they match.
    constraint programme_requirements_key_valid
        check (fact_key in ('target_country', 'field_of_study', 'qualification',
                            'grades', 'english_test', 'budget_per_year',
                            'intended_intake')),
    constraint programme_requirements_rule_not_blank
        check (btrim(rule) <> ''),
    constraint programme_requirements_description_not_blank
        check (btrim(description) <> '')
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
-- THE agent query: everything a student may be shown, narrowed by destination
-- and subject. Partial on 'published' because that filter is not optional —
-- it is the one that keeps drafts away from students — so the index should
-- not carry the rows it must never return.
create index programmes_searchable_idx
    on programmes (tenant_id, country, field) where status = 'published';

-- The console table, which lists drafts and archived rows too.
create index programmes_tenant_status_idx on programmes (tenant_id, status);

-- The freshness question: what has nobody checked lately? Only live rows can
-- be stale — a draft was never verified and an archived one is not quoted.
create index programmes_staleness_idx
    on programmes (tenant_id, verified_at) where status = 'published';

-- Institution pages, and the RESTRICT check when one is deleted.
create index programmes_tenant_institution_idx on programmes (tenant_id, institution_id);

-- Both RESTRICT edges to users. Without these, deactivating a person makes
-- Postgres scan every programme in the database to prove the delete is safe.
create index programmes_verified_by_idx on programmes (tenant_id, verified_by);
create index programmes_created_by_idx  on programmes (tenant_id, created_by);

-- Loading one programme's children. The intakes unique constraint already
-- indexes (tenant_id, programme_id, intake); requirements has no such cover.
create index programme_requirements_tenant_programme_idx
    on programme_requirements (tenant_id, programme_id);

-- "What closes in the next fortnight?" — the question behind an intake_cutoff
-- follow-up. Only open intakes can close.
create index programme_intakes_deadline_idx
    on programme_intakes (tenant_id, application_deadline) where is_open;

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
-- set_updated_at() is defined in 001. The child tables have no updated_at:
-- an intake or a requirement is replaced as a set, never edited in place.
create trigger institutions_set_updated_at before update on institutions
    for each row execute function set_updated_at();
create trigger programmes_set_updated_at before update on programmes
    for each row execute function set_updated_at();

commit;

-- ---------------------------------------------------------------------------
-- Not here, on purpose
-- ---------------------------------------------------------------------------
-- NO revision history table. "What fee were we quoting in August?" is already
-- answerable: `tool_calls` records the result `search_programmes` returned,
-- with its timestamp. A second history would be a second source of truth for
-- one question, and the two would disagree the first time a backfill ran.
--
-- NO per-tenant staleness setting. "Stale after 30 days" lives in one constant
-- in `web/src/lib/format.ts`. A column would make it configurable before
-- anybody has asked for a different number, and every read would have to join
-- to find out what today's answer is.
--
-- NO `flagged` boolean on programmes. 006's `catalogue_flags` is a table
-- because a flag has an author, a reason and an outcome; a boolean would
-- record that somebody objected and not what to.
--
-- NO source_url column, even though the console edits one today and the model
-- in `web/src/data/types.ts` carries it. One URL cannot hold this: tuition is
-- on the fees page, entry requirements on the course page, intakes on an
-- admissions page. `programme_sources` in 006 is a table for that reason, and
-- adding a column here now would mean migrating it away in the next file.
--
-- ERASURE ORDER CHANGES. 003 and 004 note that deleting an agency is an
-- ordered purge rather than a cascade, because RESTRICT deliberately guards
-- provenance. `programmes` adds two RESTRICT edges to `users` and one to
-- `institutions`, so the sequence is now:
--     lead_facts, lead_documents, meetings, leads,
--     programmes (intakes and requirements cascade), institutions,
--     users, tenant.
-- Missing a step means `delete from tenants` fails, which is the intended
-- loud failure — but only if somebody knows to look here.
