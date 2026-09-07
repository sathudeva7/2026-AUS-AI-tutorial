"""GET /api/users — the agency roster.

Any member may read it: a counsellor needs to know who owns Australia before
handing a lead over. What the tests below actually guard is that it never
returns anyone from another agency, that its shape stays stable, and that
paging cannot be used to walk past either of those.
"""

from __future__ import annotations

import pytest


def get(client, **params):
    r = client.get("/api/users", params=params or None)
    return r, r.json()


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------

def test_without_a_token_it_refuses(anon_client):
    r = anon_client.get("/api/users")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "MISSING_BEARER_TOKEN"


def test_with_a_junk_token_it_refuses(anon_client):
    r = anon_client.get("/api/users", headers={"Authorization": "Bearer not.a.jwt"})
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# Tenant isolation
# ---------------------------------------------------------------------------

def test_another_agencys_users_are_never_returned(client, seed):
    """The one failure that would end the product."""
    _, body = get(client, status="all", limit=100)
    emails = {u["email"] for u in body["data"]}
    assert "someone@b.test" not in emails
    assert emails == {"priya@a.test", "anita@a.test", "zoe@a.test",
                      "new@a.test", "gone@a.test"}


def test_tenant_cannot_be_chosen_by_the_caller(client, seed):
    """A tenant id the caller can set is not a scope, it is a suggestion.

    Passing it as a query parameter must change nothing — the value comes from
    the verified token or it does not come at all.
    """
    _, body = get(client, tenant_id=seed["tenant_b"], status="all", limit=100)
    assert "someone@b.test" not in {u["email"] for u in body["data"]}


# ---------------------------------------------------------------------------
# Shape
# ---------------------------------------------------------------------------

def test_the_row_shape_is_stable(client):
    _, body = get(client)
    row = next(u for u in body["data"] if u["email"] == "priya@a.test")
    assert set(row) == {
        "id", "name", "email", "role", "status", "timezone", "work_phone",
        "countries", "invited_at", "accepted_at", "created_at",
    }
    assert row["role"] == "owner"
    assert row["work_phone"] == "+94771234567"


def test_the_clerk_id_is_not_exposed(client):
    """An external identifier the client has no use for, so it is not sent."""
    _, body = get(client, status="all", limit=100)
    assert all("clerk_user_id" not in u for u in body["data"])


def test_countries_come_back_as_a_list(client):
    _, body = get(client)
    by_email = {u["email"]: u for u in body["data"]}
    assert sorted(by_email["priya@a.test"]["countries"]) == ["AU", "GB"]
    assert by_email["anita@a.test"]["countries"] == ["LK"]


def test_a_user_owning_no_country_gets_an_empty_list(client):
    """Not null. A caller that has to handle both is a caller that will not."""
    _, body = get(client)
    zoe = next(u for u in body["data"] if u["email"] == "zoe@a.test")
    assert zoe["countries"] == []


# ---------------------------------------------------------------------------
# Status filtering
# ---------------------------------------------------------------------------

def test_deactivated_users_are_hidden_by_default(client):
    """The roster screen wants colleagues, not history."""
    _, body = get(client)
    assert "gone@a.test" not in {u["email"] for u in body["data"]}


def test_invited_users_are_shown_by_default(client):
    """An owner who invited someone yesterday must see that it happened."""
    _, body = get(client)
    invited = next(u for u in body["data"] if u["email"] == "new@a.test")
    assert invited["status"] == "invited"
    assert invited["name"] is None


def test_status_filter_selects_one_status(client):
    _, body = get(client, status="deactivated")
    assert [u["email"] for u in body["data"]] == ["gone@a.test"]


def test_status_all_includes_everyone(client):
    _, body = get(client, status="all", limit=100)
    assert len(body["data"]) == 5


def test_an_unknown_status_is_refused(client):
    r, body = get(client, status="retired")
    assert r.status_code == 422
    assert body["error"]["details"][0]["field"] == "status"


# ---------------------------------------------------------------------------
# Ordering
# ---------------------------------------------------------------------------

def test_sorted_by_name_with_the_nameless_last(client):
    """An invited user has no name yet. Sorting nulls first would put whoever
    was invited most recently at the top of the roster, above everyone who
    actually works there."""
    _, body = get(client)
    assert [u["name"] for u in body["data"]] == ["Anita", "Priya", "Zoe", None]


# ---------------------------------------------------------------------------
# Pagination
# ---------------------------------------------------------------------------

def test_meta_reports_the_full_count_not_the_page_size(client):
    """`total` is what the caller needs to render "1-2 of 4"; if it counted the
    page it would always equal len(data) and tell them nothing."""
    _, body = get(client, limit=2)
    assert len(body["data"]) == 2
    assert body["meta"] == {"limit": 2, "offset": 0, "total": 4}


def test_offset_moves_the_window(client):
    _, first = get(client, limit=2, offset=0)
    _, second = get(client, limit=2, offset=2)
    assert [u["name"] for u in first["data"]] == ["Anita", "Priya"]
    assert [u["name"] for u in second["data"]] == ["Zoe", None]


def test_paging_past_the_end_is_empty_and_still_counts(client):
    _, body = get(client, limit=2, offset=99)
    assert body["data"] == []
    assert body["meta"]["total"] == 4


def test_a_page_bigger_than_the_maximum_is_refused(client):
    """Refused, not silently clamped: a caller asking for 5000 rows and
    receiving 100 has been given a wrong answer without being told."""
    r, body = get(client, limit=5000)
    assert r.status_code == 422
    assert body["error"]["details"][0]["field"] == "limit"


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": -1}, {"offset": -1}])
def test_nonsense_paging_is_refused(client, params):
    r, _ = get(client, **params)
    assert r.status_code == 422


def test_the_default_page_size_is_applied(client):
    _, body = get(client)
    assert body["meta"]["limit"] == 25
    assert body["meta"]["offset"] == 0


# ---------------------------------------------------------------------------
# Envelope
# ---------------------------------------------------------------------------

def test_the_response_is_enveloped(client):
    r, body = get(client)
    assert body["success"] is True
    assert isinstance(body["data"], list)
    assert body["request_id"].startswith("req_")
    assert r.headers["x-request-id"] == body["request_id"]


# ---------------------------------------------------------------------------
# Access
# ---------------------------------------------------------------------------

def test_a_counsellor_may_read_the_roster(app, seed):
    """Not owner-only. A counsellor who cannot see who owns Australia cannot
    hand a lead to them."""
    from fastapi.testclient import TestClient

    from auth import Principal, require_auth

    app.dependency_overrides[require_auth] = lambda: Principal(
        clerk_user_id="ck_zoe", tenant_id=seed["tenant_a"], user_id=seed["zoe"],
        role="counsellor", grants=frozenset(),
    )
    r = TestClient(app, raise_server_exceptions=False).get("/api/users")
    assert r.status_code == 200
