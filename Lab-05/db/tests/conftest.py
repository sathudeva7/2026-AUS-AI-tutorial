"""Fixtures for the schema constraint tests.

Every test runs inside a transaction that is ALWAYS rolled back, so the suite
leaves no rows behind. That is what makes it safe to point at a real database
— but it is a safety net, not a licence: prefer a throwaway Postgres via
`TEST_DATABASE_URL`, and keep `DATABASE_URL` for when you have nothing else.

    TEST_DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/postgres \
        student_agent/.venv/bin/pytest db/tests -v

No test may call commit(). One that does would write to whatever database the
URL points at.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "student_agent"))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")


@pytest.fixture(scope="session")
def engine():
    """Prefer a disposable database; fall back to the app's own with a warning."""
    url = os.getenv("TEST_DATABASE_URL")
    if not url:
        url = os.getenv("DATABASE_URL")
        if not url:
            pytest.skip(
                "neither TEST_DATABASE_URL nor DATABASE_URL is set; "
                "point one at a Postgres with the migrations applied"
            )
        print(
            "\n  ! no TEST_DATABASE_URL — running against DATABASE_URL.\n"
            "    Every test rolls back, but a disposable database is safer.\n"
        )
    return create_engine(url, pool_pre_ping=True, future=True)


@pytest.fixture
def cur(engine):
    """A cursor in an open transaction. Rolled back unconditionally."""
    raw = engine.raw_connection()
    try:
        yield raw.cursor()
    finally:
        raw.rollback()
        raw.close()


@pytest.fixture
def seed(cur):
    """Two tenants, a role in each, and one active user in tenant A.

    The second tenant exists so the cross-tenant tests have somewhere to point
    that is real but wrong — a reference that fails because the row does not
    exist would prove nothing about tenant isolation.
    """

    def _seed():
        cur.execute("insert into tenants (id, name) values ('org_A', 'Agency A')")
        cur.execute("insert into tenants (id, name) values ('org_B', 'Agency B')")

        cur.execute(
            "insert into roles (tenant_id, name) values ('org_A', 'counsellor')"
            " returning id"
        )
        role_a = cur.fetchone()[0]
        cur.execute(
            "insert into roles (tenant_id, name) values ('org_B', 'counsellor')"
            " returning id"
        )
        role_b = cur.fetchone()[0]

        cur.execute(
            "insert into users (tenant_id, clerk_user_id, email, role_id, status)"
            " values ('org_A', 'user_clerk_a', 'priya@agency-a.test', %s, 'active')"
            " returning id",
            (role_a,),
        )
        user_a = cur.fetchone()[0]
        return {"role_a": role_a, "role_b": role_b, "user_a": user_a}

    return _seed
