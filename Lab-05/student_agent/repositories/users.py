"""The `users` table and the grants attached to it.

Returns `UserRecord`, not `Principal`. `Principal` lives in `auth.py` and
means "a caller whose token has been verified" — importing it here would
point this layer back at the web layer and make the two circular. What comes
out of here is a row; deciding that the row belongs to a proved identity is
`auth.py`'s job.
"""

from __future__ import annotations

import uuid

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


def set_countries(tenant_id: str, user_id: str, countries: Sequence[str]) -> None:
    """Replace this user's routing ownership, preserving what did not change.

    A diff, not a delete-and-reinsert. `assigned_at` is what answers "who
    owned UK in March?" — the reason this is a table rather than an array on
    users — and replacing every row wholesale resets that date on countries
    nobody touched, destroying the history silently.

    One transaction: a user owning nothing for the instant between the delete
    and the insert would route leads to the unassigned queue.
    """
    wanted = set(countries)
    with engine().begin() as conn:
        current = set(
            conn.execute(
                text("select country from user_countries"
                     " where tenant_id = :t and user_id = :u"),
                {"t": tenant_id, "u": user_id},
            ).scalars()
        )
        removed, added = current - wanted, wanted - current
        if removed:
            conn.execute(
                text("delete from user_countries"
                     " where tenant_id = :t and user_id = :u"
                     "   and country = any(:cs)"),
                {"t": tenant_id, "u": user_id, "cs": sorted(removed)},
            )
        for country in sorted(added):
            conn.execute(
                text("insert into user_countries (tenant_id, user_id, country)"
                     " values (:t, :u, :c)"),
                {"t": tenant_id, "u": user_id, "c": country},
            )


#: What PATCH /api/users/{id} may write.
#:
#: Absent on purpose: `email` and `clerk_user_id` are identity — changing
#: either breaks the link to Clerk and the email match that claims an invited
#: row. `role` belongs to Clerk. `status` has its own endpoint, because
#: deactivating someone is not a field edit.
WRITABLE = frozenset({"name", "work_phone", "timezone"})


def update(tenant_id: str, user_id: str, fields: dict[str, Any]) -> None:
    """Write only the columns given, leaving the rest alone.

    Column names are interpolated into the statement — they cannot be bound as
    parameters — so they are checked against WRITABLE first. Today they arrive
    from a Pydantic model that already refuses anything else; the check is
    here so that stays true whoever calls this next.
    """
    unknown = set(fields) - WRITABLE
    if unknown:
        raise ValueError(f"not writable: {sorted(unknown)}")
    if not fields:
        return

    assignments = ", ".join(f"{k} = :{k}" for k in fields)
    with engine().begin() as conn:
        conn.execute(
            text(f"update users set {assignments}"
                 " where tenant_id = :tenant_id and id = :user_id"),
            {**fields, "tenant_id": tenant_id, "user_id": user_id},
        )


def status_of_clerk_user(tenant_id: str, clerk_user_id: str) -> str | None:
    """This Clerk identity's status in this agency, whatever it is.

    `find_active` deliberately filters to active and so cannot tell "switched
    off" from "never here". Auth needs the difference: one is a 403 the person
    can act on, the other is a first-time arrival to provision.
    """
    with engine().connect() as conn:
        return conn.execute(
            text("select status from users"
                 " where tenant_id = :t and clerk_user_id = :c"),
            {"t": tenant_id, "c": clerk_user_id},
        ).scalar_one_or_none()


#: Lead statuses that still represent work. 'converted' and 'withdrawn' are
#: finished: nulling the counsellor on those throws away the answer to "who
#: closed this?" and there is nothing left to hand on.
OPEN_LEAD_STATUSES = ("active", "parked")


def deactivate(tenant_id: str, user_id: str) -> int | None:
    """Switch someone off and free their open leads. Returns how many moved,
    or None if this would leave the agency with no active owner.

    One transaction, opened by locking the tenant's active owners. The guard is
    otherwise check-then-act: two owners deactivating each other at the same
    instant both count two owners, both proceed, and the agency is left with
    none — a state no endpoint can undo, because users.invite and
    tenant.settings are owner-only. The lock is what makes the second
    transaction see the first one's work instead of the roster as it was.

    Only ACTIVE owners count as cover. An invited owner has never signed in and
    an invitation cannot accept itself; a deactivated one is the problem, not
    the answer.
    """
    with engine().begin() as conn:
        owners = set(conn.execute(
            text("select id from users"
                 " where tenant_id = :t and role = 'owner' and status = 'active'"
                 " for update"),
            {"t": tenant_id},
        ).scalars())

        row = conn.execute(
            text("select role, status from users"
                 " where tenant_id = :t and id = :u"),
            {"t": tenant_id, "u": user_id},
        ).one_or_none()
        if row is None or row.status == "deactivated":
            # Already off. The state the caller asked for holds, and saying so
            # beats making a double-click look like a failure.
            return 0 if row is not None else None

        if row.role == "owner" and not owners - {uuid.UUID(user_id)}:
            return None

        conn.execute(
            text("update users set status = 'deactivated' where tenant_id = :t"
                 "   and id = :u"),
            {"t": tenant_id, "u": user_id},
        )
        # assigned_at and assignment_reason are left alone. 003 says why: a
        # stale assigned_at on an unassigned lead reads as history, and it is
        # the only record of where the lead had been.
        return conn.execute(
            text("update leads set assigned_user_id = null"
                 " where tenant_id = :t and assigned_user_id = :u"
                 "   and status = any(:open) and deleted_at is null"),
            {"t": tenant_id, "u": user_id, "open": list(OPEN_LEAD_STATUSES)},
        ).rowcount
