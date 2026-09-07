"""The agency roster, and the caller's own identity."""

from __future__ import annotations

from datetime import datetime

from typing import Any

import logging
import os
from typing import Literal

from fastapi import Depends, Query, status as http
from pydantic import BaseModel, field_validator

from api import new_router
from auth import Principal, require_auth, require_permission
from envelope import ApiError, enveloped
from permissions import effective_permissions
from repositories import users as users_repo
from services import people

import clerk

log = logging.getLogger("northbound.users")

router = new_router(tags=["users"])


@router.get("/api/me")
def me(principal: Principal = Depends(require_auth)) -> dict[str, Any]:
    """The caller, their agency and their effective permissions.

    Also the endpoint that provisions a brand-new agency: the first request
    after signing up creates the tenant row and the owner, inside
    `require_auth`. The frontend calls this on load, so provisioning has
    happened before anything else needs it.

    Permissions are sent resolved — role's set ∪ individual grants, computed
    in one place — so the frontend never reimplements the rule to decide
    whether to render a button.
    """
    return {
        "tenant_id": principal.tenant_id,
        "user_id": principal.user_id,
        "role": principal.role,
        "permissions": sorted(effective_permissions(principal.role, principal.grants)),
    }


class UserOut(BaseModel):
    """One roster row.

    `clerk_user_id` is deliberately absent. It is an external identifier the
    client has no use for, and shipping identifiers nobody needs is how they
    end up in a log, a URL, or a bug report.
    """

    id: str
    name: str | None
    email: str
    role: str
    status: str
    timezone: str
    #: A product contact, not HR: this is the number a colleague rings about an
    #: escalation, so every member sees it.
    work_phone: str | None
    countries: list[str]
    invited_at: datetime | None
    accepted_at: datetime | None
    created_at: datetime


@router.get("/api/users")
def list_users(
    principal: Principal = Depends(require_auth),
    status: Literal["active", "invited", "deactivated", "all"] | None = None,
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """The agency roster.

    Readable by any member, not just an owner. Routing is by owned country, so
    a counsellor who cannot see who owns Australia cannot hand a lead to them —
    and the whole roster is workplace-internal to one agency anyway.

    `limit` is bounded rather than clamped: a caller who asks for 5000 rows and
    silently receives 100 has been given a wrong answer without being told.

    Every row comes from `principal.tenant_id`. There is no parameter for it,
    and one sent by the caller is ignored — a tenant id the client can set is
    not a scope, it is a suggestion.
    """
    statuses = (
        ("active", "invited", "deactivated")
        if status == "all"
        else (status,) if status
        else users_repo.DEFAULT_STATUSES
    )
    rows, total = users_repo.list_for_tenant(
        principal.tenant_id, statuses=statuses, limit=limit, offset=offset
    )
    return enveloped(
        [UserOut(id=str(r["id"]), **{k: v for k, v in r.items() if k != "id"})
         .model_dump(mode="json")
         for r in rows],
        meta={"limit": limit, "offset": offset, "total": total},
    )


def _row(tenant_id: str, user_id: str) -> dict:
    return UserOut(**{**users_repo.get(tenant_id, user_id), "id": str(user_id)}).model_dump(
        mode="json"
    )


class InviteRequest(BaseModel):
    email: str
    #: OUR vocabulary, not Clerk's. The wire contract should not make the
    #: frontend spell "org:member" — clerk.py owns that translation.
    role: Literal["counsellor", "manager", "owner"] = "counsellor"

    @field_validator("email")
    @classmethod
    def _valid_email(cls, v: str) -> str:
        return people.normalise_email(v)


@router.post("/api/users/invite", status_code=http.HTTP_201_CREATED)
def invite_user(
    req: InviteRequest,
    principal: Principal = Depends(require_permission("users.invite")),
):
    """Invite someone to this agency.

    Two systems, one action: Clerk sends the mail, this database records the
    roster row, and there is no transaction spanning them. So Clerk goes
    FIRST — deliberately.

    If the database write then fails, the invitation is live with no row, and
    lazy provisioning creates that row on their first request. Nothing is lost.
    The other order fails badly: a row written before a failed Clerk call puts
    someone on the roster who never received an email, and nothing would ever
    notice.

    Membership defines the agency, not the email domain (CLAUDE.md), so an
    address already working at another agency can be invited here freely —
    `unique (tenant_id, email)` is tenant-scoped for exactly that reason.
    """
    existing = users_repo.status_of(principal.tenant_id, req.email)
    if existing == "active":
        raise ApiError(http.HTTP_409_CONFLICT, "ALREADY_A_MEMBER",
                       "That person is already on your team.")
    if existing == "invited":
        raise ApiError(http.HTTP_409_CONFLICT, "ALREADY_INVITED",
                       "That person has already been invited.")

    try:
        clerk.invite_to_organization(
            principal.tenant_id,
            req.email,
            req.role,
            inviter_user_id=principal.clerk_user_id,
            redirect_url=os.getenv("APP_URL", "http://localhost:5173") + "/leads",
        )
    except clerk.ClerkError as exc:
        # The response deliberately says nothing about WHY — Clerk's body can
        # carry account details. But swallowing it entirely made a real 403
        # ("the inviter is not an admin in Clerk") indistinguishable from a
        # network blip, so it goes to the log with the request id to match.
        log.warning(
            "invite refused by clerk: tenant=%s inviter=%s: %s",
            principal.tenant_id, principal.clerk_user_id, exc,
        )
        # 502, not 500: nothing here is broken. The upstream refused, and the
        # caller can sensibly try again.
        raise ApiError(
            http.HTTP_502_BAD_GATEWAY,
            "INVITE_NOT_SENT",
            "The invitation could not be sent. Try again in a moment.",
        ) from exc

    user_id = users_repo.invite(principal.tenant_id, req.email, req.role)
    if user_id is None:
        # Another owner invited the same address between the check above and
        # this write. Their invitation stands; this one is a duplicate.
        raise ApiError(http.HTTP_409_CONFLICT, "ALREADY_INVITED",
                       "That person has already been invited.")
    return _row(principal.tenant_id, user_id)
