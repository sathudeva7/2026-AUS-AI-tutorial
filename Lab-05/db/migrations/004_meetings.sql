-- 004_meetings
--
-- A booked consultation between one student and one counsellor.
--
-- The decision this migration rests on: THERE ARE NO EMPTY SLOTS. A row exists
-- only when a meeting has actually been booked. Free time is derived —
-- `availability_rules` minus the rows here — and never stored.
--
-- The alternative was to explode each counsellor's weekly pattern into
-- concrete bookable rows for the weeks ahead. That produces thousands of rows
-- meaning "nothing is happening", and it turns every edit of a weekly pattern
-- into a reconciliation problem: which generated rows do you delete, and what
-- do you do about the ones already booked inside a window that has just been
-- removed? Deriving free time asks that question once, at read time, where the
-- answer cannot go stale. Pre-generation only pays when a slot needs its own
-- data — a price, a capacity, a length that varies — and none of that exists
-- here.
--
-- Hence `meetings` and not `slots`. 003's header promised "slots" in 004; the
-- name is the design, and this one says what the table holds.
--
-- Conversation, notes, escalations and follow-ups — also promised in 004 — are
-- deliberately NOT here. See the closing note.

begin;

-- Lets `=` and `&&` sit in one exclusion constraint. Without it the
-- no-double-booking rule below cannot be expressed, because gist has no
-- default operator class for uuid equality.
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- meetings
-- ---------------------------------------------------------------------------
-- Times are ABSOLUTE (timestamptz), which is the opposite of
-- `availability_rules` and deliberately so. A weekly pattern is wall clock
-- read against `users.timezone`: "Monday 9am" has no date and belongs to one
-- person. A meeting is a single moment that two people in two countries must
-- both arrive at, so it carries no zone of its own — it is an instant, and
-- each side renders it in their own clock (CLAUDE.md: times stored UTC,
-- rendered in the viewer's zone).
create table meetings (
    id            uuid        primary key default gen_random_uuid(),
    tenant_id     text        not null references tenants(id) on delete cascade,
    lead_id       uuid        not null,
    user_id       uuid        not null,

    starts_at     timestamptz not null,
    ends_at       timestamptz not null,

    -- What the meeting is about AND how to join it, in the counsellor's own
    -- words. One free-text field by decision, not by omission: the joining
    -- method is "whatever this agency uses" — an office address, a Meet link,
    -- a phone number — and a structured column would have to guess that list
    -- correctly on the first try.
    --
    -- The cost, stated plainly so it is not discovered later: a link inside
    -- prose cannot be validated, cannot be turned into a Join button, and
    -- cannot be checked for presence before the confirmation email goes out.
    -- Splitting it out later is an additive migration; guessing wrong now is
    -- a destructive one.
    description   text,

    -- 'no_show' is kept distinct from 'cancelled' because they are different
    -- facts about different people: one is a meeting called off, the other is
    -- a meeting nobody attended. Collapsing them loses the only signal that
    -- says a student is going cold.
    status        text        not null default 'booked',

    -- null = the student booked it themselves through the widget, where there
    -- is no signed-in user.
    created_by    uuid,
    -- null = cancelled by the student, or by the system. Same shape as above.
    cancelled_by     uuid,
    cancelled_reason text,
    cancelled_at     timestamptz,

    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),

    foreign key (tenant_id, lead_id)
        references leads(tenant_id, id) on delete cascade,

    -- RESTRICT, not SET NULL or CASCADE. A meeting with no counsellor is not a
    -- meeting, and silently deleting the record of one that happened would
    -- erase history to make a DELETE convenient. Users are deactivated rather
    -- than deleted, so in normal operation this never fires.
    foreign key (tenant_id, user_id)
        references users(tenant_id, id) on delete restrict,

    -- RESTRICT for both audit columns, for the reason lead_documents already
    -- established: null here MEANS "the student did it", so SET NULL would
    -- rewrite "a counsellor booked this" into "the student booked this" the
    -- moment that counsellor's row went away. Provenance outlives the person.
    foreign key (tenant_id, created_by)
        references users(tenant_id, id) on delete restrict,
    foreign key (tenant_id, cancelled_by)
        references users(tenant_id, id) on delete restrict,

    -- The target a future child's composite foreign key would need.
    unique (tenant_id, id),

    constraint meetings_status_valid
        check (status in ('booked', 'cancelled', 'completed', 'no_show')),
    constraint meetings_ends_after_starts
        check (ends_at > starts_at),
    -- Same pairing lead_facts uses for its closed_* trio: the timestamp and
    -- the status cannot disagree about whether this was called off.
    constraint meetings_cancelled_pair
        check ((status = 'cancelled') = (cancelled_at is not null)),

    -- -----------------------------------------------------------------------
    -- The constraint this table exists for.
    -- -----------------------------------------------------------------------
    -- Two students clicking "book 10:30" in the same second is not a rare
    -- race; it is the normal case for a popular counsellor. An application
    -- that SELECTs for a clash and then INSERTs loses that race every time,
    -- because both transactions read before either writes.
    --
    -- Stated here, overlap is not unlikely — it is unrepresentable.
    --
    -- '[)' is half-open, so 10:00-10:30 and 10:30-11:00 do NOT overlap. Back
    -- to back meetings are the point of a calendar. This is the same choice
    -- the availability API made when it compared windows with < and not <=.
    --
    -- user_id alone, without tenant_id: users.id is a primary key and so is
    -- already unique across tenants. Adding it would widen the index to
    -- restate something the database already guarantees.
    --
    -- WHERE matters as much as the rest: a cancelled meeting must stop
    -- reserving its time, or every cancellation would poison that slot
    -- permanently. Everything else — booked, completed, no_show — did occupy
    -- the counsellor, so all three still block.
    constraint meetings_no_double_booking
        exclude using gist (
            user_id with =,
            tstzrange(starts_at, ends_at, '[)') with &&
        ) where (status <> 'cancelled')

    -- Deliberately NO matching constraint on lead_id. One student meeting two
    -- of the agency's people at once is a joint consultation — a counsellor
    -- and a visa specialist on the same call — which is legitimate and would
    -- be blocked by the symmetric rule. The counsellor's calendar is the
    -- scarce resource; the student's is not ours to police.

    -- Also deliberately no constraint that a meeting fall inside an
    -- availability window. A counsellor takes an urgent call at 8pm, and
    -- hours get edited after a booking exists. Enforcing it here would make
    -- both of those a database error instead of a normal Tuesday. The booking
    -- path checks it and may be overridden; the grid draws such a meeting
    -- outside the painted region, where it reads as what it is.
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
-- The calendar query: one counsellor, one week. Every lookup starts from a
-- tenant, so tenant_id leads.
create index meetings_tenant_user_starts_idx on meetings (tenant_id, user_id, starts_at);
-- "What is booked for this student?", on the lead record.
create index meetings_tenant_lead_idx        on meetings (tenant_id, lead_id);
-- Deactivation has to ask "does this person have meetings still to come?"
-- before it switches them off, and that question only ever looks at live rows.
create index meetings_upcoming_idx           on meetings (tenant_id, user_id, starts_at)
    where status = 'booked';

-- The exclusion constraint builds its own gist index; there is no second one
-- to create for it.

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
-- set_updated_at() is defined in 001.
create trigger meetings_set_updated_at before update on meetings
    for each row execute function set_updated_at();

commit;

-- ---------------------------------------------------------------------------
-- Not here, on purpose
-- ---------------------------------------------------------------------------
-- NO `notified_at` / email delivery columns, even though a confirmation email
-- to both parties is the reason this table was asked for. Nothing sends that
-- email yet, and a column no code writes is indistinguishable from a bug: it
-- reads as "we track this" while always being null. It arrives with the sender.
--
-- NO reschedule columns. Moving a meeting is cancel-plus-book, which keeps the
-- original row intact, gets the freed time back through the WHERE above, and
-- needs no new machinery. An in-place edit would quietly destroy the record of
-- when the meeting used to be.
--
-- NO messages, notes, escalations or follow-ups, which 003's header also
-- promised here. Each is its own slice with its own decisions, and one
-- migration that creates five tables is one migration nobody can revert.
-- `lead_facts.message_id` therefore still has no foreign key, and its comment
-- in 003 still points at a `messages` table that has not landed.
--
-- ERASURE ORDER CHANGES. 003 closes by noting that deleting an agency is an
-- ordered purge, not a cascade, because RESTRICT deliberately guards
-- provenance. `meetings` adds three RESTRICT edges to `users`, so it now joins
-- that sequence and must be deleted BEFORE users:
--     lead_facts, lead_documents, meetings, leads, users, tenant.
-- Missing it out means `delete from tenants` fails, which is the intended
-- loud failure — but only if someone knows to look here.
