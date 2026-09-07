"""What the schema promises, proved against a real Postgres.

These are not tests that Postgres works. Every one of them checks a rule this
project deliberately built, and each would pass silently if a later migration
dropped the constraint behind it — which is exactly the failure they exist to
catch. A migration that recreates `users` and forgets the composite foreign
key breaks tenant isolation without breaking a single page.

Most assert a FAILURE. That is characteristic of schema testing: the value is
in what the database refuses.
"""

from __future__ import annotations

import pytest
from psycopg import errors


# ---------------------------------------------------------------------------
# Tenant isolation
# ---------------------------------------------------------------------------

def test_cross_tenant_reference_is_rejected(cur, seed):
    """A child row cannot claim one tenant while pointing at another's user.

    This is the whole reason children reference `(tenant_id, id)` rather than
    `id` alone. Without it, tenant separation rests entirely on application
    code remembering to filter.
    """
    s = seed()
    with pytest.raises(errors.ForeignKeyViolation):
        cur.execute(
            "insert into user_countries (tenant_id, user_id, country)"
            " values ('org_B', %s, 'LK')",
            (s["user_a"],),
        )


def test_same_email_allowed_in_two_tenants(cur, seed):
    """One person may work at two agencies, so uniqueness is tenant-scoped.

    A global `unique(email)` would look correct until the day it locked a real
    counsellor out of a second agency.
    """
    seed()
    cur.execute(
        "insert into users (tenant_id, clerk_user_id, email, role)"
        " values ('org_B', 'user_clerk_b', 'priya@agency-a.test', 'counsellor')"
    )


def test_duplicate_email_within_a_tenant_is_rejected(cur, seed):
    s = seed()
    with pytest.raises(errors.UniqueViolation):
        cur.execute(
            "insert into users (tenant_id, clerk_user_id, email, role)"
            " values ('org_A', 'user_clerk_dup', 'priya@agency-a.test', 'counsellor')",
        )


# ---------------------------------------------------------------------------
# Access model
# ---------------------------------------------------------------------------

def test_owner_only_permission_cannot_be_granted_to_a_user(cur, seed):
    """Owner-only keys are not individually grantable.

    Since 002 this is a CHECK that simply does not list them, rather than the
    composite foreign key 001 used. Granting `users.invite` piecemeal would
    make someone an owner by the back door.
    """
    s = seed()
    with pytest.raises(errors.CheckViolation):
        cur.execute(
            "insert into user_permissions (tenant_id, user_id, permission_key)"
            " values ('org_A', %s, 'users.invite')",
            (s["user_a"],),
        )


def test_normal_permission_can_be_granted_to_a_user(cur, seed):
    """The counsellor-who-also-edits-the-catalogue case must still work.

    Without this, the test above would pass just as well if grants were broken
    outright.
    """
    s = seed()
    cur.execute(
        "insert into user_permissions (tenant_id, user_id, permission_key)"
        " values ('org_A', %s, 'catalogue.write')",
        (s["user_a"],),
    )


def test_invented_permission_key_is_rejected(cur, seed):
    """A key nothing checks is a setting that silently does nothing."""
    s = seed()
    with pytest.raises(errors.CheckViolation):
        cur.execute(
            "insert into user_permissions (tenant_id, user_id, permission_key)"
            " values ('org_A', %s, 'leads.delete.everything')",
            (s["user_a"],),
        )


def test_role_must_be_one_of_the_three(cur, seed):
    """`role` is an enum in all but name — CHECKed, not free text."""
    seed()
    with pytest.raises(errors.CheckViolation):
        cur.execute(
            "insert into users (tenant_id, clerk_user_id, email, role)"
            " values ('org_A', 'user_clerk_x', 'x@agency-a.test', 'superadmin')"
        )


# ---------------------------------------------------------------------------
# The invite lifecycle
# ---------------------------------------------------------------------------

def test_active_user_must_be_linked_to_clerk(cur, seed):
    """An active user with no Clerk id could never sign in; that row is a bug."""
    s = seed()
    with pytest.raises(errors.CheckViolation):
        cur.execute(
            "insert into users (tenant_id, email, status)"
            " values ('org_A', 'ghost@agency-a.test', 'active')",
        )


def test_multiple_pending_invites_coexist(cur, seed):
    """`clerk_user_id` is null until an invite is accepted.

    Postgres allows many NULLs under a unique constraint, which is what lets
    an owner invite several counsellors at once and assign their countries
    before anyone accepts.
    """
    s = seed()
    cur.execute(
        "insert into users (tenant_id, email)"
        " values ('org_A', 'invitee1@agency-a.test')",
    )
    cur.execute(
        "insert into users (tenant_id, email)"
        " values ('org_A', 'invitee2@agency-a.test')",
    )


# ---------------------------------------------------------------------------
# Field-level rules
# ---------------------------------------------------------------------------

def test_non_e164_phone_is_rejected(cur, seed):
    """Without a stored format you cannot compare or dial the numbers later."""
    s = seed()
    with pytest.raises(errors.CheckViolation):
        cur.execute(
            "insert into users (tenant_id, clerk_user_id, email, work_phone)"
            " values ('org_A', 'user_clerk_ph', 'phone@agency-a.test',"
            " '0771234567')",
        )


def test_e164_phone_is_accepted(cur, seed):
    s = seed()
    cur.execute(
        "insert into users (tenant_id, clerk_user_id, email, work_phone)"
        " values ('org_A', 'user_clerk_ok', 'ok@agency-a.test', '+94771234567')",
    )


def test_availability_must_end_after_it_starts(cur, seed):
    s = seed()
    with pytest.raises(errors.CheckViolation):
        cur.execute(
            "insert into availability_rules"
            " (tenant_id, user_id, day_of_week, start_time, end_time)"
            " values ('org_A', %s, 1, '17:00', '09:00')",
            (s["user_a"],),
        )


def test_day_of_week_must_be_in_range(cur, seed):
    s = seed()
    with pytest.raises(errors.CheckViolation):
        cur.execute(
            "insert into availability_rules"
            " (tenant_id, user_id, day_of_week, start_time, end_time)"
            " values ('org_A', %s, 7, '09:00', '17:00')",
            (s["user_a"],),
        )


# ---------------------------------------------------------------------------
# Seed data the application depends on
# ---------------------------------------------------------------------------

def test_code_map_matches_the_database_check():
    """The grantable set in permissions.py must match the CHECK in 002.

    They are two statements of the same rule. If they drift, an owner-only key
    becomes grantable in code and is refused by the database at runtime — or
    worse, the other way round.
    """
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "student_agent"))
    from permissions import GRANTABLE

    assert GRANTABLE == {
        "leads.read.owned",
        "leads.read.all",
        "leads.write",
        "leads.assign",
        "catalogue.read",
        "catalogue.flag",
        "catalogue.write",
        "catalogue.verify",
        "users.edit",
    }
