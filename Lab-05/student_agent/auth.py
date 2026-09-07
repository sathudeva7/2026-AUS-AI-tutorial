"""Who is calling, which agency they belong to, and what they may do.

Three jobs, in order:

  1. VERIFY   the Clerk session token's signature. A JWT is not encrypted —
              anyone can read one and anyone can write one. Only the signature
              makes it trustworthy, so an unverified token is worth exactly
              nothing.
  2. RESOLVE  the agency from the token's `org_id` claim. CLAUDE.md: the
              tenant comes from the verified token, never from a request body,
              query string or header the client controls. A tenant id the
              caller can set is not a scope, it is a suggestion.
  3. PROVISION the agency on first contact, because Clerk creates the
              organization in the browser and this backend never hears about
              it otherwise.

Everything here fails CLOSED. Any error verifying a token is a 401, never a
request that proceeds unauthenticated — a `except: pass` in an auth path reads
as defensive coding and is the opposite of it.
"""

from __future__ import annotations

import base64
import logging
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import jwt
from fastapi import Depends, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

import clerk
from envelope import ApiError
from repositories import tenants as tenants_repo, users as users_repo

log = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent

def _org_from_claims(claims: dict) -> tuple[str | None, str]:
    """The active organization, across both Clerk session-token formats.

    v1 puts it flat on the token — `org_id`, `org_role`. v2 nests it under
    `o` with short keys: {"id": ..., "rol": ..., "slg": ...}. Which one an
    instance issues depends on its session-token version, so reading only the
    flat shape means a v2 instance looks permanently organization-less: the
    browser shows the agency in the switcher while the backend insists there
    is none.
    """
    org_id = claims.get("org_id")
    role = claims.get("org_role") or ""
    if not org_id:
        nested = claims.get("o")
        if isinstance(nested, dict):
            org_id = nested.get("id")
            role = nested.get("rol") or ""
    return org_id, role




# ---------------------------------------------------------------------------
# Clerk instance
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _frontend_api_host() -> str:
    """The Clerk host that publishes the signing keys.

    It is base64-encoded inside the publishable key — `pk_test_<base64>` —
    which is why the backend wants a key that is otherwise purely a browser
    concern.
    """
    pk = os.getenv("CLERK_PUBLISHABLE_KEY", "").strip()
    if not pk:
        raise RuntimeError(
            f"CLERK_PUBLISHABLE_KEY is not set. Add it to {ROOT / '.env'}"
        )
    try:
        payload = pk.split("_", 2)[2]
        decoded = base64.b64decode(payload + "=" * (-len(payload) % 4)).decode()
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"CLERK_PUBLISHABLE_KEY is malformed: {exc}") from exc
    return decoded.rstrip("$")


def issuer() -> str:
    return f"https://{_frontend_api_host()}"


@lru_cache(maxsize=1)
def _jwks() -> PyJWKClient:
    """Clerk's public keys, fetched once and cached.

    Verification is local: the key that SIGNS a token is private to Clerk, the
    key that CHECKS it is public. That asymmetry is why there is no call to
    Clerk on the request path — and why publishing the checking key is safe.

    `lifespan` lets the client re-fetch after key rotation rather than failing
    forever on a cached set.
    """
    return PyJWKClient(
        f"{issuer()}/.well-known/jwks.json",
        cache_keys=True,
        lifespan=3600,
    )


# ---------------------------------------------------------------------------
# The verified caller
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Principal:
    """A caller whose identity has been proved, and their agency.

    Every field here is derived from a verified signature or from this
    database. Nothing on it came from something the client could type.
    """

    clerk_user_id: str
    tenant_id: str
    user_id: str
    role: str
    grants: frozenset[str]


def verify_token(token: str) -> dict:
    """Claims from a Clerk session token, or raise.

    Beyond the signature this checks expiry and issuer. Skipping the issuer
    check would accept a validly-signed token minted by a DIFFERENT Clerk
    instance — signed, genuine, and nothing to do with this application.
    """
    key = _jwks().get_signing_key_from_jwt(token).key
    return jwt.decode(
        token,
        key,
        algorithms=["RS256"],
        issuer=issuer(),
        options={
            "require": ["exp", "iat", "sub"],
            "verify_exp": True,
            "verify_iss": True,
            # Clerk session tokens carry no `aud` by default; requiring one
            # would reject every real token.
            "verify_aud": False,
        },
        leeway=10,  # tolerate small clock skew between here and Clerk
    )


# ---------------------------------------------------------------------------
# Provisioning
# ---------------------------------------------------------------------------

def _provision(claims: dict) -> None:
    """Create the agency and its first user, once.

    Two rows, in ONE transaction. A half-provisioned agency is worse than an
    unprovisioned one: the tenant row's existence would make every later
    request believe the job was done, and nothing would ever retry.

    Both inserts are ON CONFLICT DO NOTHING rather than checked-then-inserted.
    Check-then-act is a race — the dashboard fires two requests in parallel on
    load, so for a new agency both would look, both would see nothing, and both
    would insert. Letting the database's unique constraints referee is the only
    check that sees every request at once.
    """
    org_id, org_role = _org_from_claims(claims)
    clerk_user_id = claims["sub"]

    org = clerk.get(f"/organizations/{org_id}")
    user = clerk.get(f"/users/{clerk_user_id}")

    emails = user.get("email_addresses") or []
    primary = user.get("primary_email_address_id")
    email = next(
        (e["email_address"] for e in emails if e.get("id") == primary),
        emails[0]["email_address"] if emails else None,
    )
    if not email:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "CLERK_USER_HAS_NO_EMAIL",
            "That account has no email address, so it cannot join an agency.",
        )

    name = " ".join(
        p for p in (user.get("first_name"), user.get("last_name")) if p
    ) or None

    # Clerk's org role seeds the first row only; this database owns the
    # question from then on.
    role = clerk.ROLE_FROM_CLERK.get(org_role, clerk.DEFAULT_ROLE)

    tenants_repo.ensure_with_member(
        org_id,
        org.get("name") or "Untitled agency",
        clerk_user_id=clerk_user_id,
        email=email,
        user_name=name,
        role=role,
    )


def _load(org_id: str, clerk_user_id: str, role: str) -> Principal | None:
    """The caller's row plus their grants, or None if not provisioned yet.

    `role` comes from the TOKEN, not from the row. Clerk owns roles — its
    dialog is where they are changed — so a role read from our column is only
    ever as fresh as the last time provisioning ran, which is once, ever.
    That drift is not theoretical: it let a Clerk `org:member` pass our
    `users.invite` check and get refused by Clerk with a 403 nobody could
    explain.

    The column stays, as a cache the roster renders and the widget and the
    worker can read without a token. When it disagrees with the token it is
    corrected here, so a stale row heals on that person's next request rather
    than needing a migration.

    The SQL is in repositories/users.py; what happens here is the step that
    layer must not take — turning a row into a Principal, which asserts the
    identity was PROVED. Only code that has verified a signature may do that.
    """
    record = users_repo.find_active(org_id, clerk_user_id)
    if record is None:
        return None
    if record.role != role:
        log.info(
            "role changed in clerk: user=%s %s -> %s", clerk_user_id, record.role, role
        )
        users_repo.set_role(org_id, record.id, role)
    return Principal(
        clerk_user_id=clerk_user_id,
        tenant_id=org_id,
        user_id=record.id,
        role=role,
        grants=record.grants,
    )


# ---------------------------------------------------------------------------
# FastAPI dependency
# ---------------------------------------------------------------------------

#: Declares the scheme in OpenAPI, which is what gives /docs its Authorize
#: button. Reading the header by hand worked, but Swagger then treated it as
#: an ordinary optional parameter and quietly sent the request WITHOUT it —
#: every "Try it out" came back 401 with no way to supply a token.
#:
#: auto_error=False so a missing header reaches us as None: FastAPI's own 403
#: would bypass the envelope and say "Not authenticated", where the rest of
#: the API says MISSING_BEARER_TOKEN.
bearer_scheme = HTTPBearer(
    auto_error=False,
    description=(
        "A Clerk session token. In the browser console while signed in:\n\n"
        "    await window.Clerk.session.getToken()\n\n"
        "Paste the value alone — Swagger adds the 'Bearer ' prefix. These "
        "expire after about 60 seconds, so fetch a fresh one if you get "
        "INVALID_TOKEN."
    ),
)


def require_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> Principal:
    """The verified caller, provisioning the agency on first contact.

    Attach with `Depends(require_auth)` rather than repeating the check in
    each endpoint: the endpoint someone adds next year and forgets to protect
    is the hole, so the safe shape has to be the default one.
    """
    token = credentials.credentials if credentials else ""
    if not token:
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED,
            "MISSING_BEARER_TOKEN",
            "Sign in to continue.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        claims = verify_token(token)
    except ApiError:
        raise
    except Exception as exc:  # noqa: BLE001 — every failure is a refusal
        # Header only: alg/kid/typ. Never the payload, which carries claims
        # about a real person. Enough to tell a malformed token from a
        # correctly-signed one this instance simply cannot verify.
        try:
            header = jwt.get_unverified_header(token)
        except Exception:  # noqa: BLE001
            header = {"unparseable": True, "segments": token.count(".") + 1}
        log.warning(
            "token rejected: %s: %s | header=%s len=%d",
            type(exc).__name__, exc, header, len(token),
        )
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED,
            "INVALID_TOKEN",
            "Your session is not valid. Sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from None

    org_id, org_role = _org_from_claims(claims)
    if not org_id:
        # Claim KEYS only — never their values, which describe a real person.
        # Enough to tell "no organization is active" from "the organization is
        # somewhere this code is not looking".
        log.warning(
            "no organization in token; claim keys = %s", sorted(claims)
        )
        # Signed in, but no active organization — they have not created or
        # selected an agency. Distinct from "not signed in", so the frontend
        # can send them to /create-agency instead of the sign-in page.
        raise ApiError(
            status.HTTP_403_FORBIDDEN,
            "NO_ACTIVE_ORGANIZATION",
            "Signed in, but no agency is selected.",
        )

    # Unknown Clerk roles fall to the LEAST privileged of ours, never the most.
    role = clerk.ROLE_FROM_CLERK.get(org_role, clerk.DEFAULT_ROLE)

    principal = _load(org_id, claims["sub"], role)
    if principal is None:
        _provision(claims)
        principal = _load(org_id, claims["sub"], role)
    if principal is None:
        raise ApiError(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "PROVISIONING_FAILED",
            "Your agency could not be set up. Try again.",
        )
    return principal


def require_permission(key: str):
    """Dependency factory: this endpoint needs one specific permission.

    Resolution goes through permissions.effective_permissions so role and
    grants are combined in exactly one place.
    """
    from permissions import has_permission

    def _dep(principal: Principal = Depends(require_auth)) -> Principal:
        if not has_permission(principal.role, key, principal.grants):
            raise ApiError(
                status.HTTP_403_FORBIDDEN,
                "MISSING_PERMISSION",
                "You do not have permission to do that.",
                # The key travels as a detail rather than glued into the
                # message, so the frontend never splits a string to find it.
                details=[{"field": "permission", "issue": key}],
            )
        return principal

    return _dep
