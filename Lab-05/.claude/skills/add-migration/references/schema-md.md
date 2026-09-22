# Writing the SCHEMA.md part

`db/SCHEMA.md` is one document in numbered parts, one per migration that
introduced tables. A migration is not finished until its part exists.

It is not a column reference. The columns are in the SQL, and a second copy
of them would drift within a month. **This document holds the reasoning** —
what the database guarantees, what it cannot, and what was deliberately left
out. Those are the three things a reader six months from now cannot recover
from the schema itself.

## The four sections

Every part follows the same shape. Parts 1–4 all do; yours should too.

### `## Enforced by the database, not by discipline`

A bullet per constraint, each naming **what it prevents**, not what it is.

> - **A price is an amount AND a currency.** `24500` with no currency is not
>   a cheaper programme, it is an unanswerable question.
> - **An intake is a month.** `'2027-9'` and `'2027-13'` are the two ways a
>   typed or extracted intake goes wrong, and both silently never match.

The test of a good bullet: it describes a bad row that can no longer exist.
"`intake` matches a regex" fails that test; "an intake is a month" passes.

### `## Rules no constraint can express`

What the database cannot check, and therefore what code must uphold — with
**where** that code lives, because an unenforced rule with no named owner is
a rule nobody owns.

> **A country code is real.** The CHECK is shape only — `'UK'` and `'XX'` are
> both two uppercase letters and neither is a country. ISO 3166 lives in
> `services/geo.normalise_country`, which every write path must go through.

Where a rule has already been broken in practice, say so and say what it
cost. The `'UK'` versus `GB` entry does this: the coverage banner reported
Britain permanently unowned, so the alarm that screen exists to raise was
stuck on. A worked failure is what stops the next person taking the same
shortcut.

### `## Deliberately absent`

What a competent person would have added, and why it is not there. Bold lead,
then the reasoning.

> **No revision history.** "What fee were we quoting in August?" is already
> answerable: `tool_calls` records what `search_programmes` returned, with its
> timestamp. A second history would be a second source of truth for one
> question, and the two would disagree the first time a backfill ran.

Three shapes of reason, all legitimate:

- **Already answered elsewhere** — a second mechanism would be a second truth
- **Not asked for yet** — configurable before anyone wants it configured
- **Coming in a later migration** — say which, so it reads as sequencing
  rather than oversight (005 defers `source_url` and `flagged` to 006)

This section mirrors the migration's own "Not here, on purpose" footer. Keep
them consistent; if they disagree, the next reader trusts neither.

### `## The erasure order has changed`

**Only when the migration added a RESTRICT edge.** Deleting an agency is an
ordered purge rather than a cascade, because RESTRICT deliberately guards
provenance. State the full new sequence, not the delta — a reader needs the
order they must follow, not a changelog to apply themselves.

Current, from part 4:

```
lead_facts, lead_documents, meetings, leads,
programmes (intakes and requirements cascade), institutions,
users, tenant
```

Miss a step and `delete from tenants` fails. That is the intended loud
failure, but only if somebody knows to look here.

## Before the four sections

Open with the idea the tables rest on, in prose. Part 2 calls this "One idea
underneath all of it"; part 4 uses "A programme is not visible until a person
has verified it" as its own heading. One decision, stated so the tables read
as consequences of it rather than as a list.

Prose and tables, not DDL. If a reader needs the exact column type they open
the migration, and that is the right place for them to find it.
