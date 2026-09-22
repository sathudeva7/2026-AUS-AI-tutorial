---
name: add-api-endpoint
description: Load before adding or changing an HTTP endpoint in Lab-05 — which layer each piece belongs in, the router/envelope/permission conventions, the tenant-scoping rule, and the Postgres tests that go with it. Backend only; the React half is add-feature-slice.
metadata:
  version: "1.0.0"
  scope: Lab-05 backend (student_agent/)
  related-skills: add-feature-slice
---

# add-api-endpoint

The backend half of a Northbound slice: `repositories` → `api` → `tests`.

This file is a **sequence and a set of pointers**, not a restatement. Most of
the doctrine is already written as module docstrings, and those are the copy
that cannot drift from the code. Read the one for the layer you are in.

## When to use this skill

- Adding an endpoint, or changing what an existing one accepts or returns
- Moving an endpoint out of `main.py` into `api/`
- Replacing a file-mock read with a Postgres read

**Not** for: a new column or table (that is a migration — see "Before you
start"), anything under `web/`, or Playwright tests.

Do not restate CLAUDE.md here. It is already in context on every turn, and
repeating the product guarantees costs tokens and says nothing new.

## Before you start

Two branches, both before the first edit:

- **Does this need a column, table or constraint that does not exist?** Stop.
  The migration comes first, with its `db/SCHEMA.md` note. An endpoint written
  against a column you are about to add is a rewrite.
- **Does the endpoint already exist and only the screen is missing?** Wrong
  skill — load `add-feature-slice`. This is the failure that shipped a blank
  catalogue editor over live programmes: the backend was complete and nobody
  had wired the form to it.

## The layer map

| Layer | Owns | Never |
|---|---|---|
| `api/<x>.py` | Status codes, headers, JSON shapes, permission checks | SQL; domain judgement |
| `repositories/<x>.py` | Every SQL statement in the application | Importing `fastapi` or `auth` |
| `services/<x>.py` | Domain questions — is this a real phone number, what is this currency's exponent | Requests, sessions, rows |

Read these three before writing in them. They are short and they are the
authority:

- [`student_agent/repositories/__init__.py`](../../../student_agent/repositories/__init__.py) — why `tenant_id` is the first parameter of every function
- [`student_agent/api/__init__.py`](../../../student_agent/api/__init__.py) — why routers come from `new_router()`
- [`student_agent/envelope.py`](../../../student_agent/envelope.py) — what wraps a response, and what does not

Reference implementations, in preference to anything pasted into this file:
`api/users.py` for a router, `repositories/catalogue.py` for a repository.

## References

Load one when you reach it. Do not read them up front.

| Topic | Reference | Load when |
|---|---|---|
| Tests | `references/testing.md` | Writing or fixing any test — the connection/rollback setup, the `seed` fixture, cross-tenant and drift tests |
| Errors | `references/errors.md` | Choosing a status and a code, or adding a new one to the vocabulary |
| Worked example | `references/worked-example.md` | You want a whole slice end to end rather than a rule at a time |

## High-level flow

1. **Repository function first.** `tenant_id` as the first parameter, all SQL
   here, plain data out. It must be callable from a test or a worker with no
   request in sight.
2. **Pydantic models beside the route**, in `api/<x>.py`. They are the wire
   contract for those routes and change with them. Not a `schemas/` folder.
3. **The route**, on a router built by `new_router(tags=["<x>"])`.
4. **A permission on every route** — `Depends(require_permission("<key>"))`.
   Pick an existing key from `permissions.py::CATALOGUE`. Minting a new one is
   three edits, not one: the `Permission` entry, the `user_permissions` CHECK
   in `db/migrations/002_simplify_access.sql`, and the drift assertion in
   `db/tests/test_constraints.py`.
5. **Pass `principal.tenant_id` into the repository.** Never a value from a
   body, query string or header. The parameter is safe; its SOURCE is the
   whole security argument.
6. **Tests**, including the cross-tenant one — `references/testing.md`.
7. **Hand off.** An endpoint with no caller is not finished — load
   `add-feature-slice` and wire the screen.

## Settled decisions

Places the existing code disagrees with itself. Follow these, not the nearest
file.

- **Return the value plainly.** `EnvelopeRoute` wraps it. Use `enveloped()`
  only to attach `meta` (paging, counts) or `message`. `api/catalogue.py`
  calls it on everything; that is the outlier, not the model.
- **Errors**: `raise ApiError(status, "CODE", "Human sentence.", details=[...])`.
  The catalogue of existing codes and the rule for minting a new one are in
  `references/errors.md`.
- **Another tenant's row is `404`, never `403`.** Whether an id exists
  elsewhere is not this caller's business, and two different answers let
  somebody enumerate other agencies' rows.
- **A write returns the whole row**, through a `_detail()`-style helper, so
  the client replaces what it holds instead of refetching and a derived field
  is never a turn out of date.

## Common pitfalls

- **`APIRouter()` instead of `new_router()`.** `include_router` re-registers
  routes under the INCLUDED router's class, not the app's, so the envelope is
  silently dropped on exactly the endpoints you touched. It surfaces as a
  frontend parse error, nowhere near the cause.
- **Clamping a bad `limit`.** `Query(25, ge=1, le=100)` — bounded, so a caller
  who asks for 5000 is refused. Silently returning 100 gives them a wrong
  answer without telling them.
- **Money as one value.** Reads ship `*_minor` plus `currency`; writes take
  the figure as the person typed it, as a string. `services/money.py` owns the
  exponent table, because JPY has no minor unit and BHD has three. Never a
  float, never a formatted string — a formatted string cannot be sorted,
  compared or converted.
- **Accepting a country name.** ISO 3166-1 alpha-2 at the boundary, through
  `geo.normalise_country`. Refuse anything else rather than matching nothing,
  which reads to a user as "this agency has no British programmes".
- **PATCH overwriting untouched columns.** `model_dump(exclude_unset=True)`,
  and the repository filters to its own writable set. Two people with one
  record open must not clobber each other.
- **Clearing `verified_at` on an edit.** It drags a published row back to
  draft and takes it away from students because somebody fixed a spelling.
  `updated_at` moves; `edited_since_verified` is derived from the pair.

## Done when

- [ ] Repository function takes `tenant_id` first and holds all the SQL
- [ ] Router built with `new_router()`; models beside the routes
- [ ] Every route carries `require_permission`, and any new key is in all three places
- [ ] `tenant_id` comes from `principal`, never from the request
- [ ] Cross-tenant test returns 404; `pytest tests` green
- [ ] **Caller wired, or `add-feature-slice` loaded.** An endpoint nothing
      calls is not a finished slice.
