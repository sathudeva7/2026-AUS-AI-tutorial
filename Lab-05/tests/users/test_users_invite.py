"""POST /api/users/invite — how an agency grows.

Two systems are written in one action: Clerk sends the email, this database
records the roster row. There is no shared transaction, so the tests below are
mostly about what happens when only one of them succeeds.

Clerk is stubbed throughout. A test that sent a real invitation email would be
a test nobody dares run twice.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text


@pytest.fixture
def clerk_stub(monkeypatch):
    """Records what would have been sent, and can be told to fail."""
    import api.users

    calls: list[dict] = []
    state = {"fail": False}

    def fake_invite(org_id, email, role, *, inviter_user_id, redirect_url):
        if state["fail"]:
            import clerk
            raise clerk.ClerkError("clerk 422: duplicate invitation")
        calls.append({
            "org_id": org_id, "email": email, "role": role,
            "inviter_user_id": inviter_user_id, "redirect_url": redirect_url,
        })
        return {"id": f"orginv_{len(calls)}", "status": "pending"}

    monkeypatch.setattr(api.users.clerk, "invite_to_organization", fake_invite)
    return {"calls": calls, "state": state}


def invite(client, email="new.person@a.test", role="counsellor"):
    r = client.post("/api/users/invite", json={"email": email, "role": role})
    return r, r.json()


def row_for(conn, tenant, email):
    return conn.execute(
        text("select name, role, status, clerk_user_id, invited_at from users"
             " where tenant_id = :t and email = :e"),
        {"t": tenant, "e": email},
    ).mappings().one_or_none()


# ---------------------------------------------------------------------------
# Access
# ---------------------------------------------------------------------------

def test_without_a_token_it_refuses(anon_client, clerk_stub):
    r = anon_client.post("/api/users/invite",
                         json={"email": "x@a.test", "role": "counsellor"})
    assert r.status_code == 401
    assert clerk_stub["calls"] == []


def test_a_counsellor_cannot_invite(app, seed, clerk_stub):
    """users.invite is owner-only and not individually grantable — granting it
    piecemeal would make someone an owner by the back door."""
    from fastapi.testclient import TestClient

    from auth import Principal, require_auth

    app.dependency_overrides[require_auth] = lambda: Principal(
        clerk_user_id="ck_zoe", tenant_id=seed["tenant_a"], user_id=seed["zoe"],
        role="counsellor", grants=frozenset(),
    )
    r = TestClient(app, raise_server_exceptions=False).post(
        "/api/users/invite", json={"email": "x@a.test", "role": "counsellor"})
    assert r.status_code == 403
    assert clerk_stub["calls"] == []


# ---------------------------------------------------------------------------
# The happy path
# ---------------------------------------------------------------------------

def test_it_creates_an_invited_row(client, conn, seed, clerk_stub):
    r, body = invite(client)
    assert r.status_code == 201
    assert body["success"] is True
    assert body["data"]["email"] == "new.person@a.test"
    assert body["data"]["status"] == "invited"

    row = row_for(conn, seed["tenant_a"], "new.person@a.test")
    assert row["status"] == "invited"
    # Null until they accept — that is what lets several pending invites
    # coexist under unique (tenant_id, clerk_user_id).
    assert row["clerk_user_id"] is None
    assert row["invited_at"] is not None


def test_clerk_is_told_who_and_where(client, seed, clerk_stub):
    invite(client, role="manager")
    call = clerk_stub["calls"][0]
    assert call["org_id"] == seed["tenant_a"]
    assert call["role"] == "manager"
    assert call["inviter_user_id"] == "ck_priya"
    assert call["redirect_url"].startswith("http://localhost:5173")


@pytest.mark.parametrize("role", ["counsellor", "manager", "owner"])
def test_every_role_is_stored_correctly(client, conn, seed, clerk_stub, role):
    """The bug this replaces: only 'org:admin' was mapped, everything else fell
    through to a default of 'owner' — so every invited counsellor arrived with
    all twelve permissions."""
    email = f"{role}@a.test"
    invite(client, email=email, role=role)
    assert row_for(conn, seed["tenant_a"], email)["role"] == role


# ---------------------------------------------------------------------------
# When only one system succeeds
# ---------------------------------------------------------------------------

def test_a_clerk_failure_leaves_no_ghost_row(client, conn, seed, clerk_stub):
    """Clerk is called FIRST for exactly this reason.

    A row written before a failed Clerk call would show a person on the roster
    who never received an email, and nothing would ever correct it. The other
    order fails safely: an accepted invitation with no row is repaired by
    lazy provisioning on that person's first request.
    """
    clerk_stub["state"]["fail"] = True
    r, body = invite(client)
    assert r.status_code == 502
    assert body["error"]["code"] == "INVITE_NOT_SENT"
    assert row_for(conn, seed["tenant_a"], "new.person@a.test") is None


# ---------------------------------------------------------------------------
# Duplicates
# ---------------------------------------------------------------------------

def test_inviting_an_active_member_is_refused(client, seed, clerk_stub):
    r, body = invite(client, email="anita@a.test")
    assert r.status_code == 409
    assert body["error"]["code"] == "ALREADY_A_MEMBER"
    assert clerk_stub["calls"] == []


def test_inviting_someone_already_invited_is_refused(client, seed, clerk_stub):
    r, body = invite(client, email="new@a.test")
    assert r.status_code == 409
    assert body["error"]["code"] == "ALREADY_INVITED"
    assert clerk_stub["calls"] == []


def test_a_deactivated_person_is_reactivated_not_duplicated(
    client, conn, seed, clerk_stub
):
    """`unique (tenant_id, email)` would refuse a second row anyway, but the
    reason to reuse the first one is that their history hangs off it — every
    lead they worked and every fact they recorded."""
    before = row_for(conn, seed["tenant_a"], "gone@a.test")
    assert before["status"] == "deactivated"

    r, _ = invite(client, email="gone@a.test", role="manager")
    assert r.status_code == 201

    after = row_for(conn, seed["tenant_a"], "gone@a.test")
    assert after["status"] == "invited"
    assert after["role"] == "manager"
    # The same row, not a replacement: their name survives.
    assert after["name"] == "Gone"
    assert len(clerk_stub["calls"]) == 1

    count = conn.execute(
        text("select count(*) from users where tenant_id = :t and email = 'gone@a.test'"),
        {"t": seed["tenant_a"]},
    ).scalar()
    assert count == 1


# ---------------------------------------------------------------------------
# Input
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("email", ["", "not-an-email", "a@", "@a.test", "a b@a.test"])
def test_a_bad_email_is_refused(client, clerk_stub, email):
    r, body = invite(client, email=email)
    assert r.status_code == 422
    assert body["error"]["details"][0]["field"] == "email"
    assert clerk_stub["calls"] == []


def test_an_unknown_role_is_refused(client, clerk_stub):
    r, body = invite(client, role="superadmin")
    assert r.status_code == 422
    assert body["error"]["details"][0]["field"] == "role"
    assert clerk_stub["calls"] == []


def test_email_is_trimmed_and_lowercased(client, conn, seed, clerk_stub):
    """citext already compares case-insensitively; normalising on the way in
    means the stored value matches what Clerk was told."""
    invite(client, email="  Mixed.Case@A.Test  ")
    assert clerk_stub["calls"][0]["email"] == "mixed.case@a.test"
    assert row_for(conn, seed["tenant_a"], "mixed.case@a.test") is not None


# ---------------------------------------------------------------------------
# Tenant isolation
# ---------------------------------------------------------------------------

def test_the_invite_lands_in_the_callers_tenant(client, conn, seed, clerk_stub):
    invite(client)
    other = conn.execute(
        text("select count(*) from users where tenant_id = :t and email = :e"),
        {"t": seed["tenant_b"], "e": "new.person@a.test"},
    ).scalar()
    assert other == 0


def test_an_email_used_by_another_agency_can_still_be_invited(
    client, conn, seed, clerk_stub
):
    """One person may work at two agencies, which is why uniqueness is
    tenant-scoped. Refusing here would lock a real counsellor out of a second
    agency."""
    r, _ = invite(client, email="someone@b.test")
    assert r.status_code == 201
    assert row_for(conn, seed["tenant_a"], "someone@b.test")["status"] == "invited"


# ---------------------------------------------------------------------------
# Accepting the invitation
# ---------------------------------------------------------------------------

def test_accepting_an_invitation_claims_the_existing_row(conn, seed, bound_engine):
    """The second half of an invite, and the half that makes it real.

    Provisioning runs on an invited person's first request. It must CLAIM the
    row the invite created — matching on email, since that is all the two have
    in common until the Clerk id arrives. Inserting a fresh row instead would
    collide with `unique (tenant_id, email)` and leave them unable to sign in
    at all, having accepted an invitation that then went nowhere.
    """
    from repositories import tenants as tenants_repo

    tenants_repo.ensure_with_member(
        seed["tenant_a"], "Agency A",
        clerk_user_id="ck_newly_accepted",
        email="new@a.test",          # the invited row from the seed
        user_name="New Person",
        role="counsellor",
    )

    rows = conn.execute(
        text("select clerk_user_id, status, name, accepted_at from users"
             " where tenant_id = :t and email = 'new@a.test'"),
        {"t": seed["tenant_a"]},
    ).mappings().all()

    assert len(rows) == 1, "the invite row was duplicated instead of claimed"
    assert rows[0]["clerk_user_id"] == "ck_newly_accepted"
    assert rows[0]["status"] == "active"
    assert rows[0]["accepted_at"] is not None
    assert rows[0]["name"] == "New Person"
