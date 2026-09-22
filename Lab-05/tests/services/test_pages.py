"""Turning what a page said into what the catalogue stores.

Pure functions over strings — no network, no database, no model. That is why
`services/pages.py` is a separate file from `extraction.py`: "does £19,600
parse" is answerable in a millisecond, and it would not be if answering it
meant a paid call.

Most of what is asserted here is a REFUSAL. The conversions that work are
easy; the ones that matter are the ones that must not quietly succeed.
"""

from __future__ import annotations

import pytest

from extraction import ExtractedFields, Extraction, ProposedIntake, Sourced
from services import pages


# ---------------------------------------------------------------------------
# Award levels
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("raw,expected", [
    ("MSc", "masters"),
    ("msc", "masters"),
    ("M.Sc.", "masters"),
    ("MA", "masters"),
    # Neither name says "masters", and both are.
    ("MBA", "masters"),
    ("LLM", "masters"),
    ("BEng", "bachelors"),
    ("PhD", "phd"),
    ("Postgraduate Diploma", "diploma"),
    ("Foundation Year", "foundation"),
])
def test_an_award_becomes_its_slug(raw, expected):
    assert pages.level(raw) == expected


def test_a_title_is_read_down_to_its_award():
    """Pages put the whole title in the award line more often than not."""
    assert pages.level("MSc Data Science") == "masters"


def test_an_unknown_award_passes_through_lowercased():
    """005 is explicit that level is NOT a closed set: an agency's integrated
    masters or pathway year is a real programme. Blanking it would lose a
    fact the page stated, and `levelLabel` passes unknowns through too."""
    assert pages.level("Integrated Masters") == "integrated masters"


def test_the_slugs_match_the_console():
    """DRIFT. `LEVEL_LABEL` in web/src/features/catalogue/display.ts holds the
    same list, and nothing makes them agree — the column is open text. A slug
    produced here that the console cannot label renders as a raw slug to a
    counsellor."""
    assert pages.LEVEL_SLUGS == {
        "masters", "bachelors", "phd", "doctorate",
        "diploma", "certificate", "foundation",
    }
    assert set(pages._AWARDS.values()) <= pages.LEVEL_SLUGS


# ---------------------------------------------------------------------------
# Money
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("raw,expected", [
    ("19600", "19600"),
    ("£19,600", "19600"),
    ("£19,600 per year", "19600"),
    ("24500.50", "24500.50"),
])
def test_a_fee_becomes_a_bare_amount(raw, expected):
    assert pages.fee(raw, "GBP") == expected


def test_the_fee_stays_in_major_units():
    """NOT minor units. `ProgrammeWrite` takes money as a person typed it and
    `_to_columns` converts on save — doing it here as well would put the
    exponent table in two places, which is the one thing money.py prevents."""
    assert pages.fee("£19,600", "GBP") == "19600"


def test_a_fee_that_is_not_a_figure_is_refused():
    assert pages.fee("please contact us", "GBP") is None


@pytest.mark.parametrize("raw,expected", [
    ("GBP", "GBP"),
    ("gbp", "GBP"),
    ("£", "GBP"),
    ("€", "EUR"),
])
def test_a_currency_is_read_from_a_code_or_a_symbol(raw, expected):
    assert pages.currency(raw) == expected


def test_a_dollar_sign_names_no_currency():
    """It is the Australian, Canadian, US, Singapore and Hong Kong dollar, and
    this product sends students to at least three of them. Guessing USD would
    quote a Melbourne fee in the wrong money."""
    assert pages.currency("$") is None
    assert pages.currency("", "$32,000") is None


def test_the_symbol_can_come_from_the_fee_itself():
    """A page often writes "£19,600" and never names the currency."""
    assert pages.currency("", "£19,600") == "GBP"


# ---------------------------------------------------------------------------
# Duration and country
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("raw,expected", [
    ("12", "12"),
    ("12 months full-time", "12"),
])
def test_a_duration_becomes_whole_months(raw, expected):
    assert pages.months(raw) == expected


@pytest.mark.parametrize("raw", ["varies", "0"])
def test_a_duration_that_is_not_a_length_is_refused(raw):
    assert pages.months(raw) is None


@pytest.mark.parametrize("raw,expected", [
    ("United Kingdom", "GB"),
    ("UK", "GB"),
    ("GB", "GB"),
    ("Australia", "AU"),
])
def test_a_country_becomes_iso_alpha_2(raw, expected):
    assert pages.country(raw) == expected


def test_a_region_is_not_a_country():
    assert pages.country("Europe") is None


# ---------------------------------------------------------------------------
# Intakes and deadlines
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("month,year,expected", [
    ("September", "2027", "2027-09"),
    ("Sept", "2027", "2027-09"),
    ("9", "2027", "2027-09"),
])
def test_a_month_and_year_become_a_stored_intake(month, year, expected):
    assert pages.intake(month, year) == expected


def test_a_month_with_no_year_is_not_an_intake():
    """The column is char(7). Inventing the year would undo the `unclear` the
    extractor set for exactly this case, in one line, invisibly."""
    assert pages.intake("September", None) is None


@pytest.mark.parametrize("raw,expected", [
    ("12 August 2027", "2027-08-12"),
    # The weekday has to be stepped over, not parsed. Leeds writes this.
    ("Friday 30 July 2027", "2027-07-30"),
    ("August 12, 2027", "2027-08-12"),
    ("2027-08-12", "2027-08-12"),
    ("31st January 2026", "2026-01-31"),
])
def test_a_deadline_becomes_an_iso_date(raw, expected):
    assert pages.deadline(raw) == expected


def test_a_date_no_calendar_has_is_refused():
    assert pages.deadline("31 September 2027") is None


def test_a_deadline_with_no_full_date_is_none():
    """`application_deadline` is nullable: an intake whose deadline nobody
    recorded is still an intake."""
    assert pages.deadline("rolling admissions") is None


# ---------------------------------------------------------------------------
# The whole reading
# ---------------------------------------------------------------------------

def _sourced(value):
    return Sourced(value=value, evidence="quoted", quote="q", section=None)


def _reading(**field_values):
    fields = ExtractedFields(
        **{n: _sourced(None) for n in ExtractedFields.model_fields}
    )
    return fields.model_copy(
        update={k: _sourced(v) for k, v in field_values.items()}
    )


def _extraction(fields, intakes=()):
    return Extraction(
        fields=fields, intakes=list(intakes), requirements=[],
        prompt_tokens=0, completion_tokens=0,
    )


def test_a_value_that_cannot_be_converted_keeps_its_quote():
    """THE RULE. A page saying "Tuition: please contact us" has no fee in it
    but does have something worth showing. The box empties, the evidence
    drops, and the sentence stays — the counsellor decides."""
    out = pages.normalise(
        _extraction(_reading(tuition_per_year="please contact us"))
    )
    assert out.fields.tuition_per_year.value is None
    assert out.fields.tuition_per_year.evidence == "unclear"
    assert out.fields.tuition_per_year.quote == "q"


def test_a_field_the_page_never_stated_stays_absent():
    """`absent` and `unclear` are different claims and must not collapse:
    one says the page is silent, the other that we could not read it."""
    absent = Sourced(value=None, evidence="absent", quote=None, section=None)
    fields = ExtractedFields(
        **{n: absent for n in ExtractedFields.model_fields}
    )
    assert pages.normalise(_extraction(fields)).fields.city.evidence == "absent"


def test_two_spellings_of_one_month_collapse():
    """`unique (tenant_id, programme_id, intake)` would refuse the second on
    save. Dropped here, where the reason can still be seen."""
    out = pages.normalise(_extraction(_reading(), intakes=[
        ProposedIntake(month="September", year="2027", application_deadline=None,
                       evidence="quoted", quote="q", section=None),
        ProposedIntake(month="Sept", year="2027", application_deadline=None,
                       evidence="quoted", quote="q", section=None),
    ]))
    assert [i.intake for i in out.intakes] == ["2027-09"]


def test_intakes_with_no_year_are_never_collapsed():
    """They are not yet the same month as anything, so merging them would
    throw away a start date on the strength of a year nobody has supplied."""
    out = pages.normalise(_extraction(_reading(), intakes=[
        ProposedIntake(month="September", year=None, application_deadline=None,
                       evidence="unclear", quote="q", section=None),
        ProposedIntake(month="January", year=None, application_deadline=None,
                       evidence="unclear", quote="q", section=None),
    ]))
    assert len(out.intakes) == 2
    assert all(i.intake is None for i in out.intakes)


def test_a_deadline_survives_an_unknown_year():
    """The two are read separately, so a missing intake year must not take a
    perfectly good deadline down with it."""
    out = pages.normalise(_extraction(_reading(), intakes=[
        ProposedIntake(month="January", year=None,
                       application_deadline="31 Jan 2027",
                       evidence="unclear", quote="q", section=None),
    ]))
    assert out.intakes[0].intake is None
    assert out.intakes[0].deadline_date == "2027-01-31"


def test_what_the_page_said_is_kept_beside_what_we_made_of_it():
    """The screen shows both. A counsellor checking "2027-09" against the page
    needs to see that the page said "September"."""
    out = pages.normalise(_extraction(_reading(), intakes=[
        ProposedIntake(month="September", year="2027",
                       application_deadline="12 August 2027",
                       evidence="quoted", quote="q", section=None),
    ]))
    intake = out.intakes[0]
    assert (intake.month, intake.year) == ("September", "2027")
    assert intake.application_deadline == "12 August 2027"
    assert (intake.intake, intake.deadline_date) == ("2027-09", "2027-08-12")
