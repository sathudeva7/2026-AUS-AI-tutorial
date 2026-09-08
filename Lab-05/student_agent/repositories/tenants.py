"""The `tenants` table. Plain rows in, plain dicts out."""

from __future__ import annotations

from typing import Any

from sqlalchemy import text

from db import engine

# Columns are named rather than `select *` so a column added later — an API
# key, an internal note — is not shipped to the browser by accident.
_SELECT = (
    "select id, name, phone, address_line1, address_line2, city, region,"
    " postal_code, country, default_timezone, active from tenants"
)

# `update` interpolates column names into the SQL, so it only accepts these.
# Missing on purpose: `id` and `name` are Clerk's (a write here would be
# overwritten by the next sync), `active` is an operational suspend.
WRITABLE = frozenset({
    "phone", "address_line1", "address_line2", "city",
    "region", "postal_code", "country", "default_timezone",
})


def get(tenant_id: str) -> dict[str, Any] | None:
    with engine().connect() as conn:
        row = conn.execute(
            text(f"{_SELECT} where id = :id"), {"id": tenant_id}
        ).one_or_none()
    return dict(row._mapping) if row else None


def update(tenant_id: str, fields: dict[str, Any]) -> None:
    """Write only the columns given, so a partial form cannot blank the rest."""
    unknown = set(fields) - WRITABLE
    if unknown:
        raise ValueError(f"not writable: {sorted(unknown)}")
    if not fields:
        return

    assignments = ", ".join(f"{k} = :{k}" for k in fields)
    with engine().begin() as conn:
        conn.execute(
            text(f"update tenants set {assignments} where id = :tenant_id"),
            {**fields, "tenant_id": tenant_id},
        )


def ensure_with_member(
    tenant_id: str,
    name: str,
    *,
    clerk_user_id: str,
    email: str,
    user_name: str | None,
    role: str,
) -> str | None:
    """Make sure the agency exists and this person is an active member of it.

    Runs on first contact, and covers two arrivals that look identical from
    here:

      * the founder, who created the organization and has no row yet
      * an invited counsellor, who ALREADY has a row — created by the invite,
        with a null clerk_user_id and status 'invited'

    The second is why this claims before it inserts. Matching on email is the
    only join available: the invite knew an address, and the Clerk id does not
    exist until the person accepts. Inserting instead would collide with
    `unique (tenant_id, email)` and leave them unable to sign in at all, having
    accepted an invitation that then went nowhere.

    One transaction, because a tenant row without its first user would make
    every later request believe provisioning was done, and nothing would retry.

    `on conflict do nothing` rather than checking first: two tabs opened
    together both find nothing and both insert, and the unique constraints are
    the only referee that sees every request at once.
    """
    with engine().begin() as conn:
        conn.execute(
            text(
                "insert into tenants (id, name) values (:id, :name)"
                " on conflict (id) do nothing"
            ),
            {"id": tenant_id, "name": name},
        )

        # Clerk is authoritative for role, so the claim refreshes it: the
        # invite recorded what was intended, this records what Clerk granted.
        claimed = conn.execute(
            text(
                "update users"
                "   set clerk_user_id = :c, status = 'active', accepted_at = now(),"
                "       role = :r, name = coalesce(name, :n)"
                " where tenant_id = :t and email = :e and clerk_user_id is null"
                # A REVOKED invitation still has a null clerk_user_id, so
                # without this it matches here and signing in sets the row
                # active again - the revocation quietly undone by the very
                # person it was aimed at. Deactivation is not a state that
                # accepting an invitation is allowed to leave.
                "   and status <> 'deactivated'"
                " returning id"
            ),
            {"t": tenant_id, "e": email, "c": clerk_user_id,
             "n": user_name, "r": role},
        ).scalar_one_or_none()
        if claimed is not None:
            return "active"

        conn.execute(
            text(
                "insert into users"
                "  (tenant_id, clerk_user_id, email, name, role, status, accepted_at)"
                " values (:t, :c, :e, :n, :r, 'active', now())"
                # Keyed on email, not clerk_user_id: the row that could already
                # be here is one this person's own second tab just claimed.
                " on conflict (tenant_id, email) do nothing"
            ),
            {"t": tenant_id, "c": clerk_user_id, "e": email,
             "n": user_name, "r": role},
        )

        # What the roster actually holds for this address now. The insert above
        # does nothing when a row already exists, so the caller cannot tell
        # "provisioned" from "there is a deactivated row here and this person is
        # not getting in" - and the second, unreported, surfaces as a 500.
        return conn.execute(
            text("select status from users where tenant_id = :t and email = :e"),
            {"t": tenant_id, "e": email},
        ).scalar_one_or_none()
