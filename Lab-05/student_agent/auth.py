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

import httpx
import jwt
from fastapi import Depends, Header, HTTPException, status
from jwt import PyJWKClient
from sqlalchemy import text

from db import engine

log = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent
CLERK_API = "https://api.clerk.com/v1"

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


# Clerk's default organization roles, used ONLY to seed a brand-new row. After
# that this database is authoritative for what someone may do — mirroring the
# Clerk role on every request would mean two sources of truth for the same
# question, and they would eventually disagree.
_CLERK_ROLE_SEED = {"org:admin": "owner", "admin": "owner"}


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

def _clerk_get(path: str) -> dict:
    """One call to Clerk's Backend API, with the secret key.

    Used only when provisioning — a session token carries the user's id but
    not their email address, and `users.email` is NOT NULL. One call per new
    user, never on the request path.
    """
    secret = os.getenv("CLERK_SECRET_KEY", "").strip()
    if not secret:
        raise RuntimeError(f"CLERK_SECRET_KEY is not set. Add it to {ROOT / '.env'}")
    r = httpx.get(
        f"{CLERK_API}{path}",
        headers={"Authorization": f"Bearer {secret}"},
        timeout=10.0,
    )
    r.raise_for_status()
    return r.json()


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

    org = _clerk_get(f"/organizations/{org_id}")
    user = _clerk_get(f"/users/{clerk_user_id}")

    emails = user.get("email_addresses") or []
    primary = user.get("primary_email_address_id")
    email = next(
        (e["email_address"] for e in emails if e.get("id") == primary),
        emails[0]["email_address"] if emails else None,
    )
    if not email:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="clerk_user_has_no_email",
        )

    name = " ".join(
        p for p in (user.get("first_name"), user.get("last_name")) if p
    ) or None

    # Clerk's org role seeds the first row only; this database owns the
    # question from then on.
    role = _CLERK_ROLE_SEED.get(org_role, "owner")

    with engine().begin() as conn:
        conn.execute(
            text(
                "insert into tenants (id, name) values (:id, :name)"
                " on conflict (id) do nothing"
            ),
            {"id": org_id, "name": org.get("name") or "Untitled agency"},
        )
        conn.execute(
            text(
                "insert into users"
                "  (tenant_id, clerk_user_id, email, name, role, status, accepted_at)"
                " values (:t, :c, :e, :n, :r, 'active', now())"
                " on conflict (tenant_id, clerk_user_id) do nothing"
            ),
            {"t": org_id, "c": clerk_user_id, "e": email, "n": name, "r": role},
        )


def _load(org_id: str, clerk_user_id: str) -> Principal | None:
    """The caller's row plus their grants, or None if not provisioned yet."""
    with engine().connect() as conn:
        row = conn.execute(
            text(
                "select id, role from users"
                " where tenant_id = :t and clerk_user_id = :c and status = 'active'"
            ),
            {"t": org_id, "c": clerk_user_id},
        ).one_or_none()
        if row is None:
            return None
        grants = conn.execute(
            text("select permission_key from user_permissions where user_id = :u"),
            {"u": row.id},
        ).scalars()
        return Principal(
            clerk_user_id=clerk_user_id,
            tenant_id=org_id,
            user_id=str(row.id),
            role=row.role,
            grants=frozenset(grants),
        )


# ---------------------------------------------------------------------------
# FastAPI dependency
# ---------------------------------------------------------------------------

def require_auth(authorization: str = Header(default="")) -> Principal:
    """The verified caller, provisioning the agency on first contact.

    Attach with `Depends(require_auth)` rather than repeating the check in
    each endpoint: the endpoint someone adds next year and forgets to protect
    is the hole, so the safe shape has to be the default one.
    """
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing_bearer_token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        claims = verify_token(token)
    except HTTPException:
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
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid_token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from None

    org_id, _ = _org_from_claims(claims)
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
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="no_active_organization"
        )

    principal = _load(org_id, claims["sub"])
    if principal is None:
        _provision(claims)
        principal = _load(org_id, claims["sub"])
    if principal is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="provisioning_failed",
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
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"missing_permission:{key}",
            )
        return principal

    return _dep
