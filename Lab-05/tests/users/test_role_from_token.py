"""Clerk owns roles, so the token decides — not our column.

`users.role` is a cache, in the same sense `tenants.name` is: useful for the
roster, for the widget and for the worker, none of which hold a session token.
It is never the authority on what someone may do.

These call `auth._load` directly. Going through `require_auth` would mean
minting signed Clerk tokens, which tests what PyJWT does rather than what this
decision does.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text


@pytest.fixture
def load(bound_engine):
    from auth import _load

    return _load


def db_role(conn, tenant, email):
    return conn.execute(
        text("select role from users where tenant_id = :t and email = :e"),
        {"t": tenant, "e": email},
    ).scalar_one()


def test_the_token_wins_over_the_stored_row(load, conn, seed):
    """The bug this closes.

    Anita's row says 'manager'. If Clerk has since demoted her, the row is
    simply out of date, and honouring it would grant permissions Clerk has
    already taken away.
    """
    assert db_role(conn, seed["tenant_a"], "anita@a.test") == "manager"

    principal = load(seed["tenant_a"], f"ck_a_{seed['tenant_a'].split('_')[-1]}",
                     "counsellor")
    assert principal is not None
    assert principal.role == "counsellor"


def test_a_stale_row_heals_itself(load, conn, seed):
    """No migration for the rows the old seeding bug wrote as 'owner'. The
    next request from that person corrects their row."""
    tag = seed["tenant_a"].split("_")[-1]
    load(seed["tenant_a"], f"ck_a_{tag}", "counsellor")
    assert db_role(conn, seed["tenant_a"], "anita@a.test") == "counsellor"


def test_an_unchanged_role_is_left_alone(load, conn, seed):
    tag = seed["tenant_a"].split("_")[-1]
    p = load(seed["tenant_a"], f"ck_p_{tag}", "owner")
    assert p.role == "owner"
    assert db_role(conn, seed["tenant_a"], "priya@a.test") == "owner"


def test_grants_still_come_from_our_database(load, conn, seed):
    """Clerk owns the ROLE. It knows nothing about individual grants, which are
    ours, so those still come from user_permissions."""
    conn.execute(
        text("insert into user_permissions (tenant_id, user_id, permission_key)"
             " values (:t, :u, 'catalogue.write')"),
        {"t": seed["tenant_a"], "u": seed["zoe"]},
    )
    tag = seed["tenant_a"].split("_")[-1]
    p = load(seed["tenant_a"], f"ck_z_{tag}", "counsellor")
    assert p.grants == {"catalogue.write"}


def test_an_unknown_clerk_role_is_not_trusted_upward():
    """A role we do not recognise must become the LEAST privileged of ours.

    The reverse — defaulting to 'owner' — is exactly the bug that made every
    invited counsellor an owner, and it failed silently for weeks.
    """
    import clerk

    assert clerk.ROLE_FROM_CLERK.get("org:something_new", clerk.DEFAULT_ROLE) == "counsellor"
    assert clerk.DEFAULT_ROLE == "counsellor"


@pytest.mark.parametrize(
    "clerk_role,expected",
    [("org:admin", "owner"), ("org:manager", "manager"), ("org:member", "counsellor"),
     ("admin", "owner"), ("manager", "manager"), ("member", "counsellor")],
)
def test_every_clerk_role_maps(clerk_role, expected):
    """Both spellings: Clerk has sent bare and prefixed forms across versions,
    and the token that caused the 403 carried `"rol": "member"`."""
    import clerk

    assert clerk.ROLE_FROM_CLERK[clerk_role] == expected


def test_someone_not_provisioned_yet_is_none(load, seed):
    assert load(seed["tenant_a"], "ck_never_seen", "owner") is None
