"""Country codes, and the two different questions asked about them."""

from __future__ import annotations

import pytest

from services.geo import normalise_country, resolve_country


def test_the_seeds_uk_resolves_to_gb():
    """The alias that had to exist.

    The seed catalogue writes "UK"; `user_countries` stores GB. Both are two
    letters, so a shortcut that checks length before consulting the alias map
    returns "UK" unchanged — which is what left the coverage banner reporting
    Britain permanently unowned however many counsellors owned it.
    """
    assert resolve_country("UK") == "GB"
    assert resolve_country("United Kingdom") == "GB"


def test_a_country_name_resolves():
    """The seed stores names, not codes, for everything except Britain."""
    assert resolve_country("Australia") == "AU"
    assert resolve_country("Germany") == "DE"


def test_a_code_passes_through_in_either_case():
    assert resolve_country("gb") == "GB"
    assert resolve_country("AU") == "AU"


def test_a_three_letter_code_resolves():
    """ISO alpha-3. Worth a test because it means "AUS" is NOT a typo of
    "AU" being fuzzily forgiven — it is an exact match on another column."""
    assert resolve_country("AUS") == "AU"


def test_a_partial_name_is_refused_rather_than_guessed():
    """No fuzzy matching. A programme filed under the wrong country is routed
    to the wrong counsellor, or to nobody."""
    for text in ("Austra", "Ger", "Engl"):
        with pytest.raises(ValueError):
            resolve_country(text)


def test_nothing_is_refused():
    with pytest.raises(ValueError):
        resolve_country("")


def test_normalise_still_refuses_what_resolve_accepts():
    """The two functions answer different questions and must not be merged.

    `normalise_country` takes a value that should ALREADY be a code because it
    came from a dropdown, so "UK" arriving there means a broken client and is
    refused. `resolve_country` takes text a person wrote or a model read off a
    page. Using the lenient one on API input would let a typed country reach
    the column; using the strict one on seed data would reject the seed.
    """
    with pytest.raises(ValueError):
        normalise_country("UK")
    assert resolve_country("UK") == "GB"
    assert normalise_country("gb") == "GB"
