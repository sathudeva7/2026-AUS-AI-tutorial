"""What each role may do, and how a user's effective set is resolved.

This module is the ONLY place permissions resolve. Every endpoint asks
`effective_permissions` — two implementations would disagree eventually, and
the one that disagrees quietly is a security bug rather than a bug report.

The catalogue lives here rather than in a table because a permission only
means something if a code path checks it. A key nobody checks is a setting
that silently does nothing, so inventing one at runtime is not a feature.

    effective = ROLE_PERMISSIONS[user.role] | user's own grants

Grants only ever ADD. There is deliberately no revoke: a plain union keeps
"why can this person do that?" answerable in one query, where a three-way
resolution would not. Someone who needs less gets a lower role.

Keep GRANTABLE in step with the CHECK constraint on `user_permissions` in
db/migrations/002_simplify_access.sql. The database is the boundary; this is
the description of it.
"""

from __future__ import annotations

from dataclasses import dataclass

Role = str  # 'counsellor' | 'manager' | 'owner' — CHECKed in the database


@dataclass(frozen=True)
class Permission:
    key: str
    description: str
    #: Whether an owner may hand this to one person without promoting them.
    #:
    #: Not the same question as "which roles hold it" — a manager holds
    #: users.countries.manage by role, and it is still not grantable, because
    #: handing out the keys to routing one at a time is how someone becomes a
    #: manager by the back door. The user_permissions CHECK lists exactly the
    #: grantable keys, and a test asserts the two have not drifted.
    grantable: bool = True


CATALOGUE: tuple[Permission, ...] = (
    # Scope is a permission rather than something hardcoded per role, so the
    # grant mechanism covers visibility as well as capability: a counsellor
    # who needs full sight is granted leads.read.all through the same path
    # that gives them catalogue.write.
    Permission("leads.read.owned", "See leads in owned countries, plus the whole unassigned queue"),
    Permission("leads.read.all", "See every lead in the agency, regardless of country"),
    Permission("leads.write", "Work a lead: notes, facts, status"),
    Permission("leads.assign", "Reassign a lead to another user"),
    Permission("catalogue.read", "Read programmes and entry requirements"),
    Permission("catalogue.flag", "Raise a correction against a catalogue entry"),
    Permission("catalogue.write", "Create and edit programmes"),
    Permission("catalogue.verify", "Clear the verification queue so an entry reaches students"),
    Permission("users.edit", "Edit a roster member"),
    Permission("users.invite", "Invite a counsellor to the agency", grantable=False),
    Permission("users.countries.manage", "Set who owns which country", grantable=False),
    Permission("tenant.settings", "Agency details and tenant-wide configuration", grantable=False),
)

BY_KEY: dict[str, Permission] = {p.key: p for p in CATALOGUE}

#: What an owner may hand to one person without promoting them. Mirrors the
#: user_permissions CHECK constraint.
GRANTABLE: frozenset[str] = frozenset(p.key for p in CATALOGUE if p.grantable)


COUNSELLOR: frozenset[str] = frozenset({
    "leads.read.owned",
    "leads.write",
    "catalogue.read",
    "catalogue.flag",
})

MANAGER: frozenset[str] = COUNSELLOR - {"leads.read.owned"} | {
    "leads.read.all",
    "leads.assign",
    "catalogue.write",
    "catalogue.verify",
    "users.edit",
    # Routing ownership is day-to-day team management, not a keys-to-the-
    # kingdom setting: a manager covering for someone on leave has to be able
    # to move a country without an owner in the room.
    "users.countries.manage",
}

OWNER: frozenset[str] = frozenset(BY_KEY)

ROLE_PERMISSIONS: dict[Role, frozenset[str]] = {
    "counsellor": COUNSELLOR,
    "manager": MANAGER,
    "owner": OWNER,
}


def effective_permissions(role: Role, grants: object = ()) -> frozenset[str]:
    """Everything this user may do.

    `grants` is whatever their user_permissions rows say — an unknown role is
    a programming error rather than a reason to fall back to something
    permissive, so it raises. CLAUDE.md: prefer failing loudly.
    """
    try:
        base = ROLE_PERMISSIONS[role]
    except KeyError:
        raise ValueError(
            f"unknown role {role!r}; expected one of {sorted(ROLE_PERMISSIONS)}"
        ) from None
    return base | frozenset(grants)


def has_permission(role: Role, key: str, grants: object = ()) -> bool:
    """Whether this user may do one specific thing."""
    return key in effective_permissions(role, grants)


def sees_all_leads(role: Role, grants: object = ()) -> bool:
    """Whether lead queries skip the owned-countries filter.

    Named rather than open-coded at each call site: the difference between a
    counsellor's 14 leads and a manager's 47 is a WHERE clause, and it should
    be decided in one place.
    """
    return has_permission(role, "leads.read.all", grants)
