"""A catalogue to read, in both agencies.

Built on the shared `seed`, so the cross-tenant tests still have agency B to
point at and Priya still owns agency A.

Dates are relative to now rather than fixed, because staleness is the thing
half these tests are about: a hardcoded 2026 date would quietly become stale
and start passing tests that should fail.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text


def _utc(days_ago: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=days_ago)


@pytest.fixture
def catalogue(conn, seed):
    """Six programmes in agency A, one in B, covering every status.

    Returned as a dict of id by nickname so a test can name the row it means.
    """
    ids: dict[str, str] = {}

    def institution(tenant, name, country="GB"):
        return conn.execute(
            text("insert into institutions (tenant_id, name, country)"
                 " values (:t, :n, :c) returning id"),
            {"t": tenant, "n": name, "c": country},
        ).scalar()

    def programme(tenant, inst, name, **kw):
        row = {
            "t": tenant, "inst": inst, "name": name,
            "level": kw.get("level", "masters"),
            "field": kw.get("field", "data science"),
            "country": kw.get("country", "GB"),
            "city": kw.get("city", "London"),
            "minor": kw.get("minor", 2450000),
            "currency": kw.get("currency", "GBP"),
            "months": kw.get("months", 12),
            "status": kw.get("status", "published"),
            "verified_at": kw.get("verified_at", _utc(1)),
            # Must be a user in THIS tenant: the composite foreign key
            # refuses a verifier from another agency, which is the isolation
            # rule doing its job rather than an inconvenience.
            "verified_by": (
                None if kw.get("status", "published") == "draft"
                else kw.get("verified_by", seed["priya"])
            ),
        }
        if row["status"] == "draft":
            row["verified_at"] = None
        # Written in the PAST, like a real row.
        #
        # Every statement in a test shares one transaction, so now() is
        # identical for the insert and for any edit that follows — and the
        # edited-since-verified comparison, which is exact, could never fire.
        # A programme created thirty days ago and last written when it was
        # verified is what the production row actually looks like.
        row["created_at"] = _utc(30)
        row["updated_at"] = row["verified_at"] or _utc(30)
        pid = conn.execute(
            text("""
                insert into programmes (
                    tenant_id, institution_id, name, level, field, country, city,
                    tuition_per_year_minor, currency, duration_months,
                    status, verified_at, verified_by, created_at, updated_at
                ) values (
                    :t, :inst, :name, :level, :field, :country, :city,
                    :minor, :currency, :months, :status, :verified_at,
                    :verified_by, :created_at, :updated_at
                ) returning id
            """),
            row,
        ).scalar()
        for intake, deadline, is_open in kw.get("intakes", ()):
            conn.execute(
                text("insert into programme_intakes"
                     " (tenant_id, programme_id, intake, application_deadline, is_open)"
                     " values (:t, :p, :i, :d, :o)"),
                {"t": tenant, "p": pid, "i": intake, "d": deadline, "o": is_open},
            )
        for order, (key, rule, desc, mandatory) in enumerate(kw.get("requirements", ())):
            conn.execute(
                text("insert into programme_requirements"
                     " (tenant_id, programme_id, fact_key, rule, description,"
                     "  mandatory, sort_order)"
                     " values (:t, :p, :k, :r, :d, :m, :o)"),
                {"t": tenant, "p": pid, "k": key, "r": rule, "d": desc,
                 "m": mandatory, "o": order},
            )
        return str(pid)

    a, b = seed["tenant_a"], seed["tenant_b"]
    camden = institution(a, "Camden Metropolitan University")
    thames = institution(a, "Thameside University")
    swan = institution(a, "Swan River University", country="AU")

    today = datetime.now(timezone.utc).date()

    ids["fresh"] = programme(
        a, camden, "MSc Data Science",
        intakes=[("2027-01", today + timedelta(days=200), True),
                 ("2027-09", today + timedelta(days=40), True)],
        requirements=[
            ("qualification", "bachelor_years>=4", "A four-year degree.", True),
            ("grades", "percentage>=65", "A UK 2:1.", True),
            ("budget_per_year", "tuition_per_year<=budget_per_year",
             "Within your budget.", False),
        ],
    )
    # Same institution — proves search matches the university, not only the
    # programme name.
    ids["sibling"] = programme(a, camden, "MSc Business Analytics")
    ids["stale"] = programme(a, thames, "MSc Artificial Intelligence",
                             verified_at=_utc(45))
    ids["draft"] = programme(a, thames, "MSc Robotics", status="draft")
    ids["archived"] = programme(a, thames, "MSc Withdrawn Studies",
                                status="archived")
    # Every intake in the past: the "no open intake" case.
    ids["closed"] = programme(
        a, swan, "Master of Cybersecurity", country="AU", city="Perth",
        currency="AUD", minor=4120000,
        intakes=[("2025-02", today - timedelta(days=400), True)],
    )
    # The control. Must never appear in a response for agency A.
    ids["other"] = programme(b, institution(b, "Elsewhere University"),
                             "MSc Somewhere Else", verified_by=seed["other"])

    return ids


@pytest.fixture
def writer_client(app, seed):
    """Signed in as a counsellor who may EDIT the catalogue but not certify it.

    The split this proves is the whole point of having two permissions:
    correcting a fee and putting your name to it are different acts, and the
    person trusted with the first is not automatically trusted with the
    second.
    """
    from fastapi.testclient import TestClient

    from auth import Principal, require_auth

    app.dependency_overrides[require_auth] = lambda: Principal(
        clerk_user_id="ck_zoe",
        tenant_id=seed["tenant_a"],
        user_id=seed["zoe"],
        role="counsellor",
        grants=frozenset({"catalogue.write"}),
    )
    return TestClient(app, raise_server_exceptions=False)
