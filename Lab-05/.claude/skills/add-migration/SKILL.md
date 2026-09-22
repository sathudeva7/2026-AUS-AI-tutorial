---
name: add-migration
description: Load before changing the Lab-05 database — adding or altering a table, column or constraint. Covers the numbered SQL migrations and apply.py, the composite tenant key every child row uses, ON DELETE and the erasure order, and the SCHEMA.md part that has to be written with it. The endpoint on top is add-api-endpoint.
metadata:
  version: "1.0.0"
  scope: Lab-05 database (db/)
  related-skills: add-api-endpoint
---

# add-migration

Head of the chain: `db/migrations/` → `db/SCHEMA.md` → `db/tests/`, then
`add-api-endpoint` to put it on the wire.

`005_catalogue.sql` is the reference migration. Read it — it narrates its own
reasoning, and it is the copy that cannot drift.

## When to use this skill

- A new table, column, index or constraint
- Altering or removing an existing one
- A CHECK that mirrors a rule already stated in Python

**Not** for: seed data alone (`db/import_catalogue.py`), or anything above the
database.

## Before you start

**Is the migration you want to change already applied?** Then you cannot
change it. `apply.py` records filenames in `schema_migrations` and skips what
has run, so editing an applied file does **nothing** on your machine and
something different on a fresh database — the worst kind of divergence,
because both look fine locally.

A mistake is corrected by a **new forward file**. There are no down
migrations and the runner has no rollback. `002_simplify_access.sql` is the
worked example; its header says it plainly:

> 001 has already been applied, so it is left untouched. This is the fix.

## Mechanics

```bash
student_agent/.venv/bin/python db/apply.py --status   # what has run
student_agent/.venv/bin/python db/apply.py            # apply pending
```

- Files are `NNN_name.sql`, applied in sorted order. Take the next number.
- **Each file carries its own `begin;` / `commit;`.** `apply.py` runs it on a
  raw DBAPI connection for that reason; a file without them is not atomic.
- Alembic is a dependency but is **not** wired up. `apply.py` is the runner,
  and it calls itself a stand-in.

## The rule that matters most

**Children reference `(tenant_id, id)`, never `id` alone.** Every parent
carries `unique (tenant_id, id)` to be the target of one.

```sql
create table users (
    id         uuid primary key default gen_random_uuid(),
    tenant_id  text not null references tenants(id) on delete cascade,
    ...
    unique (tenant_id, id)
);

create table user_countries (
    tenant_id  text not null,
    user_id    uuid not null,
    foreign key (tenant_id, user_id)
        references users(tenant_id, id) on delete cascade,
    ...
);
```

A single-column FK would let a row claim one agency while pointing at
another's user, and tenant separation would rest entirely on application code
remembering to filter. With the composite key the database refuses it —
`test_cross_tenant_reference_is_rejected` is that promise, asserted.

Any new tenant-owned table does both halves: the composite FK on the way in,
`unique (tenant_id, id)` on the way out for whatever references it later.

## Every foreign key declares ON DELETE

All 33 in the repo do. The choice is a decision, not a default:

| Strategy | Use for | Example |
|---|---|---|
| `cascade` | Rows the parent owns and that mean nothing without it | `programme_intakes` under a programme |
| `restrict` | Provenance — a row that records who did something | `programmes.verified_by` → `users` |
| `set null` | An optional link whose loss is survivable | `user_permissions.granted_by` |

**`restrict` changes the erasure order.** Deleting an agency is an ordered
purge, not a cascade, precisely because RESTRICT guards provenance. Adding a
RESTRICT edge means updating the sequence — in your migration's footer AND in
SCHEMA.md. The current order is at the end of `005_catalogue.sql`. Miss a step
and `delete from tenants` fails, which is the intended loud failure, but only
if somebody knows where to look.

## Altering a table that already has rows

Adding a `NOT NULL` column to a populated table fails. Three steps, in one
migration:

```sql
alter table programmes add column owner_id uuid;              -- 1. nullable
update programmes set owner_id = ... where owner_id is null;  -- 2. backfill
alter table programmes alter column owner_id set not null;    -- 3. constrain
```

Skip the backfill and the third statement fails, leaving the file
half-applied on anyone who ran it before you fixed it.

**`text` + CHECK, not a Postgres enum type.** Changing a CHECK is an ordinary
migration; `alter type ... add value` has its own rules and cannot be undone.
`users.role` and `users.status` are both done this way.

## House style for the file

1. **Header naming the decision the migration rests on.** 005's is "a
   programme is not visible to students until a person has verified it." Not
   a summary of the tables — the thing they exist to guarantee.
2. **Comments say why, not what.** `create table institutions` needs no
   gloss; why it is split out of `programmes`, and why it is tenant-owned
   rather than global, is the comment.
3. **A footer headed "Not here, on purpose."**

That footer is the habit worth protecting. Before you finish, answer this in
writing:

> Name three things a competent person would reasonably have added to this
> migration. For each, say why it is not here — or add it.

005 has four, and each is a real decision: no revision history (`tool_calls`
already answers it), no per-tenant staleness, no `flagged` boolean, no
`source_url`. A reader six months from now needs the absences explained more
than the presences.

## Pitfalls

| Avoid | Why | Instead |
|---|---|---|
| Editing an applied migration | `apply.py` skips it — your database and a fresh one diverge silently | A new numbered file |
| A bare `references users(id)` | A child can point across agencies | `references users(tenant_id, id)` |
| Omitting `on delete` | The default is `no action`, which is a decision nobody made | State it, and justify `restrict` |
| `create type ... as enum` | `alter type` cannot be undone | `text` + a CHECK |
| `NOT NULL` in one statement on a populated table | The statement fails and the file half-applies | Nullable → backfill → constrain |
| A CHECK duplicating a Python constant | They drift, and the quiet direction is a security bug | Add a drift test — `references/testing.md` |
| Finishing without the SCHEMA.md part | The reasoning exists only in SQL comments nobody greps | `references/schema-md.md` |
| Float for money | Rounding errors in a figure a student budgets on | `bigint` minor units + a currency column |

## References

| Topic | Reference | Load when |
|---|---|---|
| SCHEMA.md | `references/schema-md.md` | Writing the documentation part — it has a fixed four-section shape |
| Tests | `references/testing.md` | Writing constraint tests or a drift test |

## Done when

- [ ] New numbered file; nothing applied was edited
- [ ] `begin;` / `commit;` in the file
- [ ] Tenant-owned tables: composite FK in, `unique (tenant_id, id)` out
- [ ] Every FK declares `on delete`; any new `restrict` updated the erasure order
- [ ] Indexes on foreign keys and on what the queries filter by
- [ ] A "Not here, on purpose" footer with real entries
- [ ] `db/SCHEMA.md` has its part, in the four-section shape
- [ ] Constraint tests in `db/tests/`; `apply.py --status` shows it applied
- [ ] Seeds updated if the table needs them — `db/import_catalogue.py`
- [ ] **Handed off.** A table nothing reads is not a feature — `add-api-endpoint`.
