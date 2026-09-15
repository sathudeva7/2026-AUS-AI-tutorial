"""Calls to Clerk's Backend API.

Separate from `auth.py` because two things now need it: provisioning reads a
user's email, and inviting writes an organization invitation. A module that
verifies session tokens should not also be the place the HTTP client lives.

Nothing here is on the request path. Token verification is local — Clerk signs
with a private key and publishes the public one — so these calls happen only
when someone joins an agency.
"""

from __future__ import annotations

import logging
import os
import time
from pathlib import Path

import httpx

log = logging.getLogger(__name__)

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


#: Member photos, per organization: {org_id: (expires_at, {clerk_user_id: url})}.
#:
#: A roster read would otherwise call Clerk every time anyone opens the screen,
#: which is a network round trip on the critical path of a page that already
#: has its data. Sixty seconds is chosen against what it costs to be wrong: the
#: staleness window for someone who has just changed their photo, versus a
#: request per page view. Nothing else in the row is read from here, so a stale
#: entry means an old picture and never an old fact.
_IMAGE_CACHE: dict[str, tuple[float, dict[str, str]]] = {}
_IMAGE_TTL_SECONDS = 60.0


def member_images(org_id: str) -> dict[str, str]:
    """Every member's profile photo, keyed by Clerk user id.

    One request for the whole organization rather than one per person: a
    forty-person agency is forty round trips the other way, on a screen that
    already has everything else it needs.

    **Only real uploads are returned.** Clerk answers with an `image_url` for
    everybody, generating a grey placeholder for anyone who has not set one —
    the token in that URL decodes to `{"type":"default","initials":"KS"}`.
    Passing those through would replace our own initials avatars with Clerk's,
    which is a worse version of what the screen already does. `has_image` is
    the flag that separates the two, and people without a photo are simply
    absent from this map.

    Never raises. A missing photo is the same answer rendered plainer, so a
    Clerk outage must not take the roster down with it — which is the opposite
    of how this codebase treats a failed read everywhere else, and deliberately
    so. An empty lead list is a false statement about the business; an avatar
    that falls back to initials is not a statement at all.
    """
    now = time.monotonic()
    cached = _IMAGE_CACHE.get(org_id)
    if cached and cached[0] > now:
        return cached[1]

    images: dict[str, str] = {}
    try:
        offset, limit = 0, 100
        while True:
            page = get(
                f"/organizations/{org_id}/memberships?limit={limit}&offset={offset}"
            )
            rows = page.get("data") or []
            for member in rows:
                public = member.get("public_user_data") or {}
                user_id = public.get("user_id")
                if user_id and public.get("has_image") and public.get("image_url"):
                    images[user_id] = public["image_url"]
            # Clerk returns fewer than `limit` on the last page. Guarding on
            # the page length rather than total_count means one fewer field to
            # be wrong about, and terminates even if Clerk stops sending it.
            if len(rows) < limit:
                break
            offset += limit
    except Exception as exc:  # noqa: BLE001 — see the docstring
        log.warning("could not read member photos for %s: %s", org_id, exc)
        # Cached anyway, and that is the point: a Clerk outage would otherwise
        # mean a failed request per roster read for as long as it lasts.
        # Sixty seconds of initials is the cheaper failure.
        _IMAGE_CACHE[org_id] = (now + _IMAGE_TTL_SECONDS, {})
        return {}

    _IMAGE_CACHE[org_id] = (now + _IMAGE_TTL_SECONDS, images)
    return images


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
