"""PATCH /api/users/{id} — name, work phone, timezone.

The one endpoint so far that is not a plain permission gate: `users.edit`
covers editing OTHER people, but everyone may edit their own row. Timezone is
why. Availability is stored as wall clock and read against `users.timezone`,
so a counsellor who cannot set their own has their hours interpreted in the
wrong zone — and nobody finds out until a student is offered a 3am call.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text


def patch(client, user_id, body):
    r = client.patch(f"/api/users/{user_id}", json=body)
    return r, r.json()


def stored(conn, user_id):
    return conn.execute(
        text("select name, work_phone, timezone, email, role, status"
             " from users where id = :u"),
        {"u": user_id},
    ).mappings().one()


def signed_in_as(app, seed, role, user_key):
    from fastapi.testclient import TestClient

    from auth import Principal, require_auth

    app.dependency_overrides[require_auth] = lambda: Principal(
        clerk_user_id="ck_x", tenant_id=seed["tenant_a"], user_id=seed[user_key],
        role=role, grants=frozenset(),
    )
    return TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# Who may edit whom
# ---------------------------------------------------------------------------

def test_without_a_token_it_refuses(anon_client, seed):
    r = anon_client.patch(f"/api/users/{seed['zoe']}", json={"name": "Z"})
    assert r.status_code == 401


def test_a_counsellor_cannot_edit_someone_else(app, conn, seed):
    r = signed_in_as(app, seed, "counsellor", "zoe").patch(
        f"/api/users/{seed['anita']}", json={"name": "Hacked"})
    assert r.status_code == 403
    assert stored(conn, seed["anita"])["name"] == "Anita"


def test_a_counsellor_may_edit_themselves(app, conn, seed):
    """The reason this endpoint checks self-or-permission rather than
    permission alone."""
    r = signed_in_as(app, seed, "counsellor", "zoe").patch(
        f"/api/users/{seed['zoe']}", json={"timezone": "Asia/Colombo"})
    assert r.status_code == 200
    assert stored(conn, seed["zoe"])["timezone"] == "Asia/Colombo"


def test_a_manager_may_edit_anyone(app, conn, seed):
    r = signed_in_as(app, seed, "manager", "anita").patch(
        f"/api/users/{seed['zoe']}", json={"name": "Zoe B"})
    assert r.status_code == 200
    assert stored(conn, seed["zoe"])["name"] == "Zoe B"


def test_an_owner_may_edit_anyone(client, conn, seed):
    r, _ = patch(client, seed["zoe"], {"name": "Zoe C"})
    assert r.status_code == 200
    assert stored(conn, seed["zoe"])["name"] == "Zoe C"


# ---------------------------------------------------------------------------
# Tenant isolation
# ---------------------------------------------------------------------------

def test_another_agencys_user_is_not_found(client, conn, seed):
    r, body = patch(client, seed["other"], {"name": "Hacked"})
    assert r.status_code == 404
    assert body["error"]["code"] == "USER_NOT_FOUND"
    assert stored(conn, seed["other"])["name"] == "Someone Else"


def test_an_unknown_id_is_not_found(client):
    r, _ = patch(client, "00000000-0000-0000-0000-000000000000", {"name": "X"})
    assert r.status_code == 404


def test_a_malformed_id_is_refused(client):
    r, body = patch(client, "not-a-uuid", {"name": "X"})
    assert r.status_code == 422
    assert body["error"]["details"][0]["field"] == "user_id"


# ---------------------------------------------------------------------------
# Partial update
# ---------------------------------------------------------------------------

def test_fields_not_sent_are_left_alone(client, conn, seed):
    """A form rendering half the record must not blank the other half by
    omission — which is the whole reason for exclude_unset."""
    patch(client, seed["priya"], {"name": "Priya F"})
    row = stored(conn, seed["priya"])
    assert row["name"] == "Priya F"
    assert row["work_phone"] == "+94771234567"   # untouched
    assert row["timezone"] == "UTC"              # untouched


def test_an_explicit_null_clears_the_phone(client, conn, seed):
    """`null` sent is different from a field omitted. exclude_unset can tell
    them apart; exclude_none could not, and then nobody could ever delete a
    phone number."""
    patch(client, seed["priya"], {"work_phone": None})
    assert stored(conn, seed["priya"])["work_phone"] is None


def test_an_empty_body_changes_nothing(client, conn, seed):
    before = dict(stored(conn, seed["priya"]))
    r, _ = patch(client, seed["priya"], {})
    assert r.status_code == 200
    assert dict(stored(conn, seed["priya"])) == before


def test_a_blank_name_becomes_null(client, conn, seed):
    """A cleared form field arrives as "" and means "no value"."""
    patch(client, seed["priya"], {"name": "   "})
    assert stored(conn, seed["priya"])["name"] is None


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def test_a_number_that_is_not_real_is_refused(client, conn, seed):
    """+947424059777 passes an E.164 regex and is one digit too long for Sri
    Lanka. libphonenumber knows the difference."""
    r, body = patch(client, seed["priya"], {"work_phone": "+947424059777"})
    assert r.status_code == 422
    assert body["error"]["details"][0]["field"] == "work_phone"
    assert stored(conn, seed["priya"])["work_phone"] == "+94771234567"


def test_a_phone_is_normalised_to_e164(client, conn, seed):
    patch(client, seed["priya"], {"work_phone": "+94 77 123 4567"})
    assert stored(conn, seed["priya"])["work_phone"] == "+94771234567"


def test_an_unknown_timezone_is_refused(client, seed):
    """An unknown zone does not fail loudly — it renders every time on every
    screen wrong, which is far harder to notice."""
    r, body = patch(client, seed["priya"], {"timezone": "Mars/Olympus"})
    assert r.status_code == 422
    assert body["error"]["details"][0]["field"] == "timezone"


def test_the_timezone_cannot_be_cleared(client, seed):
    """The column is NOT NULL and defaults to UTC. There is no such thing as
    a user with no zone, so null is a mistake rather than a clear."""
    r, body = patch(client, seed["priya"], {"timezone": None})
    assert r.status_code == 422
    assert body["error"]["details"][0]["field"] == "timezone"


# ---------------------------------------------------------------------------
# Fields this endpoint does not own
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "body",
    [{"role": "owner"}, {"email": "new@a.test"}, {"status": "active"},
     {"clerk_user_id": "ck_hacked"}, {"tenant_id": "tst_B"}],
)
def test_a_field_this_endpoint_does_not_own_is_refused(client, conn, seed, body):
    """Refused, not ignored.

    Pydantic drops unknown keys by default, which would answer 200 to
    {"role": "owner"} and let the caller believe it worked. For a privilege
    field that silence is the dangerous option — Clerk owns role, identity
    owns email, and deactivation has its own endpoint.
    """
    r, out = patch(client, seed["zoe"], body)
    assert r.status_code == 422
    assert out["error"]["details"][0]["field"] in body
    row = stored(conn, seed["zoe"])
    assert row["role"] == "counsellor" and row["email"] == "zoe@a.test"


# ---------------------------------------------------------------------------
# Response
# ---------------------------------------------------------------------------

def test_the_response_carries_the_updated_row(client, seed):
    r, body = patch(client, seed["priya"],
                    {"name": "Priya F", "timezone": "Asia/Colombo"})
    assert r.status_code == 200
    assert body["data"]["id"] == seed["priya"]
    assert body["data"]["name"] == "Priya F"
    assert body["data"]["timezone"] == "Asia/Colombo"
    # Countries come back too — it is the same shape the roster returns, so a
    # client can drop it straight into the list it already has.
    assert sorted(body["data"]["countries"]) == ["AU", "GB"]


def test_an_invited_user_can_be_edited(client, conn, seed):
    """They have no name yet, and an owner filling one in before the person
    accepts is the ordinary case."""
    r, _ = patch(client, seed["invited"], {"name": "Expected Name"})
    assert r.status_code == 200
    assert stored(conn, seed["invited"])["name"] == "Expected Name"
