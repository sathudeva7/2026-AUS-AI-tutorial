"""Money, in the minor units the database stores.

CLAUDE.md: money in minor units (bigint) with the currency stored alongside,
never a float. `programmes.tuition_per_year_minor` is pence, cents, or
whatever the programme's own currency divides into — and how many of them
make one unit is a property OF that currency, not a constant.

Two callers already: the seed importer, which reads floats out of a JSON
fixture, and the catalogue write path, which reads what a counsellor typed
into a box. 006's extraction will be the third, parsing "£24,500" off a page.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

# ISO 4217 exponents that are not 2. Everything absent from this map divides
# into 100, which covers the overwhelming majority including every currency
# the seed catalogue uses.
#
# This matters more than it looks. A ¥1,200,000 fee stored as if it had
# decimal places is ¥12,000 on screen — a figure a student would budget on,
# wrong by two orders of magnitude and wrong in the cheap direction.
_EXPONENTS = {
    # No minor unit at all.
    "BIF": 0, "CLP": 0, "DJF": 0, "GNF": 0, "ISK": 0, "JPY": 0, "KMF": 0,
    "KRW": 0, "PYG": 0, "RWF": 0, "UGX": 0, "UYI": 0, "VND": 0, "VUV": 0,
    "XAF": 0, "XOF": 0, "XPF": 0,
    # Thousandths.
    "BHD": 3, "IQD": 3, "JOD": 3, "KWD": 3, "LYD": 3, "OMR": 3, "TND": 3,
    # Ten-thousandths.
    "CLF": 4, "UYW": 4,
}


def exponent(currency: str) -> int:
    """How many decimal places this currency has."""
    return _EXPONENTS.get(currency.strip().upper(), 2)


def to_minor(amount: str | int | float | Decimal, currency: str) -> int:
    """A figure a person wrote, as minor units.

    Refuses more precision than the currency has rather than rounding it away.
    A fee is quoted to a student who will budget on it, and silently turning
    24500.567 into 24500.57 is a different number than the one somebody typed
    — if the input is wrong, the write should say so, not tidy it.

    Floats are stringified before conversion so 24500.1 does not arrive as
    24500.099999999999.
    """
    try:
        value = Decimal(str(amount).strip().replace(",", ""))
    except (InvalidOperation, AttributeError):
        raise ValueError(f"{amount!r} is not an amount.") from None

    if value < 0:
        raise ValueError("An amount cannot be negative.")

    places = exponent(currency)
    scaled = value.scaleb(places)
    if scaled != scaled.to_integral_value():
        raise ValueError(
            f"{value} is more precise than {currency.upper()} allows "
            f"({places} decimal place{'' if places == 1 else 's'})."
        )
    return int(scaled)


def from_minor(minor: int, currency: str) -> Decimal:
    """Minor units back to the figure a person reads.

    Returns a Decimal, not a float. The round trip through a float is exactly
    what the bigint column exists to avoid, and handing one back here would
    reintroduce it at the last step.
    """
    return Decimal(minor).scaleb(-exponent(currency))
