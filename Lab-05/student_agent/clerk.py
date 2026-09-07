"""Calls to Clerk's Backend API.

Separate from `auth.py` because two things now need it: provisioning reads a
user's email, and inviting writes an organization invitation. A module that
verifies session tokens should not also be the place the HTTP client lives.

Nothing here is on the request path. Token verification is local — Clerk signs
with a private key and publishes the public one — so these calls happen only
when someone joins an agency.
"""

from __future__ import annotations

import os
from pathlib import Path

import httpx

API = "https://api.clerk.com/v1"
ROOT = Path(__file__).resolve().parent.parent

#: Clerk's organization roles, and what each seeds `users.role` with.
#:
#: Clerk owns roles (the invite dialog and OrganizationProfile write them), so
#: `users.role` is a CACHE of what Clerk says, exactly like `tenants.name`.
ROLE_FROM_CLERK = {
    "org:admin": "owner",
    "org:manager": "manager",
    "org:member": "counsellor",
    # Clerk has sent both forms across versions.
    "admin": "owner",
    "manager": "manager",
    "member": "counsellor",
}

#: The inverse, for minting an invitation.
ROLE_TO_CLERK = {
    "owner": "org:admin",
    "manager": "org:manager",
    "counsellor": "org:member",
}

#: What an unrecognised Clerk role becomes. LEAST privilege, deliberately:
#: defaulting to 'owner' meant every invited counsellor was provisioned with
#: all twelve permissions, including users.invite and tenant.settings.
DEFAULT_ROLE = "counsellor"


class ClerkError(RuntimeError):
    """Clerk refused or was unreachable. The caller decides what that means."""


def _secret() -> str:
    secret = os.getenv("CLERK_SECRET_KEY", "").strip()
    if not secret:
        raise RuntimeError(f"CLERK_SECRET_KEY is not set. Add it to {ROOT / '.env'}")
    return secret


def get(path: str) -> dict:
    """Read from Clerk."""
    r = httpx.get(
        f"{API}{path}",
        headers={"Authorization": f"Bearer {_secret()}"},
        timeout=10.0,
    )
    r.raise_for_status()
    return r.json()


def post(path: str, payload: dict) -> dict:
    """Write to Clerk.

    Raises ClerkError rather than letting httpx's exception escape, so the
    caller can tell "Clerk said no" from a bug in our own code — the two need
    different responses, and one of them must not leave a row behind.
    """
    try:
        r = httpx.post(
            f"{API}{path}",
            headers={"Authorization": f"Bearer {_secret()}"},
            json=payload,
            timeout=10.0,
        )
    except httpx.HTTPError as exc:
        raise ClerkError(f"could not reach Clerk: {exc}") from exc
    if r.status_code >= 400:
        # 403 here usually means the INVITER lacks the Clerk permission, not
        # that our secret key is wrong — Clerk requires an org admin to create
        # invitations, and our own role check can disagree with Clerk's.
        raise ClerkError(f"clerk {r.status_code}: {r.text[:300]}")
    return r.json()


def invite_to_organization(
    org_id: str, email: str, role: str, *, inviter_user_id: str, redirect_url: str
) -> dict:
    """Mint an organization invitation. Clerk sends the email.

    Minted per address: only the recipient can accept, which is why access
    comes from membership rather than an email domain (CLAUDE.md).
    """
    return post(
        f"/organizations/{org_id}/invitations",
        {
            "email_address": email,
            "role": ROLE_TO_CLERK[role],
            "inviter_user_id": inviter_user_id,
            "redirect_url": redirect_url,
        },
    )
