# Testing a migration

`db/tests/` asserts what the **schema** refuses. It is a different question
from `tests/`, which asks whether the HTTP layer behaves — and a different
question from "does the app work".

```bash
TEST_DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/postgres \
  student_agent/.venv/bin/pytest db/tests -v
```

Point it at a Postgres **with the migrations already applied** — these tests
check constraints, they do not create them. `DATABASE_URL` is the fallback
and prints a warning; prefer a disposable database.

## Everything rolls back

The `cur` fixture opens a raw cursor in a transaction and rolls it back
unconditionally. **No test may call `commit()`.** One that does writes to
whatever database the URL points at, and the suite stops being safe to run
against anything.

`seed` gives you two tenants and an active user in A. The second tenant is
there so cross-tenant tests have somewhere **real but wrong** to point — a
reference that fails because the row does not exist would prove nothing about
isolation.

## Assert the refusal, not the success

A constraint test inserts a bad row and expects the database to reject it.
Name the test after the row that cannot exist.

```python
def test_cross_tenant_reference_is_rejected(cur, seed):
    s = seed()
    with pytest.raises(errors.ForeignKeyViolation):
        cur.execute(
            "insert into user_countries (tenant_id, user_id, country)"
            " values ('org_B', %s, 'LK')",
            (s["user_a"],),
        )
```

Catch the **specific** psycopg error, not bare `Exception`:

| Constraint | Raises |
|---|---|
| Foreign key | `errors.ForeignKeyViolation` |
| CHECK | `errors.CheckViolation` |
| UNIQUE | `errors.UniqueViolation` |
| NOT NULL | `errors.NotNullViolation` |

A bare `Exception` passes on a typo in your SQL, which is the one thing a
constraint test must not do.

Pair each refusal with its acceptance where the boundary is the point —
`test_non_e164_phone_is_rejected` sits next to `test_e164_phone_is_accepted`.
A CHECK that rejects everything also passes the rejection test.

## What every new table needs

- **Cross-tenant reference rejected** — the composite FK actually works
- **Each CHECK**, refused and accepted at its boundary
- **Each UNIQUE**, including the case-insensitive ones
- **NOT NULL on the columns that matter** — the ones whose absence would make
  a row meaningless rather than merely incomplete

## Drift tests

A rule stated in both SQL and Python needs a test asserting the two still
agree. Without one the copies diverge, and the quiet direction is a security
bug rather than a bug report.

`test_code_map_matches_the_database_check` is the model: it imports
`GRANTABLE` from `permissions.py` and asserts it equals the literal set in
the `user_permissions` CHECK.

Two ways to write one:

- **Against a literal**, as above — simple, and the test is the third copy,
  which is fine when the list is short and changes rarely.
- **Read the constraint out of `pg_constraint`** and compare — what
  `db/tests/test_catalogue.py` does for the fact-key CHECK. Better when the
  list is long enough that a third hand-maintained copy would itself drift.

Existing pairs, for reference:

| Stated in SQL | Stated in Python |
|---|---|
| `user_permissions` CHECK | `permissions.GRANTABLE` |
| `programme_requirements.fact_key` CHECK | the seven fact keys |
| `lead_facts.fact_key` CHECK | the same seven |

If your migration adds a CHECK whose values also live in a constant, you are
adding a fourth row to that table. Write the test in the same commit.
