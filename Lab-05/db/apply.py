"""Apply the raw SQL migrations in order, and record which have run.

A stand-in for Alembic until it is wired up. It is deliberately small, but it
does the one thing that makes a migration runner safe: it records what has
been applied in `schema_migrations` and refuses to run a file twice.

    Lab-05/student_agent/.venv/bin/python db/apply.py          # apply pending
    Lab-05/student_agent/.venv/bin/python db/apply.py --status  # show state

Each file runs inside its own transaction, so a failure leaves the database on
the last good migration rather than half-applied.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "student_agent"))

from sqlalchemy import text  # noqa: E402

from db import engine  # noqa: E402

MIGRATIONS = Path(__file__).resolve().parent / "migrations"

LEDGER = """
create table if not exists schema_migrations (
    filename    text primary key,
    applied_at  timestamptz not null default now()
)
"""


def applied(conn) -> set[str]:
    conn.execute(text(LEDGER))
    rows = conn.execute(text("select filename from schema_migrations")).scalars()
    return set(rows)


def main() -> int:
    files = sorted(MIGRATIONS.glob("*.sql"))
    if not files:
        print(f"no .sql files in {MIGRATIONS}")
        return 1

    eng = engine()

    with eng.begin() as conn:
        done = applied(conn)

    if "--status" in sys.argv:
        for f in files:
            print(f"  {'applied' if f.name in done else 'PENDING'}  {f.name}")
        return 0

    pending = [f for f in files if f.name not in done]
    if not pending:
        print("nothing to apply; database is up to date")
        return 0

    for f in pending:
        print(f"applying {f.name} ...", end=" ", flush=True)
        sql = f.read_text(encoding="utf-8")
        try:
            # The file carries its own begin/commit, so use a raw DBAPI
            # connection rather than SQLAlchemy's implicit transaction —
            # nesting the two would leave the outer one dangling.
            raw = eng.raw_connection()
            try:
                cur = raw.cursor()
                cur.execute(sql)
                raw.commit()
            finally:
                raw.close()
            with eng.begin() as conn:
                conn.execute(
                    text("insert into schema_migrations (filename) values (:f)"),
                    {"f": f.name},
                )
        except Exception as exc:  # noqa: BLE001 — surface the real error
            print("FAILED")
            print(f"\n{type(exc).__name__}: {exc}")
            return 1
        print("ok")

    print(f"\napplied {len(pending)} migration(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
