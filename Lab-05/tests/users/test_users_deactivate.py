"""POST /api/users/{id}/deactivate — switching someone off.

Deactivation is not an edit, which is why it is a POST of its own and not a
field on PATCH. Three things happen together or not at all: the row stops being
active, their open leads fall back to the unassigned queue, and the agency is
checked for still having an owner afterwards.

The last of those is why this runs in one transaction. Two owners deactivating
each other at the same instant would both count two owners, both proceed, and
leave an agency nobody can administer — a state only a database console can
undo, because every key that could fix it is owner-only.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text


def url(user_id):
    return f"/api/users/{user_id}/deactivate"


def status_of(conn, user_id):
    return conn.execute(
        text("select status from users where id = :u"), {"u": user_id}
    ).scalar_one()


def assignee_of(conn, lead_id):
    return conn.execute(
        text("select assigned_user_id from leads where id = :l"), {"l": lead_id}
    ).scalar_one()


def add_user(conn, tenant, email, *, role="counsellor", status="active", tag="x"):
    return str(conn.execute(
        text("insert into users (tenant_id, clerk_user_id, email, name, role, status)"
             " values (:t, :c, :e, :n, :r, :s) returning id"),
        {"t": tenant, "c": None if status == "invited" else f"ck_{tag}_{email}",
         "e": email, "n": email.split("@")[0], "r": role, "s": status},
    ).scalar())


def add_lead(conn, tenant, *, assigned_to=None, status="active", email=None):
    return str(conn.execute(
        text("insert into leads (tenant_id, email, status, assigned_user_id,"
             " assigned_at, assignment_reason)"
             " values (:t, :e, :s, :u, now(), 'country_owner') returning id"),
        {"t": tenant, "e": email or f"lead_{status}_{assigned_to}@x.test",
         "s": status, "u": assigned_to},
    ).scalar())


def signed_in_as(app, seed, role, user_id):
    from fastapi.testclient import TestClient

    from auth import Principal, require_auth

    app.dependency_overrides[require_auth] = lambda: Principal(
        clerk_user_id="ck_x", tenant_id=seed["tenant_a"], user_id=user_id,
        role=role, grants=frozenset(),
    )
    return TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# Who may switch someone off
# ---------------------------------------------------------------------------

def test_without_a_token_it_refuses(anon_client, seed):
    assert anon_client.post(url(seed["zoe"])).status_code == 401


def test_a_counsellor_cannot(app, conn, seed):
    r = signed_in_as(app, seed, "counsellor", seed["zoe"]).post(url(seed["anita"]))
    assert r.status_code == 403
    assert status_of(conn, seed["anita"]) == "active"


def test_a_manager_cannot(app, conn, seed):
    """Owner-only, mirroring users.invite.

    A manager who can switch off the people they cannot hire is a manager who
    can lock out a rival, and the asymmetry has no reading that makes sense.
    """
    r = signed_in_as(app, seed, "manager", seed["anita"]).post(url(seed["zoe"]))
    assert r.status_code == 403
    assert r.json()["error"]["details"][0]["issue"] == "users.deactivate"
    assert status_of(conn, seed["zoe"]) == "active"


def test_the_permission_cannot_be_granted_to_one_person(app, conn, seed):
    """Non-grantable, so holding the grant changes nothing.

    A key that switches off other people is a promotion however it arrives.
    The database says the same thing: it is absent from the user_permissions
    CHECK, so the row cannot even be written.
    """
    from fastapi.testclient import TestClient

    from auth import Principal, require_auth

    app.dependency_overrides[require_auth] = lambda: Principal(
        clerk_user_id="ck_x", tenant_id=seed["tenant_a"], user_id=seed["anita"],
        role="manager", grants=frozenset({"users.deactivate"}),
    )
    r = TestClient(app, raise_server_exceptions=False).post(url(seed["zoe"]))
    assert r.status_code == 403
    assert status_of(conn, seed["zoe"]) == "active"


def test_an_owner_can(client, conn, seed):
    r = client.post(url(seed["zoe"]))
    assert r.status_code == 200
    assert status_of(conn, seed["zoe"]) == "deactivated"
    assert r.json()["data"]["status"] == "deactivated"


# ---------------------------------------------------------------------------
# The target
# ---------------------------------------------------------------------------

def test_another_agencys_user_is_not_found(client, conn, seed):
    r = client.post(url(seed["other"]))
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "USER_NOT_FOUND"
    assert status_of(conn, seed["other"]) == "active"


def test_an_unknown_id_is_not_found(client):
    assert client.post(url("00000000-0000-0000-0000-000000000000")).status_code == 404


def test_a_malformed_id_is_refused(client):
    r = client.post(url("not-a-uuid"))
    assert r.status_code == 422
    assert r.json()["error"]["details"][0]["field"] == "user_id"


def test_deactivating_twice_is_not_an_error(client, conn, seed):
    """The state the caller asked for already holds. A 409 here would make a
    double-click look like a failure and tell them nothing they can act on."""
    client.post(url(seed["zoe"]))
    r = client.post(url(seed["zoe"]))
    assert r.status_code == 200
    assert r.json()["meta"]["leads_unassigned"] == 0
    assert status_of(conn, seed["zoe"]) == "deactivated"


def test_deactivating_an_invited_person_revokes_the_invitation(client, conn, seed):
    """Same endpoint, no separate revoke. The row has no clerk_user_id yet,
    which is exactly what makes the auth-path fix below load-bearing."""
    r = client.post(url(seed["invited"]))
    assert r.status_code == 200
    assert status_of(conn, seed["invited"]) == "deactivated"


# ---------------------------------------------------------------------------
# Self
# ---------------------------------------------------------------------------

def test_an_owner_cannot_deactivate_themselves(app, conn, seed):
    """Refused even with another owner present, so this is never the last-owner
    rule in disguise. Switching yourself off from inside the product has no
    good reason behind it and every sign of a misclick on the wrong row."""
    add_user(conn, seed["tenant_a"], "owner2@a.test", role="owner", tag="o2")
    r = signed_in_as(app, seed, "owner", seed["priya"]).post(url(seed["priya"]))
    assert r.status_code == 422
    assert r.json()["error"]["details"][0]["field"] == "user_id"
    assert status_of(conn, seed["priya"]) == "active"


# ---------------------------------------------------------------------------
# The last owner
#
# Unreachable over HTTP as the rules currently stand: only an owner holds
# users.deactivate, and an owner deactivating a DIFFERENT owner proves a second
# one exists. Self-deactivation, the one route to it, is refused above. The
# guard is tested where it lives, because the endpoint that makes it reachable
# — demoting an owner to manager — is the next one anybody writes.
# ---------------------------------------------------------------------------

def test_the_last_active_owner_cannot_be_deactivated(bound_engine, conn, seed):
    from repositories import users as users_repo

    assert users_repo.deactivate(seed["tenant_a"], seed["priya"]) is None
    assert status_of(conn, seed["priya"]) == "active"


def test_an_invited_owner_does_not_count_as_cover(bound_engine, conn, seed):
    """The trap. A second owner exists on the roster, so a naive count of
    role='owner' says the agency is safe — but they have never signed in, and
    an invitation cannot accept itself. Deactivating the only ACTIVE owner
    leaves nobody able to invite, because users.invite is owner-only too."""
    add_user(conn, seed["tenant_a"], "owner2@a.test", role="owner",
             status="invited", tag="o2")
    from repositories import users as users_repo

    assert users_repo.deactivate(seed["tenant_a"], seed["priya"]) is None


def test_a_deactivated_owner_does_not_count_as_cover(bound_engine, conn, seed):
    add_user(conn, seed["tenant_a"], "owner2@a.test", role="owner",
             status="deactivated", tag="o2")
    from repositories import users as users_repo

    assert users_repo.deactivate(seed["tenant_a"], seed["priya"]) is None


def test_with_a_second_active_owner_it_goes_through(bound_engine, conn, seed):
    add_user(conn, seed["tenant_a"], "owner2@a.test", role="owner", tag="o2")
    from repositories import users as users_repo

    assert users_repo.deactivate(seed["tenant_a"], seed["priya"]) == 0
    assert status_of(conn, seed["priya"]) == "deactivated"


def test_another_agencys_owners_are_no_cover(bound_engine, conn, seed):
    """Agency B having six owners does not make it safe to switch off A's
    only one. The count is scoped like every other query here."""
    add_user(conn, seed["tenant_b"], "owner_b@b.test", role="owner", tag="ob")
    from repositories import users as users_repo

    assert users_repo.deactivate(seed["tenant_a"], seed["priya"]) is None


# ---------------------------------------------------------------------------
# Their leads
# ---------------------------------------------------------------------------

def test_open_leads_fall_back_to_the_unassigned_queue(client, conn, seed):
    """The queue is visible to everyone by design, so this keeps the work
    reachable. Leaving them assigned would hide them behind an account nobody
    can sign into — the exact failure escalation exists to prevent."""
    a = add_lead(conn, seed["tenant_a"], assigned_to=seed["zoe"], status="active")
    b = add_lead(conn, seed["tenant_a"], assigned_to=seed["zoe"], status="parked")
    r = client.post(url(seed["zoe"]))
    assert r.json()["meta"]["leads_unassigned"] == 2
    assert assignee_of(conn, a) is None
    assert assignee_of(conn, b) is None


@pytest.mark.parametrize("finished", ["converted", "withdrawn"])
def test_a_finished_lead_keeps_its_counsellor(client, conn, seed, finished):
    """History, not workload. Nulling the assignee on a converted lead throws
    away the answer to "who closed this?", and there is nothing to hand on."""
    lead = add_lead(conn, seed["tenant_a"], assigned_to=seed["zoe"], status=finished)
    r = client.post(url(seed["zoe"]))
    assert r.json()["meta"]["leads_unassigned"] == 0
    assert str(assignee_of(conn, lead)) == seed["zoe"]


def test_someone_elses_leads_are_untouched(client, conn, seed):
    mine = add_lead(conn, seed["tenant_a"], assigned_to=seed["zoe"])
    theirs = add_lead(conn, seed["tenant_a"], assigned_to=seed["anita"])
    client.post(url(seed["zoe"]))
    assert assignee_of(conn, mine) is None
    assert str(assignee_of(conn, theirs)) == seed["anita"]


def test_another_agencys_leads_are_untouched(client, conn, seed):
    theirs = add_lead(conn, seed["tenant_b"], assigned_to=seed["other"])
    client.post(url(seed["zoe"]))
    assert str(assignee_of(conn, theirs)) == seed["other"]


def test_the_assignment_history_is_left_readable(client, conn, seed):
    """assigned_at and assignment_reason stay. 003 says as much: a stale
    assigned_at on an unassigned lead reads as history, and it is the only
    record of where the lead had been."""
    lead = add_lead(conn, seed["tenant_a"], assigned_to=seed["zoe"])
    client.post(url(seed["zoe"]))
    row = conn.execute(
        text("select assigned_at, assignment_reason from leads where id = :l"),
        {"l": lead},
    ).mappings().one()
    assert row["assigned_at"] is not None
    assert row["assignment_reason"] == "country_owner"


# ---------------------------------------------------------------------------
# Afterwards
# ---------------------------------------------------------------------------

def test_they_are_refused_at_the_door_not_crashed_on(app, conn, seed, monkeypatch):
    """Before this endpoint existed, a deactivated user's token fell through
    the active-only lookup into _provision, which could claim nothing and left
    the request as a 500 — after two live Clerk calls per attempt. Locked out
    by accident, expensively, and reported as our fault rather than theirs.
    """
    from fastapi.testclient import TestClient

    import auth

    ck = conn.execute(text("select clerk_user_id from users where id = :u"),
                      {"u": seed["zoe"]}).scalar_one()
    conn.execute(text("update users set status = 'deactivated' where id = :u"),
                 {"u": seed["zoe"]})
    monkeypatch.setattr(
        auth, "verify_token",
        lambda token: {"sub": ck, "org_id": seed["tenant_a"],
                       "org_role": "org:member"},
    )
    monkeypatch.setattr(
        auth, "_provision",
        lambda claims: pytest.fail("a deactivated user must not reach provisioning"),
    )
    r = TestClient(app, raise_server_exceptions=False).get(
        "/api/users", headers={"Authorization": "Bearer t"})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "ACCOUNT_DEACTIVATED"


def test_a_revoked_invitation_cannot_claim_itself_back(bound_engine, conn, seed):
    """The hole this endpoint would otherwise open.

    A revoked invite still has clerk_user_id null, and the claim-on-first-
    contact UPDATE matched on exactly that. Signing in would have set the row
    active again and walked the person straight back into the agency.
    """
    from repositories import tenants as tenants_repo

    conn.execute(text("update users set status = 'deactivated' where id = :u"),
                 {"u": seed["invited"]})
    tenants_repo.ensure_with_member(
        seed["tenant_a"], "Agency A", clerk_user_id="ck_sneaky",
        email="new@a.test", user_name="New", role="owner",
    )
    assert status_of(conn, seed["invited"]) == "deactivated"


def test_re_inviting_brings_them_back_with_the_same_row(client, bound_engine, conn, seed):
    """Reactivation is the invite path, not an endpoint of its own. The id
    survives, so every lead and fact hanging off it survives with it."""
    lead = add_lead(conn, seed["tenant_a"], assigned_to=seed["zoe"])
    client.post(url(seed["zoe"]))
    from repositories import users as users_repo

    # Same row, revived — not a new one. Every lead and fact hangs off this id.
    assert str(users_repo.invite(seed["tenant_a"], "zoe@a.test", "counsellor")) \
        == seed["zoe"]
    assert status_of(conn, seed["zoe"]) == "invited"
    # The lead stays in the queue: coming back does not silently re-claim work
    # somebody else may have picked up in the meantime.
    assert assignee_of(conn, lead) is None


def test_their_hours_survive(client, conn, seed):
    """availability_rules is untouched. Somebody on extended leave who returns
    should not have to redraw their week."""
    conn.execute(
        text("insert into availability_rules"
             " (tenant_id, user_id, day_of_week, start_time, end_time)"
             " values (:t, :u, 1, '09:00', '17:00')"),
        {"t": seed["tenant_a"], "u": seed["zoe"]},
    )
    client.post(url(seed["zoe"]))
    assert conn.execute(
        text("select count(*) from availability_rules where user_id = :u"),
        {"u": seed["zoe"]},
    ).scalar() == 1


def test_they_leave_the_default_roster_but_are_still_findable(client, seed):
    """Deactivated people are out of the default list and present under
    ?status=all — a roster that forgets them cannot show who worked a lead."""
    client.post(url(seed["zoe"]))
    ids = [u["id"] for u in client.get("/api/users").json()["data"]]
    assert seed["zoe"] not in ids
    all_ids = [u["id"] for u in client.get("/api/users?status=all").json()["data"]]
    assert seed["zoe"] in all_ids
