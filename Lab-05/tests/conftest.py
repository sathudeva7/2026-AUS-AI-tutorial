"""Fixtures for the HTTP API tests.

The problem these solve: a test that seeds rows in its own transaction and
then calls the app would see nothing, because the app opens its OWN connection
through `db.engine()` and an uncommitted transaction is invisible to it. The
usual escapes are to commit the seed (which writes to whatever database the URL
points at) or to mock the repository (which proves the mock works).

So instead the app is pointed at the TEST'S connection for the duration of one
test, and that connection is rolled back at the end. Nothing is ever committed,
and the SQL under test is real SQL against a real Postgres.

    TEST_DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/postgres \
        student_agent/.venv/bin/pytest tests -v

`DATABASE_URL` is the fallback, as in db/tests — a safety net, not a licence.
"""

from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "student_agent"))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(ROOT / ".env")


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def engine():
    url = os.getenv("TEST_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not url:
        pytest.skip("neither TEST_DATABASE_URL nor DATABASE_URL is set")
    eng = create_engine(url)
    yield eng
    eng.dispose()


@pytest.fixture
def conn(engine):
    """One connection, one transaction, always rolled back."""
    connection = engine.connect()
    trans = connection.begin()
    try:
        yield connection
    finally:
        trans.rollback()
        connection.close()


class _SharedConnect:
    """Stands in for `engine().connect()`, handing back the test's connection.

    `__exit__` deliberately does not close: the connection outlives this block
    and the fixture owns it.
    """

    def __init__(self, connection):
        self._c = connection

    def __enter__(self):
        return self._c

    def __exit__(self, *exc):
        return False


class _SharedBegin:
    """Stands in for `engine().begin()`, as a SAVEPOINT.

    A real `begin()` would commit on exit and end the test's transaction with
    it. A nested transaction gives the code under test the same semantics —
    commit on success, roll back on error — inside a transaction that is itself
    discarded.
    """

    def __init__(self, connection):
        self._c = connection

    def __enter__(self):
        self._sp = self._c.begin_nested()
        return self._c

    def __exit__(self, exc_type, *exc):
        if exc_type is None:
            self._sp.commit()
        else:
            self._sp.rollback()
        return False


@pytest.fixture
def bound_engine(conn, monkeypatch):
    """Point every repository at the test's connection.

    Its own fixture, not folded into `app`, because a test that calls a
    repository directly needs the patch just as much as one that goes through
    HTTP — and without it that test opens a SECOND connection to the same
    database and blocks forever on the rows this transaction is still holding.

    Patched per module rather than on `db` itself: each repository does
    `from db import engine`, which binds the name at import time, so patching
    `db.engine` afterwards would reach none of them.
    """

    class _Bound:
        def connect(self):
            return _SharedConnect(conn)

        def begin(self):
            return _SharedBegin(conn)

    import repositories.tenants
    import repositories.users

    for module in (repositories.tenants, repositories.users):
        monkeypatch.setattr(module, "engine", lambda: _Bound())
    return _Bound()


@pytest.fixture
def app(bound_engine):
    """The FastAPI app, wired to the test's connection."""
    import main

    yield main.app
    main.app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Seed
# ---------------------------------------------------------------------------

@pytest.fixture
def seed(conn):
    """Two agencies, so every test can prove it sees only one of them.

    Ids are unique per run: a leaked row from an interrupted run must not make
    a later run pass or fail for the wrong reason.
    """
    tag = uuid.uuid4().hex[:8]
    a, b = f"tst_A_{tag}", f"tst_B_{tag}"

    conn.execute(
        text("insert into tenants (id, name) values (:a, 'Agency A'), (:b, 'Agency B')"),
        {"a": a, "b": b},
    )

    def add_user(tenant, email, **kw):
        row = {
            "tenant_id": tenant,
            "email": email,
            "clerk_user_id": kw.get("clerk_user_id"),
            "name": kw.get("name"),
            "role": kw.get("role", "counsellor"),
            "status": kw.get("status", "active"),
            "work_phone": kw.get("work_phone"),
        }
        uid = conn.execute(
            text(
                "insert into users (tenant_id, clerk_user_id, email, name, role,"
                " status, work_phone)"
                " values (:tenant_id, :clerk_user_id, :email, :name, :role,"
                " :status, :work_phone) returning id"
            ),
            row,
        ).scalar()
        for country in kw.get("countries", ()):
            conn.execute(
                text(
                    "insert into user_countries (tenant_id, user_id, country)"
                    " values (:t, :u, :c)"
                ),
                {"t": tenant, "u": uid, "c": country},
            )
        return str(uid)

    ids = {
        # Sorted by name, these are: Anita, Priya, Zoe — then the invited user,
        # who has no name yet and must sort last rather than first.
        "priya": add_user(a, "priya@a.test", clerk_user_id=f"ck_p_{tag}",
                          name="Priya", role="owner",
                          countries=["GB", "AU"], work_phone="+94771234567"),
        "anita": add_user(a, "anita@a.test", clerk_user_id=f"ck_a_{tag}",
                          name="Anita", role="manager", countries=["LK"]),
        "zoe": add_user(a, "zoe@a.test", clerk_user_id=f"ck_z_{tag}", name="Zoe"),
        "invited": add_user(a, "new@a.test", status="invited"),
        "gone": add_user(a, "gone@a.test", clerk_user_id=f"ck_g_{tag}",
                         name="Gone", status="deactivated"),
        # The control: this user must never appear in a response for agency A.
        "other": add_user(b, "someone@b.test", clerk_user_id=f"ck_o_{tag}",
                          name="Someone Else"),
    }
    return {"tenant_a": a, "tenant_b": b, **ids}


@pytest.fixture
def client(app, seed):
    """A TestClient signed in as Priya, owner of agency A."""
    from fastapi.testclient import TestClient

    from auth import Principal, require_auth

    principal = Principal(
        clerk_user_id="ck_priya",
        tenant_id=seed["tenant_a"],
        user_id=seed["priya"],
        role="owner",
        grants=frozenset(),
    )
    app.dependency_overrides[require_auth] = lambda: principal
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def anon_client(app):
    """No auth override — the real dependency runs and refuses."""
    from fastapi.testclient import TestClient

    return TestClient(app, raise_server_exceptions=False)
