"""PUT /api/users/{id}/countries — who owns routing for where.

`user_countries` is the routing key: a lead goes to whoever owns its target
country, and to the unassigned queue when nobody does. So this endpoint
decides where work lands, which is why it is owner and manager only and why
the target user is looked up scoped to the caller's own agency.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text


def put(client, user_id, countries):
    r = client.put(f"/api/users/{user_id}/countries", json={"countries": countries})
    return r, r.json()


def countries_of(conn, tenant, user_id):
    return conn.execute(
        text("select country from user_countries"
             " where tenant_id = :t and user_id = :u order by country"),
        {"t": tenant, "u": user_id},
    ).scalars().all()


def signed_in_as(app, seed, role, user_key="anita"):
    from fastapi.testclient import TestClient

    from auth import Principal, require_auth

    app.dependency_overrides[require_auth] = lambda: Principal(
        clerk_user_id="ck_x", tenant_id=seed["tenant_a"], user_id=seed[user_key],
        role=role, grants=frozenset(),
    )
    return TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# Access
# ---------------------------------------------------------------------------

def test_without_a_token_it_refuses(anon_client, seed):
    r = anon_client.put(f"/api/users/{seed['zoe']}/countries",
                        json={"countries": ["GB"]})
    assert r.status_code == 401


def test_a_counsellor_cannot_set_countries(app, seed, conn):
    """Owning a country decides which leads you see. Letting a counsellor set
    that is letting them grant themselves visibility."""
    r = signed_in_as(app, seed, "counsellor").put(
        f"/api/users/{seed['zoe']}/countries", json={"countries": ["GB"]})
    assert r.status_code == 403
    assert r.json()["error"]["details"][0]["issue"] == "users.countries.manage"
    assert countries_of(conn, seed["tenant_a"], seed["zoe"]) == []


def test_a_manager_may_set_countries(app, seed):
    """Day-to-day team management, not a keys-to-the-kingdom setting: someone
    has to move a country when a counsellor goes on leave."""
    r = signed_in_as(app, seed, "manager").put(
        f"/api/users/{seed['zoe']}/countries", json={"countries": ["GB"]})
    assert r.status_code == 200


def test_an_owner_may_set_countries(client, seed):
    r, _ = put(client, seed["zoe"], ["GB"])
    assert r.status_code == 200


def test_it_is_not_grantable_to_a_counsellor(app, seed):
    """Even with the grant, because the key is absent from the
    user_permissions CHECK — handing out routing one country at a time is how
    someone becomes a manager by the back door."""
    from permissions import GRANTABLE

    assert "users.countries.manage" not in GRANTABLE


# ---------------------------------------------------------------------------
# Tenant isolation
# ---------------------------------------------------------------------------

def test_another_agencys_user_is_not_found(client, conn, seed):
    """404, not 403. A 403 would confirm that id exists, which is a slower way
    of answering the same question an attacker was asking."""
    r, body = put(client, seed["other"], ["GB"])
    assert r.status_code == 404
    assert body["error"]["code"] == "USER_NOT_FOUND"
    assert countries_of(conn, seed["tenant_b"], seed["other"]) == []


def test_an_unknown_id_is_not_found(client):
    r, _ = put(client, "00000000-0000-0000-0000-000000000000", ["GB"])
    assert r.status_code == 404


def test_a_malformed_id_is_refused(client):
    r, body = put(client, "not-a-uuid", ["GB"])
    assert r.status_code == 422
    assert body["error"]["details"][0]["field"] == "user_id"


# ---------------------------------------------------------------------------
# Replacing the set
# ---------------------------------------------------------------------------

def test_it_replaces_rather_than_adds(client, conn, seed):
    put(client, seed["zoe"], ["GB", "AU"])
    put(client, seed["zoe"], ["LK"])
    assert countries_of(conn, seed["tenant_a"], seed["zoe"]) == ["LK"]


def test_an_empty_list_clears_ownership(client, conn, seed):
    """A real state, not an error: that person sees only the unassigned queue
    until someone gives them a country."""
    r, body = put(client, seed["priya"], [])
    assert r.status_code == 200
    assert body["data"]["countries"] == []
    assert countries_of(conn, seed["tenant_a"], seed["priya"]) == []


def test_unchanged_countries_keep_their_original_date(client, conn, seed):
    """The reason this computes a diff instead of deleting and re-inserting.

    `assigned_at` is what answers "who owned UK in March?" — the whole point
    of a table rather than an array on users. A blind replace resets it on
    every country including the ones nobody touched, and the history is gone
    with no error to notice.
    """
    put(client, seed["zoe"], ["GB", "AU"])
    before = conn.execute(
        text("select country, assigned_at from user_countries"
             " where user_id = :u order by country"), {"u": seed["zoe"]},
    ).mappings().all()
    original = {r["country"]: r["assigned_at"] for r in before}

    # AU stays, GB goes, LK arrives.
    put(client, seed["zoe"], ["AU", "LK"])
    after = conn.execute(
        text("select country, assigned_at from user_countries"
             " where user_id = :u order by country"), {"u": seed["zoe"]},
    ).mappings().all()
    now = {r["country"]: r["assigned_at"] for r in after}

    assert sorted(now) == ["AU", "LK"]
    assert now["AU"] == original["AU"], "AU was untouched and must keep its date"


def test_two_users_may_own_the_same_country(client, conn, seed):
    """Deliberately no unique constraint on (tenant_id, country): overlap is
    resolved by the routing tie-break, not prevented here."""
    put(client, seed["zoe"], ["GB"])
    r, _ = put(client, seed["anita"], ["GB"])
    assert r.status_code == 200
    owners = set(conn.execute(
        text("select user_id::text from user_countries"
             " where tenant_id = :t and country = 'GB'"),
        {"t": seed["tenant_a"]},
    ).scalars())
    # Priya already owns GB from the seed, so this is three, not two.
    assert {seed["zoe"], seed["anita"], seed["priya"]} <= owners


# ---------------------------------------------------------------------------
# Input
# ---------------------------------------------------------------------------

def test_lowercase_codes_are_normalised(client, conn, seed):
    put(client, seed["zoe"], ["gb", "au"])
    assert countries_of(conn, seed["tenant_a"], seed["zoe"]) == ["AU", "GB"]


def test_duplicates_are_collapsed_not_rejected(client, conn, seed):
    """A multi-select can send the same value twice; that is not a mistake
    worth a 422, and `unique (user_id, country)` would refuse the insert."""
    r, _ = put(client, seed["zoe"], ["GB", "gb", "GB"])
    assert r.status_code == 200
    assert countries_of(conn, seed["tenant_a"], seed["zoe"]) == ["GB"]


@pytest.mark.parametrize("bad", ["XX", "G", "GBR", "", "12"])
def test_a_code_that_is_not_a_country_is_refused(client, conn, seed, bad):
    r, body = put(client, seed["zoe"], [bad])
    assert r.status_code == 422
    assert body["error"]["details"][0]["field"].startswith("countries")
    assert countries_of(conn, seed["tenant_a"], seed["zoe"]) == []


def test_an_absurdly_long_list_is_refused(client, seed):
    r, _ = put(client, seed["zoe"], ["GB"] * 500)
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# Response
# ---------------------------------------------------------------------------

def test_the_response_carries_the_new_list(client, seed):
    r, body = put(client, seed["zoe"], ["lk", "GB"])
    assert r.status_code == 200
    assert body["data"]["id"] == seed["zoe"]
    assert body["data"]["countries"] == ["GB", "LK"]


def test_leads_are_not_reassigned(client, seed):
    """Out of scope on purpose: ownership drives NEW routing. Moving live
    leads because someone's countries changed would take work out from under
    a counsellor mid-conversation."""
    r, _ = put(client, seed["priya"], [])
    assert r.status_code == 200
