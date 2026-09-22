"""Reading a course page's values off its text — the LLM half.

Pairs with `web/src/features/catalogue/extraction.ts`, which is the contract
this serves and worth reading first. The shape is the argument there, and it
is the argument here: every value arrives with the sentence it came from, so
a counsellor confirms a figure against the page rather than trusting a model.

WHAT THIS RETURNS IS RAW. Values come back worded as the page words them —
"£19,600", "United Kingdom", "MSc", "12 months full-time". Turning those into
catalogue values is `services/pages.py`, and the split is deliberate:

  - `money.py` knows JPY has no minor unit and BHD has three. A model asked
    to emit minor units would guess, and be wrong in the direction of a fee
    off by two orders of magnitude.
  - `geo.resolve_country` raises loudly on a country it cannot resolve. A
    model quietly emitting the wrong code gives you a programme no lead can
    ever be routed to, sitting in the catalogue looking complete.
  - The counsellor is checking the value against the quote. "£19,600" beside
    the box is the review step; "1960000" is not.

THE QUOTE IS VERIFIED HERE, not trusted. An LLM writes its quote, so it can
produce a sentence that reads exactly like a course page and appears nowhere
on it. `_verified` checks every quote is really in the page text and demotes
anything that is not to `absent`. This is the same guard `update_lead_facts`
applies to the agent — a fact whose words are not in the student's messages
is refused — and it lives in this module, beside the call, so no future
caller can reach the model without it. CLAUDE.md: enforce at the boundary,
not only in the prompt.

Model and shape follow `agent/planner.py`: one small non-streaming call with
no tools. Synchronous, unlike the planner, because the route that calls it is
synchronous and so is `exa.py` beside it.
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass
from typing import Literal

import openai
from openai import OpenAI
from pydantic import BaseModel, Field

log = logging.getLogger(__name__)

#: Same default as the agent. Extraction is a reading task, not a reasoning
#: one, and the profile's model is what this lab is calibrated against.
DEFAULT_MODEL = "gpt-5.4-mini"

#: Low, not zero. The same page read twice should give the same answer; this
#: is transcription, and creativity in it is a defect.
TEMPERATURE = 0.0

#: A page is 8–16k characters, so the call is slower than the planner's ~1s.
DEFAULT_TIMEOUT = 90.0


class ExtractionError(RuntimeError):
    """The reader could not produce an extraction.

    `retryable` carries the same meaning as `ExaError.retryable`, and for the
    same reason: a rate limit earns a "try again" and a refusal does not.
    """

    def __init__(self, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.retryable = retryable


class PageTooLong(ExtractionError):
    """The page overran the window.

    Its own class because it is the one extraction failure the counsellor can
    act on — a prospectus or a whole-department page instead of one course —
    and the route has to tell "your link will not work" apart from "our
    reader is down". A subclass rather than a flag so the dispatch stays in
    the `except` ladder, where Python already does it.
    """


# ---------------------------------------------------------------------------
# What the model is asked to return
# ---------------------------------------------------------------------------
#
# Every field is a string, including the ones the catalogue stores as numbers.
# The model's job is to find text; converting it is `services/pages.py`. A
# schema that asked for an integer here would be asking the model to parse
# "12 months full-time" as well as locate it, and a failure in the second
# half would lose the first.


class Sourced(BaseModel):
    """One value, and the page's own words for it."""

    value: str | None = Field(
        description="The value exactly as the page words it, or null when absent."
    )
    evidence: Literal["quoted", "unclear", "absent"] = Field(
        description=(
            "quoted: the page states this plainly. "
            "unclear: the page suggests it but does not settle it — a fee "
            "range, an intake month with no year. "
            "absent: this page does not say. Always correct when it does not."
        )
    )
    quote: str | None = Field(
        description=(
            "The sentence from the page, copied EXACTLY, character for "
            "character. Null only when evidence is absent."
        )
    )
    section: str | None = Field(
        description="The heading it sat under, so a person can find it again."
    )


class ExtractedFields(BaseModel):
    """The nine `ProgrammeWrite` fields, each with its evidence.

    Field names match `ProgrammeWrite` so the review step is the ordinary
    editor rather than a second screen kept in step with it by hand.
    """

    name: Sourced
    institution: Sourced
    country: Sourced
    city: Sourced
    level: Sourced
    field: Sourced
    tuition_per_year: Sourced
    currency: Sourced
    duration_months: Sourced


class ProposedIntake(BaseModel):
    """One start date the page names.

    Month and year are separate on purpose. A single "September" string
    cannot say whether the page omitted the year or the model dropped it,
    and that difference decides whether a human has to fill something in.
    """

    month: str | None = Field(
        description="The intake month as the page names it, e.g. 'September'."
    )
    year: str | None = Field(
        description=(
            "The four-digit year, ONLY if the sentence in `quote` contains "
            "it. Null otherwise — never carried over from elsewhere on the "
            "page and never inferred from today's date."
        )
    )
    application_deadline: str | None = Field(
        description="The deadline as written, e.g. '31 January 2026'. Null if absent."
    )
    evidence: Literal["quoted", "unclear"] = Field(
        description="quoted when the year is in the quote, unclear when it is not."
    )
    quote: str | None = Field(
        description="The sentence naming this intake, copied EXACTLY."
    )
    section: str | None = None


class RequirementPoint(BaseModel):
    """One entry requirement, as prose.

    No `fact_key` and no `rule`. Those come later, and forcing them now would
    throw away most of what a page says: "a 2:1 honours degree in a numerate
    subject" has no threshold form, and neither do a portfolio, two
    references or two years of work. A requirement nobody can store is still
    one a counsellor needs to read.

    `text` is the page's line tidied, never composed. If the model writes its
    own sentence, there is nothing left to check it against — which is the
    whole reason `quote` travels beside it.
    """

    text: str | None = Field(
        description=(
            "The requirement as one line, taken from the page with bullets "
            "and numbering removed. Not a summary and not your own wording."
        )
    )
    quote: str | None = Field(
        description="The page's exact words for this requirement."
    )
    section: str | None = Field(
        description="The heading it sat under, e.g. 'English language requirements'."
    )
    evidence: Literal["quoted", "unclear"] = Field(
        description="unclear when the page states it conditionally or vaguely."
    )


class PageReading(BaseModel):
    """Everything one page yielded. The schema the model answers in."""

    fields: ExtractedFields
    intakes: list[ProposedIntake]
    requirements: list[RequirementPoint]


#: Past this, a model has stopped reading and started padding. Enforced here
#: rather than in the schema because OpenAI's strict subset does not carry
#: maxItems, and a cap the server does not apply is not a cap.
MAX_INTAKES = 12
MAX_REQUIREMENTS = 25


@dataclass(frozen=True)
class Extraction:
    """What one page yielded, plus what the reading cost."""

    fields: ExtractedFields
    intakes: list[ProposedIntake]
    #: Free text for now. Display-only: `programme_requirements` needs a
    #: `fact_key` and a `rule`, so there is nowhere to save these yet and the
    #: counsellor reads them while filling the requirements builder by hand.
    requirements: list[RequirementPoint]
    #: Tokens in, tokens out. Counted because this is the second paid call in
    #: a read and "the extraction costs more than the fetch" is only visible
    #: if the two are attributed separately — the argument `planner.py` makes
    #: for stashing its own usage.
    prompt_tokens: int
    completion_tokens: int


# ---------------------------------------------------------------------------
# The prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are reading one university course page for an education consultancy that \
places international students. Extract only what this page states.

## The rule that matters most

Every value you return carries `quote`: the page's own sentence, copied \
EXACTLY. Do not paraphrase, tidy, shorten or reconstruct it. The quote is \
checked against the page afterwards, character for character, and a value \
whose quote is not found is thrown away — so an approximate quote loses a \
correct value.

## Never use what you already know

You may know this university. It does not matter. If this page does not say \
it, the answer is `absent`. A plausible fee from memory is the single worst \
thing you can return here, because it arrives looking exactly like a fee \
somebody checked.

## Choosing evidence

- `quoted` — the page states it plainly, and your quote shows it.
- `unclear` — the page bears on it without settling it. A fee given as a \
range or a band. An intake month with no year. A duration that differs \
between full-time and part-time. Put your best reading in `value` and let \
the quote show why it is not settled.
- `absent` — this page does not say. `value` and `quote` are both null. \
This is a good answer and you should use it freely.

## The fields

- `name` — the programme, as titled. "MSc Data Science", not "Data Science".
- `institution` — the university's full name.
- `country`, `city` — where this programme is TAUGHT. A branch campus is not \
in its parent's country. If the page names a campus but no city, the city is \
`absent` — a campus name is not a city.
- `level` — the award, as written: "MSc", "MA", "BEng", "Graduate Diploma".
- `field` — the subject area.
- `tuition_per_year` — the fee for ONE year, digits only, no symbol or \
separators: "19600". These students are INTERNATIONAL, so where a page gives \
home and overseas fees, take the overseas one — and if which is which is not \
plain, mark it `unclear` and quote the line showing both. A total for the \
whole course is not a yearly fee: if the page gives only a total, mark it \
`unclear` and quote it rather than dividing.
- `currency` — the three-letter code for that fee: GBP, AUD, EUR.
- `duration_months` — the full-time length in months, digits only: "12". \
"One year" is 12. Where full-time and part-time differ, take full-time.

If the page is not a course page at all — a faculty listing, a news item, a \
search result — return `absent` for everything rather than assembling a \
programme out of fragments.

## Intakes

One entry per start date the page names. None named, empty list.

The year is the trap. Give `year` ONLY when the sentence you put in `quote` \
contains it. A page whose start date reads "September" with the year \
somewhere else entirely gets `year: null` and `evidence: "unclear"` — a \
person will fill it in. Never carry a year across from another part of the \
page, never work it out from today's date, and never assume the next one.

`application_deadline` is ONE deadline, as written. Where a page gives \
different dates for home and overseas applicants, take the overseas one — \
the same reason the overseas fee is the one that matters here. Absent, null.

## Entry requirements

One entry per requirement the page states, in the order it states them.

Take the page's line and tidy it: drop the bullet, the numbering, the \
trailing colon. That is all. Do not summarise it, do not rewrite it in your \
own words, and do not merge two requirements into one line or split one into \
two. `quote` is the untouched original and it is checked against the page.

A REQUIREMENT IS A CONDITION, NOT AN ITEM IN A LIST IT NAMES. Where a page \
says "a degree in one of the following subjects" and then lists forty \
subjects, that is ONE requirement, and the subjects belong inside its `text` \
— not forty requirements one word long. The same goes for a list of accepted \
English tests or accepted countries. Before you add an entry, read it back \
on its own: if it is a bare noun like "Biology" or "Physics", it is part of \
the requirement above it, not a requirement.

Include requirements that are not about a number: a portfolio, references, \
work experience, an interview, a personal statement. These matter to the \
counsellor reading them and there is no other place they are recorded.

`section` is the heading it sat under — "Academic requirements", "English \
language requirements" — so the list can be shown grouped the way the page \
grouped it.

Requirements only. Not what the course teaches, not what graduates go on to \
do, not how to apply. If the page has no entry requirements section, return \
an empty list rather than gathering sentences that look like one.
"""


# ---------------------------------------------------------------------------
# The guard
# ---------------------------------------------------------------------------

_WHITESPACE = re.compile(r"\s+")


def _flat(text: str) -> str:
    """Collapse whitespace for comparison.

    A quote copied off a rendered page differs from the extracted text in
    line breaks and runs of spaces, and failing a true quote over a newline
    would discard correct values.
    """
    return _WHITESPACE.sub(" ", text).strip().lower()


def _absent() -> Sourced:
    return Sourced(value=None, evidence="absent", quote=None, section=None)


def _verified(field: Sourced, haystack: str) -> Sourced:
    """`field` if its quote is really on the page, otherwise `absent`.

    Three ways to fail, and all three land in the same place:

      - `absent` already, which is honest and passes through as-is.
      - A value with no quote. Evidence that cites nothing is not evidence,
        whatever the model labelled it.
      - A quote that is not in the page text. This is the invented one, and
        the only reason this function exists.
    """
    if field.evidence == "absent":
        return _absent()
    if not (field.quote or "").strip():
        return _absent()
    if _flat(field.quote or "") not in haystack:
        log.warning("dropped an unsupported quote: %.120s", field.quote)
        return _absent()
    if not (field.value or "").strip():
        # A quote with nothing read out of it proposes nothing. The page may
        # well say something relevant, but there is no value to put in a box.
        return _absent()
    return field


def _supported(quote: str | None, haystack: str) -> bool:
    """Is this quote really on the page?"""
    q = (quote or "").strip()
    return bool(q) and _flat(q) in haystack


def verify(reading: PageReading, page_text: str) -> PageReading:
    """Everything checked against the page. Exported for its own tests.

    A FIELD with an unsupported quote becomes `absent` — the box is left
    empty and the form says so. A LIST ITEM with one is DELETED, because
    there is no empty slot to leave it in: an invented requirement is not a
    blank field, it is an entry condition no human wrote, quietly turning
    away students who would have qualified. `extraction.ts` makes the same
    argument for why a proposal has to be accepted one at a time.
    """
    haystack = _flat(page_text)

    fields = ExtractedFields(
        **{
            name: _verified(getattr(reading.fields, name), haystack)
            for name in ExtractedFields.model_fields
        }
    )

    intakes: list[ProposedIntake] = []
    for intake in reading.intakes[:MAX_INTAKES]:
        if not (intake.month or "").strip():
            continue
        if not _supported(intake.quote, haystack):
            log.warning("dropped an unsupported intake: %.90s", intake.quote)
            continue
        # The year rule, applied here rather than trusted. A year the quote
        # does not contain came from somewhere the counsellor cannot see.
        year_shown = bool(intake.year) and _flat(intake.year or "") in _flat(
            intake.quote or ""
        )
        intakes.append(
            intake.model_copy(
                update={
                    "year": intake.year if year_shown else None,
                    "evidence": "quoted" if year_shown else "unclear",
                }
            )
        )

    requirements = [
        point
        for point in reading.requirements[:MAX_REQUIREMENTS]
        if (point.text or "").strip() and _supported(point.quote, haystack)
    ]
    dropped = len(reading.requirements[:MAX_REQUIREMENTS]) - len(requirements)
    if dropped:
        log.warning("dropped %d unsupported requirement(s)", dropped)

    return PageReading(fields=fields, intakes=intakes, requirements=requirements)


# ---------------------------------------------------------------------------
# The call
# ---------------------------------------------------------------------------


def _client(timeout: float) -> OpenAI:
    key = os.getenv("OPENAI_API_KEY", "").strip()
    if not key:
        raise ExtractionError("OPENAI_API_KEY is not set.")
    return OpenAI(api_key=key, timeout=timeout)


def extract(
    page_text: str,
    *,
    url: str | None = None,
    model: str = DEFAULT_MODEL,
    timeout: float = DEFAULT_TIMEOUT,
) -> Extraction:
    """Read a course page's fields out of its text. Raises `ExtractionError`.

    The returned fields have already been through `verify`, so a caller
    cannot accidentally use the model's unchecked answer — there is no path
    to it from outside this module.
    """
    if not (page_text or "").strip():
        raise ExtractionError("nothing to read: the page text is empty")

    client = _client(timeout)
    # The url is context, not a source. A model that reads the fee out of the
    # slug is doing the thing this whole design refuses, which is why the
    # quote check runs over the TEXT and never over the address.
    user = f"Course page{f' at {url}' if url else ''}:\n\n{page_text}"

    try:
        completion = client.chat.completions.parse(
            model=model,
            temperature=TEMPERATURE,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user},
            ],
            response_format=PageReading,
        )
    except openai.LengthFinishReasonError as exc:
        # The schema is fixed, so this means the page overran the window.
        raise PageTooLong("the page was too long to read in one pass") from exc
    except openai.APITimeoutError as exc:
        raise ExtractionError(f"the reader timed out after {timeout:g}s",
                              retryable=True) from exc
    except openai.RateLimitError as exc:
        raise ExtractionError("the reader is rate limited", retryable=True) from exc
    except openai.AuthenticationError as exc:
        raise ExtractionError("the reader rejected the API key") from exc
    except openai.APIConnectionError as exc:
        raise ExtractionError("could not reach the reader", retryable=True) from exc
    except openai.APIStatusError as exc:
        raise ExtractionError(
            f"the reader returned {exc.status_code}",
            retryable=exc.status_code >= 500,
        ) from exc

    parsed = completion.choices[0].message.parsed
    if parsed is None:
        # A refusal, or a response that did not fit the schema. Either way
        # there is nothing to fill a form with.
        refusal = getattr(completion.choices[0].message, "refusal", None)
        raise ExtractionError(refusal or "the reader returned no extraction")

    reading = verify(parsed, page_text)
    usage = getattr(completion, "usage", None)
    kept = sum(
        1 for n in ExtractedFields.model_fields
        if getattr(reading.fields, n).evidence != "absent"
    )
    log.info(
        "extracted %d/%d fields, %d intake(s), %d requirement(s) from %s",
        kept, len(ExtractedFields.model_fields),
        len(reading.intakes), len(reading.requirements), url or "a page",
    )
    return Extraction(
        fields=reading.fields,
        intakes=reading.intakes,
        requirements=reading.requirements,
        prompt_tokens=getattr(usage, "prompt_tokens", 0) or 0,
        completion_tokens=getattr(usage, "completion_tokens", 0) or 0,
    )
