"""The `users` table and the grants attached to it.

Returns `UserRecord`, not `Principal`. `Principal` lives in `auth.py` and
means "a caller whose token has been verified" — importing it here would
point this layer back at the web layer and make the two circular. What comes
out of here is a row; deciding that the row belongs to a proved identity is
`auth.py`'s job.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Sequence

from sqlalchemy import text

from db import engine


@dataclass(frozen=True)
class UserRecord:
    """One user's row, plus the permissions granted to them individually.

    `id` is this database's uuid, NOT the Clerk user id. They are both text
    and mixing them up silently returns nothing, so the field names stay
    explicit everywhere they travel.
    """

    id: str
    role: str
    grants: frozenset[str]


def find_active(tenant_id: str, clerk_user_id: str) -> UserRecord | None:
    """The active member of this agency with that Clerk id, if any.

    Both ids are required, and `tenant_id` leads. The same person may hold a
    row at two agencies, so a lookup on `clerk_user_id` alone could return
    either one — which agency they are acting for is not theirs to imply.

    Filtering on `status = 'active'` here rather than in the caller means an
    invited-but-not-accepted or deactivated user resolves to None and is
    refused, without every call site having to remember the rule.
    """
    with engine().connect() as conn:
        row = conn.execute(
            text(
                "select id, role from users"
                " where tenant_id = :t and clerk_user_id = :c and status = 'active'"
            ),
            {"t": tenant_id, "c": clerk_user_id},
        ).one_or_none()
        if row is None:
            return None
        grants = conn.execute(
            text("select permission_key from user_permissions where user_id = :u"),
            {"u": row.id},
        ).scalars()
        return UserRecord(
            id=str(row.id),
            role=row.role,
            grants=frozenset(grants),
        )


#: Statuses shown when the caller does not ask for one. Deactivated people are
#: history: the roster screen wants colleagues, and an owner who invited
#: someone yesterday needs to see that it happened.
DEFAULT_STATUSES = ("active", "invited")

_ROW = """
    select u.id, u.name, u.email, u.role, u.status, u.timezone, u.work_phone,
           u.invited_at, u.accepted_at, u.created_at,
           coalesce(
               array_agg(c.country order by c.country)
                   filter (where c.country is not null),
               '{}'
           ) as countries
      from users u
      left join user_countries c
             on c.tenant_id = u.tenant_id and c.user_id = u.id
"""

_SELECT = _ROW + """
     where u.tenant_id = :tenant_id and u.status = any(:statuses)
     group by u.id
     -- NULLS LAST because an invited user has no name yet, and the default
     -- would sort whoever was invited most recently above everyone who
     -- actually works there.
     order by u.name asc nulls last, u.email
     limit :limit offset :offset
"""


def list_for_tenant(
    tenant_id: str,
    *,
    statuses: Sequence[str] = DEFAULT_STATUSES,
    limit: int = 25,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    """One page of the roster, and the total behind it.

    The count is a second statement rather than `count(*) over ()`: a window
    function returns no row at all when the page is empty, so paging past the
    end would report a total of zero instead of the real one.

    Countries are aggregated in the same query. The obvious alternative — a
    second query per user — is fifty round trips for an agency of fifty.
    """
    with engine().connect() as conn:
        total = conn.execute(
            text(
                "select count(*) from users"
                " where tenant_id = :tenant_id and status = any(:statuses)"
            ),
            {"tenant_id": tenant_id, "statuses": list(statuses)},
        ).scalar_one()

        rows = conn.execute(
            text(_SELECT),
            {
                "tenant_id": tenant_id,
                "statuses": list(statuses),
                "limit": limit,
                "offset": offset,
            },
        ).mappings().all()

    return [dict(r) for r in rows], total


def get(tenant_id: str, user_id: str) -> dict[str, Any] | None:
    """One roster row, in the same shape the list returns."""
    with engine().connect() as conn:
        row = conn.execute(
            text(_ROW + " where u.tenant_id = :t and u.id = :u group by u.id"),
            {"t": tenant_id, "u": user_id},
        ).mappings().one_or_none()
    return dict(row) if row else None


def status_of(tenant_id: str, email: str) -> str | None:
    """This email's status in this agency, or None if it is not on the roster.

    Tenant-scoped, because the same person may already work at another agency
    and that is not this agency's business.
    """
    with engine().connect() as conn:
        return conn.execute(
            text("select status from users where tenant_id = :t and email = :e"),
            {"t": tenant_id, "e": email},
        ).scalar_one_or_none()


def invite(tenant_id: str, email: str, role: str) -> str | None:
    """Create the invited row, or revive a deactivated one. Returns its id.

    Returns None when the address already belongs to an active or invited
    member — the caller checked first, but two owners clicking at once would
    slip through a check-then-act gap, so the guard is stated here as well and
    the database referees.

    Reviving rather than replacing matters: every lead that person worked and
    every fact they recorded hangs off this row's id. `clerk_user_id` is
    cleared so the revived row behaves exactly like a fresh invite and is
    claimed again on acceptance.
    """
    with engine().begin() as conn:
        return conn.execute(
            text(
                "insert into users (tenant_id, email, role, status, invited_at)"
                " values (:t, :e, :r, 'invited', now())"
                " on conflict (tenant_id, email) do update"
                "    set role = excluded.role, status = 'invited',"
                "        invited_at = now(), clerk_user_id = null,"
                "        accepted_at = null"
                "  where users.status = 'deactivated'"
                " returning id"
            ),
            {"t": tenant_id, "e": email, "r": role},
        ).scalar_one_or_none()


def set_role(tenant_id: str, user_id: str, role: str) -> None:
    """Refresh the cached role after Clerk's answer disagreed with ours."""
    with engine().begin() as conn:
        conn.execute(
            text("update users set role = :r"
                 " where tenant_id = :t and id = :u and role <> :r"),
            {"t": tenant_id, "u": user_id, "r": role},
        )
