"""Who the caller is, and everything they may do."""

from __future__ import annotations

from typing import Any

from fastapi import Depends

from api import new_router
from auth import Principal, require_auth
from permissions import effective_permissions

router = new_router(tags=["me"])


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
