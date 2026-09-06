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
    s = seed()
    cur.execute(
        "insert into users (tenant_id, clerk_user_id, email, role_id)"
        " values ('org_B', 'user_clerk_b', 'priya@agency-a.test', %s)",
        (s["role_b"],),
    )


def test_duplicate_email_within_a_tenant_is_rejected(cur, seed):
    s = seed()
    with pytest.raises(errors.UniqueViolation):
        cur.execute(
            "insert into users (tenant_id, clerk_user_id, email, role_id)"
            " values ('org_A', 'user_clerk_dup', 'priya@agency-a.test', %s)",
            (s["role_a"],),
        )


# ---------------------------------------------------------------------------
# Access model
# ---------------------------------------------------------------------------

def test_owner_only_permission_cannot_be_granted_to_a_user(cur, seed):
    """Owner-only keys are not individually grantable.

    Enforced by pinning `is_owner_only = false` on user_permissions and
    referencing `permissions(key, is_owner_only)` — an owner-only permission
    has no row matching (key, false), so there is nothing to point at. A plain
    CHECK could not do this; it cannot read another table.
    """
    s = seed()
    with pytest.raises(errors.ForeignKeyViolation):
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


def test_role_in_use_cannot_be_deleted(cur, seed):
    """ON DELETE RESTRICT. Deleting a held role would orphan its holders."""
    s = seed()
    with pytest.raises(errors.ForeignKeyViolation):
        cur.execute("delete from roles where id = %s", (s["role_a"],))


# ---------------------------------------------------------------------------
# The invite lifecycle
# ---------------------------------------------------------------------------

def test_active_user_must_be_linked_to_clerk(cur, seed):
    """An active user with no Clerk id could never sign in; that row is a bug."""
    s = seed()
    with pytest.raises(errors.CheckViolation):
        cur.execute(
            "insert into users (tenant_id, email, role_id, status)"
            " values ('org_A', 'ghost@agency-a.test', %s, 'active')",
            (s["role_a"],),
        )


def test_multiple_pending_invites_coexist(cur, seed):
    """`clerk_user_id` is null until an invite is accepted.

    Postgres allows many NULLs under a unique constraint, which is what lets
    an owner invite several counsellors at once and assign their countries
    before anyone accepts.
    """
    s = seed()
    cur.execute(
        "insert into users (tenant_id, email, role_id)"
        " values ('org_A', 'invitee1@agency-a.test', %s)",
        (s["role_a"],),
    )
    cur.execute(
        "insert into users (tenant_id, email, role_id)"
        " values ('org_A', 'invitee2@agency-a.test', %s)",
        (s["role_a"],),
    )


# ---------------------------------------------------------------------------
# Field-level rules
# ---------------------------------------------------------------------------

def test_non_e164_phone_is_rejected(cur, seed):
    """Without a stored format you cannot compare or dial the numbers later."""
    s = seed()
    with pytest.raises(errors.CheckViolation):
        cur.execute(
            "insert into users (tenant_id, clerk_user_id, email, role_id, work_phone)"
            " values ('org_A', 'user_clerk_ph', 'phone@agency-a.test', %s,"
            " '0771234567')",
            (s["role_a"],),
        )


def test_e164_phone_is_accepted(cur, seed):
    s = seed()
    cur.execute(
        "insert into users (tenant_id, clerk_user_id, email, role_id, work_phone)"
        " values ('org_A', 'user_clerk_ok', 'ok@agency-a.test', %s, '+94771234567')",
        (s["role_a"],),
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

def test_permission_catalogue_is_seeded(cur):
    """Code references these keys by name; a missing row is a silent no-op."""
    cur.execute("select count(*) from permissions")
    assert cur.fetchone()[0] == 13

    cur.execute("select key from permissions where is_owner_only order by key")
    assert [r[0] for r in cur.fetchall()] == [
        "roles.manage",
        "tenant.settings",
        "users.countries.manage",
        "users.invite",
    ]
