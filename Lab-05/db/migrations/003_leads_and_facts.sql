-- 003_leads_and_facts
--
-- The student, what we have been told about them, and the documents behind it.
-- Conversation, notes, escalations, follow-ups and slots come in 004;
-- programmes and requirements are their own slice.
--
-- The idea the whole migration rests on: `lead_facts` is a LOG OF CLAIMS, not
-- a row of answers. Several rows for the same key is the normal case. "What is
-- this student's GPA?" is answered by a rule over the log, never by reading a
-- column — which is what lets every value on screen be traced back to the
-- words it came from.
--
-- See db/SCHEMA.md part 2 for the reasoning behind each decision here.

begin;

-- ---------------------------------------------------------------------------
-- leads
-- ---------------------------------------------------------------------------
-- The person and their current state. Anything that accumulates lives in its
-- own table: if a column would ever need a second value, it is not a column.
create table leads (
    id                    uuid        primary key default gen_random_uuid(),
    tenant_id             text        not null references tenants(id) on delete cascade,

    email                 citext      not null,
    name                  text,
    -- Escalation means a counsellor rings them. Without this the product's
    -- central flow needs a number nobody collected.
    phone                 text,

    country_of_residence  char(2),

    -- CACHE of the resolved `target_country` claims, maintained when those
    -- claims change. An array because a student may want several countries,
    -- and it is the routing key — keeping it here keeps that query a single
    -- indexed table scan instead of a join into the claim log.
    target_countries      char(2)[]   not null default '{}',

    -- Lifecycle only. 'escalated' is deliberately NOT here: an escalated lead
    -- is still active, so the two are orthogonal. "Needs a human" is derived
    -- from an unresolved row in escalations (004), which keeps one source of
    -- truth instead of a column two code paths must hold in step.
    status                text        not null default 'active',
    source                text        not null default 'widget',

    assigned_user_id      uuid,
    assigned_at           timestamptz,
    -- Routing must be recorded, never improvised (CLAUDE.md). A column is how
    -- "recorded" becomes true.
    assignment_reason     text,

    -- Drives stale-lead views and retention.
    last_activity_at      timestamptz not null default now(),
    -- Soft delete. Erasure purges for real; this marks the intent first.
    deleted_at            timestamptz,

    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now(),

    -- The column list on SET NULL is required, not stylistic: a bare SET NULL
    -- on a composite key nulls EVERY column in it, including tenant_id, which
    -- is NOT NULL. Naming assigned_user_id nulls only that column, so a
    -- deactivated counsellor's leads fall back to the unassigned queue.
    foreign key (tenant_id, assigned_user_id)
        references users(tenant_id, id) on delete set null (assigned_user_id),

    -- Scoped to the tenant: the same student may approach two agencies, and
    -- de-duplication is per agency. Several target countries is one student
    -- with options, not several leads.
    unique (tenant_id, email),
    -- The target every child's composite foreign key needs.
    unique (tenant_id, id),

    constraint leads_status_valid
        check (status in ('active', 'parked', 'withdrawn', 'converted')),
    constraint leads_source_valid
        check (source in ('widget', 'manual', 'import')),
    constraint leads_phone_e164
        check (phone is null or phone ~ '^\+[1-9][0-9]{6,14}$'),
    constraint leads_residence_upper
        check (country_of_residence is null
               or country_of_residence = upper(country_of_residence)),
    -- Cast the whole array to text and compare: a CHECK cannot contain a
    -- subquery, so unnest() is unavailable. '{GB,AU}' = upper('{GB,AU}').
    constraint leads_targets_upper
        check (target_countries::text = upper(target_countries::text)),
    constraint leads_assignment_reason_valid
        check (assignment_reason is null
               or assignment_reason in ('country_owner', 'fewest_active_leads', 'manual'))

    -- No CHECK pairing assigned_user_id with assigned_at. The SET NULL above
    -- can null the user without touching the timestamp, so such a constraint
    -- would make deleting a user fail. The pair is maintained in application
    -- code; a stale assigned_at on an unassigned lead reads as history.
);

-- ---------------------------------------------------------------------------
-- lead_documents
-- ---------------------------------------------------------------------------
-- Uploaded evidence. `extraction` holds the model's RAW output verbatim, which
-- is the one place jsonb genuinely belongs here: its shape is unpredictable.
-- Only recognised keys are promoted to lead_facts rows; everything else stays
-- visible in this column rather than being silently dropped, so a key added
-- later can be re-promoted without re-reading the file.
--
-- Trust tier derives from `kind`, in code, not from a column: a transcript is
-- issued by a university, a CV is written by the student, and treating them
-- alike is exactly the mistake this design exists to prevent.
create table lead_documents (
    id                uuid        primary key default gen_random_uuid(),
    tenant_id         text        not null,
    lead_id           uuid        not null,

    kind              text        not null,
    -- Path in object storage, always tenant-scoped and always built by us.
    -- A path assembled from client input is the traversal bug this schema
    -- must not invite back.
    storage_key       text        not null,
    filename          text,
    content_type      text,
    byte_size         bigint,

    -- null = the student uploaded it through the widget, where there is no
    -- signed-in user. See the note on RESTRICT below for why this is not
    -- SET NULL: that would turn "a counsellor uploaded this" into "a student
    -- did" the moment the counsellor's row went away.
    uploaded_by       uuid,
    uploaded_at       timestamptz not null default now(),

    extraction        jsonb,
    extraction_model  text,
    extracted_at      timestamptz,

    -- Documents expire before leads do; a CV is needed for weeks, not years.
    retention_until   timestamptz,

    foreign key (tenant_id, lead_id)
        references leads(tenant_id, id) on delete cascade,
    foreign key (tenant_id, uploaded_by)
        references users(tenant_id, id) on delete restrict,

    unique (tenant_id, id),
    unique (storage_key),

    constraint lead_documents_kind_valid
        check (kind in ('cv', 'transcript', 'test_report', 'passport',
                        'offer_letter', 'other')),
    constraint lead_documents_extraction_pair
        check ((extraction is null) = (extracted_at is null)),
    constraint lead_documents_size_positive
        check (byte_size is null or byte_size > 0)
);

-- ---------------------------------------------------------------------------
-- lead_facts — the claim log
-- ---------------------------------------------------------------------------
-- One row per CLAIM. Deliberately no unique constraint on (lead_id, key):
-- a student saying their GPA is 3.4 and a transcript saying 3.38 are two true
-- statements about what we were told, and neither should overwrite the other.
create table lead_facts (
    id            uuid        primary key default gen_random_uuid(),
    tenant_id     text        not null,
    lead_id       uuid        not null,

    key           text        not null,
    -- Shape depends on the key and is validated in code against a Pydantic
    -- model. A jsonb schema constraint here would duplicate those models and
    -- the two would drift; the database checks the key, not the shape.
    value         jsonb       not null,

    source        text        not null,
    -- The student's own words. Required for the two sources that quote.
    source_quote  text,
    -- No foreign key yet: `messages` lands in 004. Added there.
    message_id    uuid,
    document_id   uuid,
    stated_by     uuid,

    -- When the claim was MADE, which is not when the row was written: a
    -- counsellor may record Tuesday's phone call on Thursday.
    observed_at   timestamptz not null default now(),

    status        text        not null default 'active',
    -- null = closed automatically by a later claim. A student who says they
    -- are undecided and then names a country retracts the first claim
    -- themselves; demanding a user id there would mean inventing a system
    -- account to satisfy a foreign key.
    closed_by     uuid,
    closed_reason text,
    closed_at     timestamptz,

    created_at    timestamptz not null default now(),

    foreign key (tenant_id, lead_id)
        references leads(tenant_id, id) on delete cascade,
    foreign key (tenant_id, document_id)
        references lead_documents(tenant_id, id) on delete cascade,
    -- RESTRICT, not SET NULL: the evidence CHECK below requires stated_by on a
    -- counsellor claim, so nulling it would leave a row that violates its own
    -- constraint. Provenance outlives the person, and users are deactivated
    -- rather than deleted (see the closing note on erasure).
    foreign key (tenant_id, stated_by)
        references users(tenant_id, id) on delete restrict,
    -- SET NULL is right here: null already means "closed automatically", and
    -- no constraint depends on it.
    foreign key (tenant_id, closed_by)
        references users(tenant_id, id) on delete set null (closed_by),

    constraint lead_facts_key_valid
        check (key in ('target_country', 'field_of_study', 'qualification',
                       'grades', 'english_test', 'budget_per_year',
                       'intended_intake')),
    constraint lead_facts_source_valid
        check (source in ('student_message', 'document', 'counsellor')),
    -- 'rejected' = never valid evidence ("this transcript is a different
    -- person"). 'retracted' = was true, no longer applies ("I've decided
    -- against Canada"). Only the first casts doubt on the source, and a
    -- student changing their mind is not an error.
    constraint lead_facts_status_valid
        check (status in ('active', 'rejected', 'retracted')),
    constraint lead_facts_value_is_object
        check (jsonb_typeof(value) = 'object'),

    -- A fact cannot exist without its evidence. This moves the anti-inference
    -- rule out of Pydantic and into the schema, where the CV extractor is
    -- bound by it too — the agent's guarantee and the counsellor's are the
    -- same guarantee, differing only in which arm they satisfy.
    constraint lead_facts_evidence check (
        (source = 'student_message'
            and source_quote is not null and message_id is not null
            and document_id is null and stated_by is null)
        or (source = 'document'
            and source_quote is not null and document_id is not null
            and message_id is null and stated_by is null)
        or (source = 'counsellor'
            and stated_by is not null
            and message_id is null and document_id is null)
    ),
    constraint lead_facts_closed_pair
        check ((status = 'active') = (closed_at is null))
);

-- ---------------------------------------------------------------------------
-- tenant_fact_requirements — OVERRIDES ONLY
-- ---------------------------------------------------------------------------
-- The default policy — which facts are required, in what order, and which
-- apply only to certain destinations — lives in code, in one copy. This table
-- holds only what an agency changed, so creating a tenant writes NO rows here
-- and an agency happy with the defaults has none.
--
-- Copying the defaults into every tenant at signup would work and would also
-- freeze them: deciding a year later that budget_per_year should be optional
-- for everyone would mean rewriting a hundred copies while guessing which rows
-- an agency had deliberately changed. It is the same call 002 already made
-- when per-tenant `roles` became a constant in permissions.py.
create table tenant_fact_requirements (
    tenant_id       text        not null references tenants(id) on delete cascade,
    fact_key        text        not null,
    -- null = applies to every destination.
    target_country  char(2),
    -- Three-valued rather than boolean: "ask, but never block" and "do not ask
    -- at all" are both real settings, and a boolean can only express one.
    mode            text        not null,
    -- null = keep the default ordering for this key.
    ask_order       smallint,
    updated_at      timestamptz not null default now(),

    constraint tfr_key_valid
        check (fact_key in ('target_country', 'field_of_study', 'qualification',
                            'grades', 'english_test', 'budget_per_year',
                            'intended_intake')),
    constraint tfr_mode_valid
        check (mode in ('required', 'optional', 'skip')),
    constraint tfr_country_upper
        check (target_country is null or target_country = upper(target_country))
);

-- A plain `unique (tenant_id, fact_key, target_country)` would NOT stop two
-- rows with a null country: nulls are distinct under a unique constraint, so
-- an agency could hold two contradictory defaults for the same key. Coalescing
-- to a value that cannot be a country code closes that.
create unique index tenant_fact_requirements_key_idx
    on tenant_fact_requirements (tenant_id, fact_key, coalesce(target_country, '**'));

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
-- Every lookup starts from a tenant, so tenant_id leads each composite.
create index leads_tenant_status_idx     on leads (tenant_id, status);
create index leads_tenant_assigned_idx   on leads (tenant_id, assigned_user_id);
create index leads_tenant_activity_idx   on leads (tenant_id, last_activity_at);
-- "My countries plus every unassigned lead" is the hottest query in the
-- product, and it only ever looks at NULL assignments.
create index leads_unassigned_idx        on leads (tenant_id, created_at)
    where assigned_user_id is null;
-- Routing: "who owns any of this student's target countries?"
create index leads_target_countries_idx  on leads using gin (target_countries);

-- The resolution query: every active claim for one lead, by key.
create index lead_facts_active_idx       on lead_facts (tenant_id, lead_id, key)
    where status = 'active';
create index lead_facts_document_idx     on lead_facts (tenant_id, document_id);
create index lead_documents_lead_idx     on lead_documents (tenant_id, lead_id);
-- Retention sweeps.
create index lead_documents_retention_idx on lead_documents (retention_until)
    where retention_until is not null;

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
-- set_updated_at() is defined in 001.
create trigger leads_set_updated_at before update on leads
    for each row execute function set_updated_at();
create trigger tenant_fact_requirements_set_updated_at
    before update on tenant_fact_requirements
    for each row execute function set_updated_at();

commit;

-- ---------------------------------------------------------------------------
-- Not here, on purpose
-- ---------------------------------------------------------------------------
-- No seed rows. tenant_fact_requirements is an override table; an agency with
-- no rows uses the default policy, which is the intended state for most.
--
-- No value-shape constraints. The per-key Pydantic models are the definition,
-- and stating them twice guarantees they eventually disagree.
--
-- `leads.target_countries` is a cache. Only the code that resolves
-- target_country claims may write it; nothing else, ever.
--
-- ERASURE IS AN ORDERED PURGE, NOT A CASCADE. `lead_facts.stated_by` and
-- `lead_documents.uploaded_by` are RESTRICT so that provenance cannot be
-- quietly rewritten when someone leaves. That means `delete from tenants`
-- can fail depending on the order Postgres unwinds two independent cascade
-- paths. This is deliberate — prefer failing loudly over degrading gracefully
-- — but it makes deleting an agency an explicit, ordered, logged operation:
-- lead_facts, then lead_documents, then leads, then users, then the tenant.
-- Which is what a GDPR erasure should be anyway.
