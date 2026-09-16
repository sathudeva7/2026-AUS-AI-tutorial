"""Minor units, and the ways a fee gets quoted wrong.

Every number here ends up in front of a student deciding whether they can
afford to study abroad, so these test the conversions rather than the
arithmetic.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from services.money import from_minor, to_minor


def test_a_pound_is_a_hundred_pence():
    assert to_minor("24500", "GBP") == 2450000
    assert from_minor(2450000, "GBP") == Decimal("24500.00")


def test_a_yen_is_not_divided():
    """The bug this module exists to prevent.

    JPY has no minor unit. A ¥1,200,000 fee stored as though it had two
    decimal places reads back as ¥12,000 — wrong by two orders of magnitude,
    and wrong in the direction a student would happily believe.
    """
    assert to_minor("1200000", "JPY") == 1200000
    assert from_minor(1200000, "JPY") == Decimal("1200000")


def test_a_dinar_is_divided_by_a_thousand():
    """Three decimal places, and the same failure in the other direction."""
    assert to_minor("9500", "BHD") == 9500000
    assert from_minor(9500000, "BHD") == Decimal("9500.000")


def test_more_precision_than_the_currency_has_is_refused():
    """Not rounded away. A fee is a figure somebody typed, and quietly turning
    24500.567 into 24500.57 answers a question that was not asked."""
    with pytest.raises(ValueError, match="more precise"):
        to_minor("24500.567", "GBP")


def test_a_currency_with_no_minor_unit_refuses_pennies():
    with pytest.raises(ValueError, match="more precise"):
        to_minor("1200000.50", "JPY")


def test_a_typed_thousands_separator_survives():
    """People type fees the way they read them."""
    assert to_minor("24,500.50", "GBP") == 2450050


def test_a_float_does_not_arrive_with_its_artefacts():
    """The seed stores fees as JSON floats. 24500.1 in binary is not exactly
    24500.1, and going through str() rather than Decimal(float) is what keeps
    that from becoming 2450009 pence."""
    assert to_minor(24500.1, "GBP") == 2450010


def test_a_negative_fee_is_refused():
    with pytest.raises(ValueError, match="negative"):
        to_minor("-100", "GBP")


def test_nonsense_is_refused_rather_than_zeroed():
    """A fee that failed to parse must not become free."""
    with pytest.raises(ValueError, match="not an amount"):
        to_minor("ask us", "GBP")


def test_reading_back_gives_a_decimal_not_a_float():
    """The round trip through a float is exactly what the bigint column exists
    to avoid; handing one back here would reintroduce it at the last step."""
    assert isinstance(from_minor(2450000, "GBP"), Decimal)
