"""Postgres connection for the Northbound backend.

One engine per process, created lazily so importing this module never opens a
socket — tests and the migration runner import it without a live database.

`DATABASE_URL` lives in Lab-05/.env and holds a password, so it is read from
the environment and never written into code. The URL carries `sslmode=require`
because Supabase refuses plaintext connections.

Nothing here knows about tenants. Tenant scoping is the repository layer's job
and every query filters on `tenant_id` — see CLAUDE.md. A session handed out
by this module is not scoped to anything on its own.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

# Lab-05/.env — one file for the whole lab, same as the agent keys.
ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

PLACEHOLDER = "REPLACE_WITH_PASSWORD"


def database_url() -> str:
    """The connection URL, or a loud failure explaining what to fix.

    Failing here beats a connection error 200ms later with a stack trace that
    says nothing about `.env` — CLAUDE.md: prefer failing loudly over
    degrading gracefully.
    """
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        raise RuntimeError(
            "DATABASE_URL is not set. Copy it from your Supabase project's "
            f"Settings -> Database page into {ROOT / '.env'}"
        )
    if PLACEHOLDER in url:
        raise RuntimeError(
            f"DATABASE_URL still contains {PLACEHOLDER}. Paste your Supabase "
            f"database password into {ROOT / '.env'}. Percent-encode it if it "
            "contains @ : / ? # or %."
        )
    return url


@lru_cache(maxsize=1)
def engine() -> Engine:
    """Process-wide engine.

    `pool_pre_ping` matters against a hosted database: Supabase drops idle
    connections, and without it the first query after an idle spell fails on a
    stale socket rather than transparently reconnecting.
    """
    return create_engine(
        database_url(),
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=5,
        # Recycle below any sensible server-side idle timeout.
        pool_recycle=1800,
        future=True,
    )


@lru_cache(maxsize=1)
def _session_factory() -> sessionmaker[Session]:
    return sessionmaker(bind=engine(), expire_on_commit=False, future=True)


def get_session() -> Session:
    """A new session. Caller owns its lifetime."""
    return _session_factory()()
