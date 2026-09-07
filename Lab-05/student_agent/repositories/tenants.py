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


def ensure_with_owner(
    tenant_id: str,
    name: str,
    *,
    clerk_user_id: str,
    email: str,
    user_name: str | None,
    role: str,
) -> None:
    """Create the agency and its first user on first contact.

    `on conflict do nothing` rather than checking first: two browser tabs
    opening together would both find nothing and both insert. One transaction,
    because a tenant with no owner is not a state worth leaving behind.
    """
    with engine().begin() as conn:
        conn.execute(
            text("insert into tenants (id, name) values (:id, :name)"
                 " on conflict (id) do nothing"),
            {"id": tenant_id, "name": name},
        )
        conn.execute(
            text("insert into users (tenant_id, clerk_user_id, email, name,"
                 " role, status, accepted_at)"
                 " values (:t, :c, :e, :n, :r, 'active', now())"
                 " on conflict (tenant_id, clerk_user_id) do nothing"),
            {"t": tenant_id, "c": clerk_user_id, "e": email,
             "n": user_name, "r": role},
        )
