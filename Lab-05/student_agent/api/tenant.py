"""Agency details — the record behind the Tenant Setup card.

Deliberately not collected at signup. The create-agency screen asks only for a
name; everything here is configuration and belongs in the console, where there
is an agency to attach it to and context for what the fields are for.
"""

from __future__ import annotations

from fastapi import Depends
from pydantic import BaseModel, Field, field_validator

from api import new_router
from auth import Principal, require_auth, require_permission
from envelope import ApiError
from repositories import tenants as tenants_repo
from services import tenant_profile

router = new_router(tags=["tenant"])


class TenantOut(BaseModel):
    id: str
    name: str
    phone: str | None = None
    address_line1: str | None = None
    address_line2: str | None = None
    city: str | None = None
    region: str | None = None
    postal_code: str | None = None
    country: str | None = None
    default_timezone: str
    active: bool
    #: The phone's country and national part, split by libphonenumber. Not
    #: columns — computed for the form, which shows a country picker and a
    #: national-format field rather than one E.164 string.
    phone_country: str | None = None
    phone_national: str | None = None
    #: True when phone and a usable address are both present. Drives the
    #: "finish setting up your agency" prompt rather than leaving the fields
    #: silently empty forever.
    complete: bool


class TenantPatch(BaseModel):
    """Editable agency details.

    `name` is absent on purpose. It is a CACHE of Clerk's organization name —
    Clerk is authoritative, and a form that wrote it here would drift until
    the next sync silently overwrote whatever was typed. Name changes go
    through Clerk's own OrganizationProfile.

    Validation happens here as well as in the database. The CHECK constraints
    are the boundary and stay the boundary; this layer exists so a mistyped
    phone number comes back as a readable 422 naming the field, instead of a
    constraint violation surfacing as a 500.
    """

    phone: str | None = None
    address_line1: str | None = Field(default=None, max_length=200)
    address_line2: str | None = Field(default=None, max_length=200)
    city: str | None = Field(default=None, max_length=100)
    region: str | None = Field(default=None, max_length=100)
    postal_code: str | None = Field(default=None, max_length=32)
    country: str | None = None
    default_timezone: str | None = None

    # Each of these delegates to services/tenant_profile.py. The rules there
    # raise ValueError, which Pydantic turns into a 422 carrying this field's
    # name — so the same function serves the form and a script that has no
    # HTTP response to shape.

    @field_validator("phone")
    @classmethod
    def _valid_phone(cls, v: str | None) -> str | None:
        return tenant_profile.normalise_phone(v) if v else None

    @field_validator("country")
    @classmethod
    def _valid_country(cls, v: str | None) -> str | None:
        return tenant_profile.normalise_country(v) if v else None

    @field_validator("default_timezone")
    @classmethod
    def _known_zone(cls, v: str | None) -> str | None:
        return tenant_profile.check_timezone(v) if v is not None else None

    @field_validator(
        "address_line1", "address_line2", "city", "region", "postal_code",
        mode="before",
    )
    @classmethod
    def _blank_is_null(cls, v: object) -> object:
        """A cleared form field arrives as "" and means "no value"."""
        if isinstance(v, str) and not v.strip():
            return None
        return v


def _read(tenant_id: str) -> TenantOut:
    """The stored row, plus the two things the form needs computed."""
    row = tenants_repo.get(tenant_id)
    if row is None:
        raise ApiError(404, "TENANT_NOT_FOUND", "That agency does not exist.")
    country, national = tenant_profile.split_phone(row["phone"])
    return TenantOut(
        **row,
        phone_country=country,
        phone_national=national,
        complete=tenant_profile.is_complete(row),
    )


@router.get("/api/tenant")
def get_tenant(principal: Principal = Depends(require_auth)) -> TenantOut:
    """The agency record. Any member may read it — the rail and the widget
    preview both show the name and city."""
    return _read(principal.tenant_id)


@router.patch("/api/tenant")
def patch_tenant(
    patch: TenantPatch,
    principal: Principal = Depends(require_permission("tenant.settings")),
) -> TenantOut:
    """Update agency details. Owner-only, per the permission catalogue.

    `exclude_unset` is what makes a partial form safe: only fields the client
    actually sent are written, so a screen that renders half the record cannot
    blank the other half by omission. A field sent as null IS a clear, and
    that is the difference `exclude_unset` preserves and `exclude_none` would
    destroy.
    """
    fields = patch.model_dump(exclude_unset=True)
    if fields:
        tenants_repo.update(principal.tenant_id, fields)
    return _read(principal.tenant_id)
