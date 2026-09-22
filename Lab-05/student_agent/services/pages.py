"""What a course page said, in the units the catalogue stores.

The second half of the page reader. `extraction.py` returns values worded
the way the page words them — "£19,600", "United Kingdom", "MSc", "12 months
full-time" — and this turns them into what `ProgrammeWrite` accepts. The
split is the point: a model is good at finding text on a page and bad at
remembering that JPY has no minor unit, so the two jobs are done by the two
things that are good at them.

Nothing here touches the network, so every rule in this file is testable in
milliseconds against a string. That is the other reason it is not in
`extraction.py`.

WHEN A CONVERSION FAILS, THE QUOTE SURVIVES. A page reading "Tuition: please
contact us" has no fee in it, but it does have something the counsellor
should see. Dropping the whole field loses that; returning a value nobody
can defend is worse. So the value goes to null, the evidence drops to
`unclear`, and the sentence stays on screen with an empty box beside it.
That is the same three-state honesty `check_requirements` uses — pass, fail,
and the third answer that is neither.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

from extraction import Extraction, ProposedIntake, Sourced
from services import geo
from services.money import to_minor

# ---------------------------------------------------------------------------
# Award levels
# ---------------------------------------------------------------------------
#
# A SECOND STATEMENT of a list the console also holds, in `LEVEL_LABEL` in
# web/src/features/catalogue/display.ts. There is no single home for it today
# — the column is open text, checked only for being lowercase — so a drift
# test keeps the two honest rather than one importing the other across the
# language boundary.
#
# Open on purpose, both here and there. 005 is explicit: an agency's
# "integrated masters", "top-up" or "pathway" year is a real programme, and
# refusing to store one because this map was written without it is worse than
# an unrecognised slug in a column. So an award this map has not seen passes
# through lowercased — `levelLabel` does exactly the same on the way out.

LEVEL_SLUGS = frozenset({
    "masters", "bachelors", "phd", "doctorate",
    "diploma", "certificate", "foundation",
})

_AWARDS: dict[str, str] = {
    # Masters. MBA and LLM are masters awards whose names do not say so.
    "msc": "masters", "ma": "masters", "mres": "masters", "meng": "masters",
    "mba": "masters", "llm": "masters", "mphil": "masters", "msci": "masters",
    "mst": "masters", "master": "masters", "masters": "masters",
    "master's": "masters", "master of science": "masters",
    "master of arts": "masters", "postgraduate taught": "masters",
    # Bachelors.
    "bsc": "bachelors", "ba": "bachelors", "beng": "bachelors",
    "llb": "bachelors", "bachelor": "bachelors", "bachelors": "bachelors",
    "bachelor's": "bachelors", "undergraduate": "bachelors",
    # Doctorates. PhD keeps its own slug; the console labels them differently.
    "phd": "phd", "dphil": "phd", "doctorate": "doctorate", "edd": "doctorate",
    # Everything shorter.
    "pgdip": "diploma", "postgraduate diploma": "diploma",
    "graduate diploma": "diploma", "diploma": "diploma",
    "pgcert": "certificate", "postgraduate certificate": "certificate",
    "graduate certificate": "certificate", "certificate": "certificate",
    "foundation": "foundation", "foundation year": "foundation",
    "international foundation": "foundation",
}

_NON_ALNUM = re.compile(r"[^a-z0-9' ]+")


def level(raw: str) -> str | None:
    """An award as the catalogue slugs it, or the award lowercased.

    Never None for non-empty input: an unrecognised award is still a fact
    about the programme, and `search_programmes` matching nothing is a better
    failure than the console showing a blank where the page said "MRes".
    """
    # Abbreviation dots are DELETED, not turned into spaces: "M.Sc." is one
    # award and "m sc" is not a word this map will ever hold. Everything else
    # non-alphanumeric becomes a space, so "Master's (Research)" still splits.
    cleaned = (raw or "").strip().lower().replace(".", "")
    cleaned = " ".join(_NON_ALNUM.sub(" ", cleaned).split())
    if not cleaned:
        return None
    if cleaned in _AWARDS:
        return _AWARDS[cleaned]
    # "MSc Data Science" — the award is the first word, and a page that gives
    # the whole title here is commoner than one that gives the award alone.
    first = cleaned.split(" ")[0]
    if first in _AWARDS:
        return _AWARDS[first]
    return cleaned


# ---------------------------------------------------------------------------
# Money
# ---------------------------------------------------------------------------

#: Only where a symbol means exactly one currency. "$" does not — it is the
#: Australian, Canadian, US, Singapore and Hong Kong dollar, and this product
#: sends students to at least three of those. A page that writes "$" and
#: nothing else has not said which money it means.
_SYMBOLS = {"£": "GBP", "€": "EUR", "₹": "INR", "¥": "JPY", "₨": "LKR"}

_FEE_CLEAN = re.compile(r"[^\d.]")
_DIGITS = re.compile(r"\d")


def fee(raw: str, currency_code: str | None = None) -> str | None:
    """A bare amount, as `ProgrammeWrite` wants it typed. None if unreadable.

    Stays a STRING and stays in major units. `_to_columns` already converts
    on the way into the database, through `money.to_minor`, and converting
    here as well would put the exponent table in two places — the one thing
    `money.py` exists to prevent.

    `to_minor` still runs, as a check. A figure that cannot become minor
    units will be refused on save, and finding that out while the counsellor
    is looking at the page beats finding out after they press the button.
    """
    text = (raw or "").strip()
    if not _DIGITS.search(text):
        return None
    cleaned = _FEE_CLEAN.sub("", text)
    if not cleaned or cleaned.count(".") > 1:
        return None
    try:
        if to_minor(cleaned, currency_code or "USD") < 0:
            return None
    except (ValueError, ArithmeticError):
        return None
    return cleaned


def currency(raw: str, fee_text: str = "") -> str | None:
    """A three-letter code, from a code or an unambiguous symbol."""
    text = (raw or "").strip()
    code = text.upper()
    if re.fullmatch(r"[A-Z]{3}", code):
        return code
    for symbol, iso in _SYMBOLS.items():
        if symbol in text or symbol in (fee_text or ""):
            return iso
    return None


def months(raw: str) -> str | None:
    """A duration in whole months. "One year" has already been read as 12 by
    the extractor; this only has to survive "12 months full-time"."""
    match = re.search(r"\d+", raw or "")
    if not match:
        return None
    value = int(match.group())
    return str(value) if value > 0 else None


def country(raw: str) -> str | None:
    """ISO alpha-2, or None where the page's words do not name a country.

    `resolve_country` and not `normalise_country`: its own docstring says
    which is which — the lenient one is "for text written by a person or read
    off a page", and it names this feature as the caller it was written for.
    """
    try:
        return geo.resolve_country((raw or "").strip())
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Dates
# ---------------------------------------------------------------------------

_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


def _month_number(raw: str) -> int | None:
    text = (raw or "").strip().lower()
    if not text:
        return None
    if text.isdigit():
        n = int(text)
        return n if 1 <= n <= 12 else None
    return _MONTHS.get(text[:3])


def intake(month: str | None, year: str | None) -> str | None:
    """'YYYY-MM', the shape `programme_intakes.intake` stores.

    Both halves required. A month with no year is not an intake this column
    can hold, and the caller has already marked it `unclear` for exactly that
    reason — inventing a year here would undo that in one line.
    """
    number = _month_number(month or "")
    text = (year or "").strip()
    if number is None or not re.fullmatch(r"\d{4}", text):
        return None
    return f"{text}-{number:02d}"


_DAY_MONTH_YEAR = re.compile(
    r"\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s+(\d{4})\b"
)
_MONTH_DAY_YEAR = re.compile(
    r"\b([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b"
)
_ISO = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")


def deadline(raw: str) -> str | None:
    """An ISO date out of a page's prose, or None.

    Written against what the pages actually say: "Friday 30 July 2027" and
    "12 August 2027" both appeared in testing, so the weekday has to be
    stepped over rather than parsed. A string with no full date in it returns
    None — `application_deadline` is nullable, and an intake whose deadline
    nobody recorded is still an intake.
    """
    text = (raw or "").strip()
    if not text:
        return None

    if (iso := _ISO.search(text)):
        y, m, d = (int(part) for part in iso.groups())
    elif (dmy := _DAY_MONTH_YEAR.search(text)):
        day, name, year_text = dmy.groups()
        m, d, y = _month_number(name), int(day), int(year_text)
    elif (mdy := _MONTH_DAY_YEAR.search(text)):
        name, day, year_text = mdy.groups()
        m, d, y = _month_number(name), int(day), int(year_text)
    else:
        return None

    if m is None:
        return None
    try:
        return date(y, m, d).isoformat()
    except ValueError:
        # 31 September, and every other date a page can print but not have.
        return None


# ---------------------------------------------------------------------------
# Putting it together
# ---------------------------------------------------------------------------

#: field name -> how to convert it. Absent means "trim and keep".
_CONVERT = {
    "level": lambda value, fields: level(value),
    "country": lambda value, fields: country(value),
    "currency": lambda value, fields: currency(
        value, fields.tuition_per_year.value or ""
    ),
    "duration_months": lambda value, fields: months(value),
    "tuition_per_year": lambda value, fields: fee(
        value, currency(fields.currency.value or "", value)
    ),
}


def _convert(name: str, field: Sourced, fields) -> Sourced:
    if field.evidence == "absent" or not (field.value or "").strip():
        return field
    converter = _CONVERT.get(name)
    value = converter(field.value or "", fields) if converter else field.value.strip()
    if value is None:
        # Unreadable, not unsaid. The box empties and the quote stays, so the
        # counsellor sees what the page claimed and decides for themselves.
        return field.model_copy(update={"value": None, "evidence": "unclear"})
    return field.model_copy(update={"value": value})


class NormalisedIntake(ProposedIntake):
    """A proposed intake with the catalogue's own two date shapes added.

    Both nullable, and for different reasons: `intake` is null when the page
    never gave a year, `deadline_date` when it gave no deadline or gave one
    no calendar has. The raw `month`, `year` and `application_deadline` are
    kept so the screen can show what the page said next to what we made of it.
    """

    #: 'YYYY-MM', or null while the year is unknown.
    intake: str | None = None
    #: ISO date, or null.
    deadline_date: str | None = None


@dataclass(frozen=True)
class NormalisedReading(Extraction):
    """`Extraction`, with every value in the units the catalogue stores.

    Decorated, not merely subclassed. Without `@dataclass` the annotation
    below would be documentation with no `__init__` behind it — the parent's
    would run, the narrower type would never be enforced, and the two would
    agree right up until somebody added a field here.
    """

    # No default: `requirements` follows it in the inherited field order and
    # has none, and a dataclass cannot put a defaulted field before a bare one.
    intakes: list[NormalisedIntake]


def normalise(extraction: Extraction) -> NormalisedReading:
    """Every value converted, or emptied with its quote left in place."""
    fields = extraction.fields
    converted = type(fields)(
        **{
            name: _convert(name, getattr(fields, name), fields)
            for name in type(fields).model_fields
        }
    )

    intakes: list[NormalisedIntake] = []
    seen: set[str] = set()
    for proposed in extraction.intakes:
        month_year = intake(proposed.month, proposed.year)
        # `unique (tenant_id, programme_id, intake)`. Two proposals landing on
        # one month would be refused on save, so the second is dropped here
        # where the reason can still be seen. Intakes with no year are never
        # collapsed: they are not yet the same month as anything.
        if month_year and month_year in seen:
            continue
        if month_year:
            seen.add(month_year)
        intakes.append(
            NormalisedIntake(
                **proposed.model_dump(),
                intake=month_year,
                deadline_date=deadline(proposed.application_deadline or ""),
            )
        )

    return NormalisedReading(
        fields=converted,
        intakes=intakes,
        # Free text, and deliberately untouched. There is no catalogue shape
        # to convert a requirement INTO until the rules pass.
        requirements=list(extraction.requirements),
        prompt_tokens=extraction.prompt_tokens,
        completion_tokens=extraction.completion_tokens,
    )
