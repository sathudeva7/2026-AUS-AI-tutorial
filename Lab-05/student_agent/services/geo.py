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
