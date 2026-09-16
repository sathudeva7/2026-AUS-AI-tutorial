"""Country codes.

Its own module because two unrelated things now validate them — an agency's
postal address and a counsellor's routing ownership — and neither is about
the other. It lived in tenant_profile.py when there was only one caller.
"""

from __future__ import annotations

import pycountry


def normalise_country(raw: str) -> str | None:
    """An ISO 3166-1 alpha-2 code, checked against the register.

    'XX' is two letters and is not a country. The frontend sends a code from a
    dropdown, so a failure here means a broken client or someone calling the
    API directly — both of which should be refused rather than stored.
    """
    if not raw or not raw.strip():
        return None
    code = raw.strip().upper()
    if len(code) != 2 or pycountry.countries.get(alpha_2=code) is None:
        raise ValueError("Choose a country from the list.")
    return code


# Everyday names ISO 3166 does not carry, and pycountry therefore refuses.
# Checked rather than guessed: each key below was confirmed to raise
# LookupError against pycountry's own register.
#
# Deliberately short. This is not a place to accumulate every spelling a
# university page might use — it is the handful of names that are ordinary
# English and would otherwise fail for someone typing the obvious thing.
_ALIASES = {
    "uk": "GB",
    "britain": "GB",
    "great britain": "GB",
    "usa": "US",
    "america": "US",
    "russia": "RU",
    "holland": "NL",
    "uae": "AE",
    "macau": "MO",
    "turkey": "TR",
    "brunei": "BN",
    "cape verde": "CV",
    "ivory coast": "CI",
    "swaziland": "SZ",
    "burma": "MM",
}


def resolve_country(raw: str) -> str:
    """An ISO alpha-2 code from a code OR a country's name.

    `normalise_country` is for a value that should already be a code — it comes
    from a dropdown, and anything else means a broken client. This one is for
    text written by a person or read off a page: the seed catalogue stores
    "Australia" and "UK", and 006's extraction will read "United Kingdom" out
    of a university's own prose.

    Raises ValueError rather than returning None. A programme whose country
    could not be resolved is a programme no lead can ever be routed to, and it
    would sit in the catalogue looking complete — the failure this function
    exists to make loud.
    """
    if not raw or not raw.strip():
        raise ValueError("A country is required.")

    text = " ".join(raw.strip().split())

    # Aliases first. "UK" is two letters, so any shortcut that checks length
    # before the alias map returns it unchanged — which is exactly the bug
    # that left the coverage banner reporting Britain permanently unowned.
    alias = _ALIASES.get(text.lower().replace(".", ""))
    if alias:
        return alias

    try:
        return pycountry.countries.lookup(text).alpha_2
    except LookupError:
        raise ValueError(f"{raw!r} is not a country we can resolve.") from None
