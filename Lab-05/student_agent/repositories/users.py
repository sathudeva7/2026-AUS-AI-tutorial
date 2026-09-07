"""The `users` table and the grants attached to it.

Returns `UserRecord`, not `Principal`. `Principal` lives in `auth.py` and
means "a caller whose token has been verified" — importing it here would
point this layer back at the web layer and make the two circular. What comes
out of here is a row; deciding that the row belongs to a proved identity is
`auth.py`'s job.
"""

from __future__ import annotations

from dataclasses import dataclass

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
