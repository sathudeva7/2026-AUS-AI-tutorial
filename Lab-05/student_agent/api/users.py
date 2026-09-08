"""The agency roster, and the caller's own identity."""

from __future__ import annotations

from datetime import datetime

from typing import Any

import logging
import os
import re
from typing import Literal

from uuid import UUID

from fastapi import Depends, Query, status as http
from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic_core.core_schema import ValidationInfo

from api import new_router
from auth import Principal, require_auth, require_permission
from envelope import ApiError, enveloped
from repositories import availability as availability_repo
from repositories import users as users_repo
from permissions import effective_permissions, has_permission
from services import geo, people, tenant_profile

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


class CountriesRequest(BaseModel):
    """The COMPLETE set of countries this person owns.

    PUT rather than PATCH: the screen is a multi-select, so the client already
    holds the whole set and sending it is simpler than composing add/remove
    operations for a list of at most a few dozen.
    """

    countries: list[str] = Field(max_length=300)

    @field_validator("countries")
    @classmethod
    def _valid(cls, v: list[str]) -> list[str]:
        # Deduped rather than refused: a multi-select can emit the same value
        # twice, which is not a mistake worth a 422 — and `unique (user_id,
        # country)` would refuse the insert anyway.
        #
        # An EMPTY entry is different, and is refused. normalise_country
        # returns None for one, because it also serves optional address
        # fields where blank legitimately means "not given". In a list of
        # countries there is no such reading: "" is junk, and quietly dropping
        # it would save a set the caller never asked for.
        codes = set()
        for raw in v:
            code = geo.normalise_country(raw)
            if code is None:
                raise ValueError("Choose a country from the list.")
            codes.add(code)
        return sorted(codes)


@router.put("/api/users/{user_id}/countries")
def set_user_countries(
    user_id: UUID,
    req: CountriesRequest,
    principal: Principal = Depends(require_permission("users.countries.manage")),
):
    """Set who owns routing for which countries.

    Owner and manager. Owning a country decides which leads you SEE, so a
    counsellor able to set this could grant themselves visibility — and the
    key is absent from the user_permissions CHECK, so it cannot be handed to
    them individually either.

    `user_id` comes from the URL and is therefore the caller's to choose, so
    it is resolved against `principal.tenant_id`. A user in another agency is
    404, not 403: a 403 confirms the id exists, which answers the question the
    prober was asking.

    Existing leads keep their counsellor. Ownership drives NEW routing only —
    moving live leads because someone's countries changed would take work out
    from under them mid-conversation.
    """
    if users_repo.get(principal.tenant_id, str(user_id)) is None:
        raise ApiError(http.HTTP_404_NOT_FOUND, "USER_NOT_FOUND",
                       "That person is not on your team.")
    users_repo.set_countries(principal.tenant_id, str(user_id), req.countries)
    return _row(principal.tenant_id, str(user_id))


class UserPatch(BaseModel):
    """Editable roster details.

    `extra="forbid"` rather than Pydantic's default of dropping unknown keys.
    Silently ignoring {"role": "owner"} answers 200 and lets the caller
    believe it worked; for a privilege field that silence is the dangerous
    option. Role belongs to Clerk, email is identity, and deactivation has
    its own endpoint.
    """

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, max_length=200)
    work_phone: str | None = None
    timezone: str | None = None

    @field_validator("name")
    @classmethod
    def _blank_is_null(cls, v: str | None) -> str | None:
        """A cleared form field arrives as "" and means "no value"."""
        return v.strip() or None if v is not None else None

    @field_validator("work_phone")
    @classmethod
    def _valid_phone(cls, v: str | None) -> str | None:
        # None and "" both clear it: the column is nullable, and a counsellor
        # who no longer wants to be rung should be able to remove it.
        return tenant_profile.normalise_phone(v) if v else None

    @field_validator("timezone")
    @classmethod
    def _known_zone(cls, v: str | None) -> str | None:
        # NOT nullable here, unlike the two above: users.timezone is NOT NULL
        # and defaults to UTC, so there is no such thing as a user with no
        # zone. A null is a mistake rather than a clear, and saying so beats
        # a constraint violation surfacing as a 500.
        if v is None:
            raise ValueError("A timezone is required.")
        return tenant_profile.check_timezone(v)


@router.patch("/api/users/{user_id}")
def patch_user(
    user_id: UUID,
    patch: UserPatch,
    principal: Principal = Depends(require_auth),
):
    """Edit a roster member.

    Not `Depends(require_permission("users.edit"))`, which every other write
    endpoint uses, because everyone may edit their OWN row. Timezone is why:
    availability is wall clock read against users.timezone, so a counsellor
    who cannot set their own has their hours interpreted in the wrong zone,
    and the first sign of it is a student offered a 3am call.

    The check still resolves through permissions.py — self-or-permission, not
    a role comparison.
    """
    if str(user_id) != principal.user_id and not has_permission(
        principal.role, "users.edit", principal.grants
    ):
        raise ApiError(
            http.HTTP_403_FORBIDDEN,
            "MISSING_PERMISSION",
            "You do not have permission to do that.",
            details=[{"field": "permission", "issue": "users.edit"}],
        )

    if users_repo.get(principal.tenant_id, str(user_id)) is None:
        raise ApiError(http.HTTP_404_NOT_FOUND, "USER_NOT_FOUND",
                       "That person is not on your team.")

    fields = patch.model_dump(exclude_unset=True)
    if fields:
        users_repo.update(principal.tenant_id, str(user_id), fields)
    return _row(principal.tenant_id, str(user_id))


# ---------------------------------------------------------------------------
# Availability
# ---------------------------------------------------------------------------

#: 00:00 through 24:00. Postgres `time` includes 24:00:00 and that is the only
#: way to write "until midnight" under the end_time > start_time CHECK.
_TIME = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$")


def _minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


class Rule(BaseModel):
    """One recurring window, in the counsellor's own wall clock."""

    model_config = ConfigDict(extra="forbid")

    #: 0=Sunday .. 6=Saturday, matching the CHECK on the table and JS
    #: getDay(). The UI renders Monday first, which is a different thing from
    #: the number stored, and conflating the two is the classic bug here.
    day_of_week: int = Field(ge=0, le=6)
    start_time: str
    end_time: str

    @field_validator("start_time", "end_time")
    @classmethod
    def _looks_like_a_time(cls, v: str) -> str:
        if not _TIME.match(v):
            raise ValueError("Use 24-hour HH:MM, for example 09:00.")
        return v

    @field_validator("end_time")
    @classmethod
    def _after_the_start(cls, v: str, info: ValidationInfo) -> str:
        """Validated on end_time rather than on the model, so the error names
        the field the user can actually fix."""
        start = info.data.get("start_time")
        if start is None:
            return v          # start_time already failed; one complaint is enough
        if _minutes(v) == _minutes(start):
            raise ValueError("A shift cannot be zero length.")
        if _minutes(v) < _minutes(start):
            # Refused rather than silently split into 22:00-24:00 and
            # 00:00-02:00. The client would then be drawing a week we do not
            # hold, and the next GET would disagree with the screen.
            raise ValueError(
                "A shift cannot cross midnight. Send it as two rules:"
                " 22:00-24:00 and 00:00-02:00."
            )
        return v


class AvailabilityRequest(BaseModel):
    """The COMPLETE week, like the countries endpoint and for the same reason:
    the screen is a grid, so the client already holds every rule."""

    rules: list[Rule] = Field(default_factory=list, max_length=100)

    @field_validator("rules")
    @classmethod
    def _no_overlaps(cls, v: list[Rule]) -> list[Rule]:
        """Refuse a counsellor who is available twice at once.

        This guard exists ONLY here: `availability_rules` carries no exclusion
        constraint, so the database will store the contradiction happily and
        the damage surfaces much later as a double booking whose cause is no
        longer visible.

        Touching windows are not overlapping. A morning ending at 12:00 beside
        an afternoon starting at 12:00 is an ordinary split shift, and a check
        written with <= instead of < refuses it.
        """
        ordered = sorted(v, key=lambda r: (r.day_of_week, _minutes(r.start_time)))
        for before, after in zip(ordered, ordered[1:]):
            if (before.day_of_week == after.day_of_week
                    and _minutes(after.start_time) < _minutes(before.end_time)):
                raise ValueError(
                    f"Two windows overlap on day {before.day_of_week}:"
                    f" {before.start_time}-{before.end_time} and"
                    f" {after.start_time}-{after.end_time}."
                )
        return v


def _require_member(tenant_id: str, user_id: UUID) -> None:
    """404 for anyone outside this agency.

    Not 403, and not an empty week: "no hours set" and "none of your business"
    are different answers, and the second must not be readable as the first.
    """
    if users_repo.get(tenant_id, str(user_id)) is None:
        raise ApiError(http.HTTP_404_NOT_FOUND, "USER_NOT_FOUND",
                       "That person is not on your team.")


@router.get("/api/users/{user_id}/availability")
def get_user_availability(
    user_id: UUID,
    principal: Principal = Depends(require_auth),
):
    """Any member may read a colleague's week.

    Not gated the way writing is. Routing is by owned country, so knowing when
    the person who owns Australia is actually at their desk is what makes
    handing a lead over possible at all.
    """
    _require_member(principal.tenant_id, user_id)
    return enveloped(availability_repo.list_for_user(principal.tenant_id, str(user_id)))


@router.put("/api/users/{user_id}/availability")
def set_user_availability(
    user_id: UUID,
    req: AvailabilityRequest,
    principal: Principal = Depends(require_auth),
):
    """Set a counsellor's recurring hours.

    Self-or-`users.edit`, the same rule as PATCH /api/users/{id} and for a
    sharper version of the same reason: these times are read against the
    person's own timezone, so someone who cannot enter their own hours is
    offered to students at hours they never agreed to.
    """
    if str(user_id) != principal.user_id and not has_permission(
        principal.role, "users.edit", principal.grants
    ):
        raise ApiError(
            http.HTTP_403_FORBIDDEN,
            "MISSING_PERMISSION",
            "You do not have permission to do that.",
            details=[{"field": "permission", "issue": "users.edit"}],
        )

    _require_member(principal.tenant_id, user_id)
    availability_repo.set_for_user(
        principal.tenant_id,
        str(user_id),
        [(r.day_of_week, r.start_time, r.end_time) for r in req.rules],
    )
    return enveloped(availability_repo.list_for_user(principal.tenant_id, str(user_id)))
