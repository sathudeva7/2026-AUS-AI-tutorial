# Testing an endpoint

Real SQL against real Postgres. Nothing is mocked and nothing is committed.
Mocking the repository proves the mock works; committing the seed writes to
whatever database the URL points at. This setup avoids both.

```bash
TEST_DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/postgres \
  student_agent/.venv/bin/pytest tests -q
```

`DATABASE_URL` is the fallback if `TEST_DATABASE_URL` is unset — a safety net,
not a licence. With neither set the suite skips rather than passing hollowly.

Two suites, and they answer different questions:

| Suite | Asks |
|---|---|
| `tests/` | Does the HTTP layer behave — status, shape, permission, scoping |
| `db/tests/` | Does the SCHEMA hold — constraints, cascades, CHECK rules |

## How the app sees the test's rows

A test seeds inside its own transaction. The app opens its own connection
through `db.engine()`, and an uncommitted transaction is invisible to it — so
without intervention the app would see nothing.

`tests/conftest.py` solves it by pointing every repository at the test's
connection for the duration of one test, then rolling back. Two details
matter if you add a repository module:

- **`bound_engine` patches each repository module by name**, not `db.engine`.
  Every repository does `from db import engine`, which binds at import time,
  so patching `db.engine` afterwards reaches none of them. **A new repository
  module must be added to that list** or its tests open a second connection
  and block forever on rows the first transaction still holds.
- **`engine().begin()` becomes a SAVEPOINT**, not a real transaction. A real
  `begin()` would commit on exit and end the test's transaction with it. The
  nested version gives the code under test the same semantics — commit on
  success, roll back on error — inside a transaction that is discarded.

## The fixtures

| Fixture | Gives you |
|---|---|
| `conn` | One connection, one transaction, always rolled back |
| `bound_engine` | Every repository pointed at that connection |
| `app` | The FastAPI app, wired to it |
| `seed` | **Two agencies**, A and B, with a roster in A |
| `client` | `TestClient` signed in as Priya, owner of agency A |
| `anon_client` | No auth override — the real dependency runs and refuses |

`seed` returns a dict: `tenant_a`, `tenant_b`, and user ids by nickname —
`priya` (owner, owns GB and AU), `anita` (manager, LK), `zoe` (counsellor),
`invited`, `gone` (deactivated), and `other`, who belongs to agency B.

Two properties of `seed` worth knowing before you extend it:

- **Ids are unique per run** (`uuid4().hex[:8]`). A leaked row from an
  interrupted run must not make a later run pass or fail for the wrong reason.
- **`other` is the control.** It must never appear in a response for agency A.

## The tests every endpoint needs

**1. The happy path** — status, and the fields the client actually reads.

**2. Cross-tenant.** Ask for agency B's id as Priya, assert `404`.

```python
def test_a_programme_in_another_agency_is_not_found(client, catalogue):
    response = client.get(f"/api/programmes/{catalogue['other']}")
    assert response.status_code == 404
```

`other` is the convention for the agency-B row, in both `seed` and each
area's own fixture — so a cross-tenant test reads the same everywhere.

`404`, not `403`: whether an id exists elsewhere is not this caller's
business, and two different answers let somebody enumerate other agencies'
rows.

**3. Permission.** A caller whose role lacks the key gets `403` with
`MISSING_PERMISSION`. Override `require_auth` with a `Principal` carrying a
lower role rather than editing the roster.

**4. Validation.** The refusal names the field, in `details`, not glued into
the message.

## Fixtures for a new area

Put them in `tests/<area>/conftest.py`, built on `seed` so the cross-tenant
control still exists. `tests/catalogue/conftest.py` is the model: it returns
`ids` keyed by nickname so a test can name the row it means rather than
indexing into a list.

**Dates relative to `now`, never hardcoded.** A fixed 2026 date quietly
becomes stale and starts passing tests that should fail — which matters most
in exactly the tests that are about staleness.

```python
def _utc(days_ago: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=days_ago)
```

## Drift tests

When a rule is stated in two languages, a test asserts they still agree.
Adding a second statement of an existing rule means adding one of these.

Existing examples to copy:

- `GRANTABLE` ↔ the `user_permissions` CHECK — `db/tests/test_constraints.py`
- `services/rules.py::threshold` ↔ `mocks.client._threshold`
- the server's `stale_after_days` ↔ what the console badges

The failure they prevent is the quiet one: two places that disagree, where the
disagreement only shows up as wrong behaviour months later.
