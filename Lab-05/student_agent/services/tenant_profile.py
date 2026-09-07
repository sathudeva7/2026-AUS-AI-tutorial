"""What counts as a valid agency profile.

These raise `ValueError`, not `ApiError`. Pydantic catches `ValueError` inside
a field validator and turns it into a 422 carrying the field name, which is
exactly the response wanted — and it leaves these functions usable from a
migration script or a test that has no HTTP status to return.
"""

from __future__ import annotations

from typing import Any, Mapping
from zoneinfo import ZoneInfo

import phonenumbers

from services.geo import normalise_country  # noqa: F401  (re-exported)


def normalise_phone(raw: str) -> str | None:
    """A real number for its country, normalised to E.164.

    An E.164 regex only checks the SHAPE of a number: '+947424059777' passes
    it and is one digit too long for Sri Lanka, and '+9400000000' passes it
    and is nothing at all. libphonenumber holds each country's actual
    numbering plan.

    Normalising on the way in means '+94 74 240 5977' and '+94742405977' land
    in the column identically, so they compare and de-duplicate.
    """
    if not raw or not raw.strip():
        return None
    try:
        parsed = phonenumbers.parse(raw.strip(), None)
    except phonenumbers.NumberParseException:
        raise ValueError(
            "Enter the number in international format, starting with + and "
            "the country code — for example +94771234567."
        ) from None
    if not phonenumbers.is_valid_number(parsed):
        raise ValueError(
            "That is not a valid number for its country code. Check the digits."
        )
    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)


def split_phone(e164: str | None) -> tuple[str | None, str | None]:
    """(country code, national part) for a stored number.

    Resolved by libphonenumber rather than guessed from the dialling prefix.
    Eleven dialling codes are shared between countries — +44 covers Guernsey,
    Jersey, the Isle of Man and the UK, and +1 covers twenty-five — so a
    prefix match cannot tell them apart and the form's country picker lands on
    the wrong flag.

    Returns (None, None) for a number stored before this parsed cleanly, so
    the form falls back to showing the raw E.164 rather than dropping it.
    """
    if not e164:
        return None, None
    try:
        parsed = phonenumbers.parse(e164, None)
    except phonenumbers.NumberParseException:
        return None, None
    return (
        phonenumbers.region_code_for_number(parsed),
        phonenumbers.national_significant_number(parsed),
    )


def check_timezone(name: str) -> str:
    """An IANA zone that this machine can actually resolve.

    An unknown zone does not fail loudly — it renders every time on every
    screen wrong, which is far harder to notice than a rejected form.
    """
    try:
        ZoneInfo(name)
    except Exception:  # noqa: BLE001
        raise ValueError(
            "Not a known timezone. Use an IANA name such as Asia/Colombo."
        ) from None
    return name


def is_complete(row: Mapping[str, Any]) -> bool:
    """Whether the agency has enough detail to stop nagging about setup.

    Phone and a usable address. Deliberately not every column: `region` and
    `address_line2` do not exist in every country, so requiring them would
    leave some agencies permanently incomplete.
    """
    return bool(
        row.get("phone")
        and row.get("address_line1")
        and row.get("city")
        and row.get("country")
    )
