"""The programme catalogue — what this consultancy has checked.

Reads only. Creating, editing, verifying and archiving land in the next slice;
until then the console still writes to its session store and says so.

Nothing here is a fee, a deadline or a requirement this service invented. Every
figure is a row somebody put in the database, and `verified_at` travels with
each one so the client can say how old it is.
"""

from __future__ import annotations

import logging
import re

from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from fastapi import Depends, Query, status as http
from pydantic import BaseModel, field_validator
from pydantic_core.core_schema import ValidationInfo

from api import new_router
from auth import Principal, require_permission
from envelope import ApiError, enveloped
import extraction
import research
from exa import ExaError, fetch_contents
from repositories import catalogue as catalogue_repo
from services import geo, pages
from services.money import from_minor, to_minor
from services.rules import validate_rule

log = logging.getLogger(__name__)

router = new_router(tags=["catalogue"])


class IntakeOut(BaseModel):
    intake: str
    #: Nullable: an intake whose deadline nobody has recorded is still an
    #: intake, and blanking the month to hide a missing date would lose the
    #: half we do know.
    application_deadline: date | None = None
    is_open: bool


class RequirementOut(BaseModel):
    id: UUID
    fact_key: str
    #: Machine text the evaluator reads, e.g. "bachelor_years>=4". Shipped
    #: alongside the description because the console shows both — a rule with
    #: no words cannot be explained to a student, and words with no rule are
    #: not checked by anything.
    rule: str
    description: str
    mandatory: bool


class ProgrammeOut(BaseModel):
    """One row of the catalogue table."""

    id: UUID
    name: str
    institution: str | None = None
    institution_id: UUID | None = None
    level: str | None = None
    field: str | None = None
    #: ISO 3166-1 alpha-2, the same units `user_countries` stores. The console
    #: renders it with countryName().
    country: str | None = None
    city: str | None = None

    #: Minor units with the currency beside it — pence, cents, or whatever
    #: this currency divides into. Not a formatted string: a formatted string
    #: cannot be sorted, compared or converted, and the client already knows
    #: how to render money.
    tuition_per_year_minor: int | None = None
    currency: str | None = None
    duration_months: int | None = None

    status: Literal["draft", "published", "archived"]
    #: Null means never checked, which is a different claim from checked long
    #: ago. Every figure above travels with this date.
    verified_at: datetime | None = None

    #: Somebody changed a figure since anyone last checked it.
    #:
    #: Derived from updated_at > verified_at, not stored. Editing a published
    #: programme deliberately leaves `verified_at` alone — clearing it would
    #: drop the row back to draft and take it away from students because
    #: somebody fixed a spelling — so this is how the console says that a fee
    #: moved after the last verification without the row going dark.
    edited_since_verified: bool = False

    #: The soonest intake still open, and when it closes. Both null when every
    #: intake has passed — the console says "No open intake" rather than
    #: showing a date nobody can act on.
    next_intake: str | None = None
    next_deadline: date | None = None

    created_at: datetime
    updated_at: datetime


class ProgrammeDetailOut(ProgrammeOut):
    intakes: list[IntakeOut] = []
    requirements: list[RequirementOut] = []


@router.get("/api/programmes")
def list_programmes(
    principal: Principal = Depends(require_permission("catalogue.read")),
    search: str | None = None,
    country: str | None = None,
    status: Literal["active", "stale", "draft", "archived", "all"] | None = None,
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """One page of the catalogue.

    `status` is the SCREEN's vocabulary, not the column's: "stale" means
    published and not looked at in `stale_after_days`, which is a date
    comparison rather than a status. The default excludes archived rows.

    `limit` is bounded rather than clamped, as on the roster: a caller who
    asks for 5000 and silently receives 100 has been given a wrong answer
    without being told.

    Every row comes from `principal.tenant_id`. There is no parameter for it,
    and one sent by the caller is ignored.
    """
    if country:
        try:
            country = geo.normalise_country(country)
        except ValueError as exc:
            # 'UK' reaches here from a hand-written request or an old client.
            # Refused rather than silently matching nothing, which would read
            # as "this agency has no British programmes".
            raise ApiError(
                http.HTTP_422_UNPROCESSABLE_CONTENT,
                "VALIDATION_FAILED",
                "The provided input contains errors.",
                details=[{"field": "country", "issue": str(exc)}],
            ) from None

    rows, total = catalogue_repo.list_for_tenant(
        principal.tenant_id,
        search=search,
        country=country,
        status=status,
        limit=limit,
        offset=offset,
    )

    return enveloped(
        [ProgrammeOut(**row).model_dump(mode="json") for row in rows],
        meta={
            "limit": limit,
            "offset": offset,
            "total": total,
            # The tiles, and the number the "Needs check" badge is drawn from.
            # Sent rather than hardcoded in the client so the badge and the
            # filter cannot disagree about what stale means.
            "counts": catalogue_repo.counts(principal.tenant_id),
            # The filter's options. Built from the rows on screen it would be
            # "the countries on page one" — a dropdown that cannot offer the
            # value somebody is looking for.
            "countries": catalogue_repo.country_codes(principal.tenant_id),
            "stale_after_days": catalogue_repo.STALE_AFTER_DAYS,
        },
    )


@router.get("/api/programmes/{programme_id}")
def get_programme(
    programme_id: UUID,
    principal: Principal = Depends(require_permission("catalogue.read")),
) -> dict[str, Any]:
    """One programme, with its intakes and entry requirements.

    404 for a programme in another agency, not 403: whether an id exists
    elsewhere is not this caller's business, and the two answers would let
    somebody enumerate other tenants' rows.
    """
    row = catalogue_repo.get(principal.tenant_id, programme_id)
    if not row:
        raise ApiError(
            http.HTTP_404_NOT_FOUND,
            "NOT_FOUND",
            "No such programme.",
        )
    return enveloped(ProgrammeDetailOut(**row).model_dump(mode="json"))


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------

def _invalid(field: str, issue: str) -> ApiError:
    return ApiError(
        http.HTTP_422_UNPROCESSABLE_CONTENT,
        "VALIDATION_FAILED",
        "The provided input contains errors.",
        details=[{"field": field, "issue": issue}],
    )


class ProgrammeWrite(BaseModel):
    """What a counsellor can set on a programme.

    `status`, `verified_at` and `verified_by` are absent by design. They move
    through /verify and /archive, which check a different permission — a body
    that could set them would let one request skip verification entirely.

    Money arrives as the person TYPED it ("24,500.50") with its currency, and
    leaves as minor units. The asymmetry is deliberate: a human types a
    decimal, a machine reads an integer, and putting the conversion here means
    the client never has to know that JPY has no decimal places while BHD has
    three. `services/money.py` owns that table.
    """

    institution: str | None = None
    name: str | None = None
    level: str | None = None
    field: str | None = None
    country: str | None = None
    city: str | None = None
    tuition_per_year: str | None = None
    currency: str | None = None
    duration_months: int | None = None

    @field_validator("country")
    @classmethod
    def _iso_country(cls, v: str | None) -> str | None:
        # normalise_country, not resolve_country: this comes from a picker, so
        # anything that is not already a code means a broken client. The
        # lenient one is for text a person wrote or a model read off a page.
        return geo.normalise_country(v) if v else None

    @field_validator("level")
    @classmethod
    def _lowercase_level(cls, v: str | None) -> str | None:
        # Normalised, not refused. `search_programmes` matches level exactly,
        # so "Masters" would be a programme nobody can find — but refusing a
        # capital letter would be a 422 for a typo the server can just fix.
        return v.strip().lower() or None if v is not None else None

    @field_validator("currency")
    @classmethod
    def _iso_currency(cls, v: str | None) -> str | None:
        if v is None:
            return None
        code = v.strip().upper()
        if not re.fullmatch(r"[A-Z]{3}", code):
            raise ValueError("Use a three-letter currency code, such as GBP.")
        return code

    @field_validator("duration_months")
    @classmethod
    def _positive_months(cls, v: int | None) -> int | None:
        if v is not None and v <= 0:
            raise ValueError("A programme lasts at least one month.")
        return v


def _to_columns(
    patch: dict[str, Any], tenant_id: str, current: dict[str, Any] | None
) -> dict[str, Any]:
    """The request body as database columns.

    Two translations happen here and nowhere else: a university NAME becomes
    an institution row, and a typed fee becomes minor units. Both need context
    the pydantic model does not have — the tenant, and the currency already on
    the row when a PATCH changes the amount alone.
    """
    columns: dict[str, Any] = {
        k: v for k, v in patch.items()
        if k not in {"institution", "tuition_per_year", "currency"}
    }

    if "institution" in patch:
        name = patch["institution"]
        columns["institution_id"] = (
            catalogue_repo.find_or_create_institution(
                tenant_id, name, patch.get("country")
                or (current or {}).get("country")
            )
            if name and name.strip()
            else None
        )

    # The pair moves together — `programmes_price_pair` requires both or
    # neither, because "24500" with no currency is not a cheaper programme,
    # it is an unanswerable question.
    if "tuition_per_year" in patch or "currency" in patch:
        amount = patch.get(
            "tuition_per_year",
            _from_minor_str(current) if current else None,
        )
        currency = patch.get("currency", (current or {}).get("currency"))

        if amount is None or (isinstance(amount, str) and not amount.strip()):
            columns["tuition_per_year_minor"] = None
            columns["currency"] = None
        else:
            if not currency:
                raise _invalid("currency", "A fee needs a currency.")
            try:
                columns["tuition_per_year_minor"] = to_minor(amount, currency)
            except ValueError as exc:
                raise _invalid("tuition_per_year", str(exc)) from None
            columns["currency"] = currency

    return columns


def _from_minor_str(row: dict[str, Any]) -> str | None:
    minor, currency = row.get("tuition_per_year_minor"), row.get("currency")
    return None if minor is None else str(from_minor(minor, currency))


def _detail(tenant_id: str, programme_id: UUID) -> dict[str, Any]:
    """The whole programme, for every endpoint that changes one.

    Writes answer with the full row rather than an acknowledgement so the
    console can replace what it holds instead of refetching — and so a
    derived field like `edited_since_verified` is never a turn out of date.
    """
    row = catalogue_repo.get(tenant_id, programme_id)
    if not row:
        raise ApiError(http.HTTP_404_NOT_FOUND, "NOT_FOUND", "No such programme.")
    return ProgrammeDetailOut(**row).model_dump(mode="json")


def _require(tenant_id: str, programme_id: UUID) -> dict[str, Any]:
    row = catalogue_repo.get(tenant_id, programme_id)
    if not row:
        raise ApiError(http.HTTP_404_NOT_FOUND, "NOT_FOUND", "No such programme.")
    return row


#: What `programmes_published_is_complete` demands, in the order the editor
#: shows them, with words rather than column names.
_REQUIRED_TO_PUBLISH = [
    ("institution_id", "an institution"),
    ("level", "an award level"),
    ("field", "a field of study"),
    ("country", "a country"),
    ("tuition_per_year_minor", "a tuition fee"),
    ("duration_months", "a duration"),
]


# ---------------------------------------------------------------------------
# Reading a course page
# ---------------------------------------------------------------------------
#
# The step before creating one: a counsellor pastes the university's own
# course page and the form fills from it rather than from forty keystrokes.
#
# This half returns the page's TEXT. Turning that text into fields — each one
# carrying the sentence it came from, per `web/src/features/catalogue/
# extraction.ts` — is the next slice, and the shape of this response is what
# it will be built on.
#
# No repository, because there is no row. `exa.py` is the data source here in
# the same way `clerk.py` is for the roster: an outside service with its own
# module, called from the route.


def _worth_researching(exc: ExaError) -> bool:
    """Is this a page that exists and is refusing us, or one that is gone?

    An agent run costs thirty times what the fetch does, so it is not a
    blanket retry. 404 is a link that will never work however it is read;
    403 and 5xx are what a bot challenge looks like from the outside, and
    those pages read perfectly well in a browser. A failure with no page
    status at all is ours — a malformed url — and buys nothing either.
    """
    return exc.page_status is not None and exc.page_status != 404


def _page_read(
    url: str,
    title: str | None,
    text: str,
    reading,
    *,
    researched: bool,
) -> PageReadResponse:
    return PageReadResponse(
        url=url,
        title=title,
        text=text,
        fields=reading.fields,
        intakes=reading.intakes,
        requirements=reading.requirements,
        researched=researched,
    )


def _reader_unavailable(cause: Exception) -> ApiError:
    """502, not 500: a third party failed, not us.

    One helper for both halves of the read. Exa being down and the model
    being rate limited are the same thing to the counsellor — wait and press
    it again — and the same thing to an operator: look outside this service.
    """
    log.warning("page reader unavailable: %s", cause)
    return ApiError(
        http.HTTP_502_BAD_GATEWAY,
        "PAGE_READER_UNAVAILABLE",
        "Could not reach the page reader. Try again in a moment.",
    )


class PageReadRequest(BaseModel):
    url: str


class PageReadResponse(BaseModel):
    """One course page, read and converted into catalogue values.

    The models come from `extraction` and `services.pages` rather than being
    restated here. They already are this shape, and a parallel set of nine
    fields plus two lists would be a second place to change every time one
    of them moves — the drift this route has no way to notice.
    """

    #: Where the fetch ENDED, which is not always what was asked for: course
    #: pages redirect to the current year's entry. This is the page the text
    #: came from, so it is the one worth recording against a programme.
    url: str
    title: str | None
    #: The page as the reader saw it. Kept while the prompt is still being
    #: tuned, so a thin extraction can be checked against what was actually
    #: read instead of guessed at. A candidate to drop once it settles.
    text: str

    #: Each carrying the sentence it came from. Never a bare value: this is
    #: the whole reason the reader is allowed to fill a form at all.
    fields: extraction.ExtractedFields
    intakes: list[pages.NormalisedIntake]
    #: FREE TEXT, AND NOT SAVED. `programme_requirements` needs a `fact_key`
    #: and a `rule`, and neither exists yet — so these are for the counsellor
    #: to read while filling the requirements builder by hand. The screen has
    #: to say so, or somebody saves the form and wonders where they went.
    requirements: list[extraction.RequirementPoint]

    #: True when the page refused to be fetched and the agent read it instead.
    #:
    #: The client must show this. Everything in a researched reading is
    #: `unclear` and none of its quotes were checked against the page,
    #: because there was no page text to check them against — and one or two
    #: values may have come off a different website entirely. A counsellor
    #: confirming these is doing something weaker than confirming a quote,
    #: and has to know that before they do it.
    researched: bool = False


@router.post("/api/programmes/read")
def read_programme_page(
    body: PageReadRequest,
    principal: Principal = Depends(require_permission("catalogue.write")),
) -> PageReadResponse:
    """Fetch a course page's text so the editor can be filled from it.

    `catalogue.write` rather than a key of its own: this reads no catalogue
    row, but its only purpose is to start writing one, and a permission that
    let somebody read pages without being able to save the result would guard
    nothing.

    NOT HOST-FILTERED, deliberately and provisionally. The agent's web tools
    go through `sources.programme_sources()` because the agent chooses its own
    URLs unattended; here a counsellor chose the page and the result lands as
    an unverified draft a human must confirm. Whether the curated allowlist
    should apply anyway is an open product decision — if it does, it belongs
    on this line, not inside `exa.py`, which is transport only.
    """
    researched = False
    page = None
    try:
        page = fetch_contents(body.url)
    except ExaError as exc:
        if exc.retryable:
            raise _reader_unavailable(exc) from exc
        if not _worth_researching(exc):
            # A dead link, or a link that is not one. Nothing else is worth
            # trying and an agent run would bill for finding that out.
            # `details` puts it against the box they can actually fix.
            raise _invalid("url", str(exc)) from exc
        # The page exists and is refusing crawlers — Cloudflare, mostly. The
        # agent reads those, slower and dearer and with weaker evidence, so
        # it runs here and nowhere else.
        log.info("falling back to the research reader for %s (%s)", body.url, exc)
        try:
            reading = pages.normalise(research.research(body.url))
        except ExaError as fallback_exc:
            # Say why the FIRST one failed, not the second. "Kingston blocks
            # readers" is the fact; "the agent also could not" is a detail of
            # our recovery, and the counsellor's next move is the same either
            # way — check the link, or fill it in by hand.
            log.warning("research reader also failed for %s: %s", body.url, fallback_exc)
            raise _invalid("url", str(exc)) from fallback_exc
        researched = True

    if page is None:
        return _page_read(body.url, None, "", reading, researched=True)

    try:
        reading = pages.normalise(extraction.extract(page.text, url=page.url))
    except extraction.PageTooLong as exc:
        # The one extraction failure the counsellor can do something about.
        raise _invalid(
            "url",
            "That page is too long to read. Try the course's own page rather "
            "than a prospectus or a department listing.",
        ) from exc
    except extraction.ExtractionError as exc:
        # Everything else here is ours — our key, our quota, our outage. None
        # of it is a fact about the link, so it must not land on that field.
        raise _reader_unavailable(exc) from exc

    log.info(
        "page read for tenant %s: %s (%d chars, $%.4f exa, %d/%d tokens)",
        principal.tenant_id, page.url, len(page.text), page.cost,
        reading.prompt_tokens, reading.completion_tokens,
    )
    return _page_read(page.url, page.title, page.text, reading, researched=researched)


@router.post("/api/programmes", status_code=http.HTTP_201_CREATED)
def create_programme(
    body: ProgrammeWrite,
    principal: Principal = Depends(require_permission("catalogue.write")),
) -> dict[str, Any]:
    """Start a programme. Always a draft, never visible to students yet."""
    fields = body.model_dump(exclude_unset=True)
    if not (fields.get("name") or "").strip():
        raise _invalid("name", "A programme needs a name.")

    programme_id = catalogue_repo.create(
        principal.tenant_id,
        created_by=principal.user_id,
        **_to_columns(fields, principal.tenant_id, None),
    )
    return enveloped(_detail(principal.tenant_id, programme_id))


@router.patch("/api/programmes/{programme_id}")
def patch_programme(
    programme_id: UUID,
    body: ProgrammeWrite,
    principal: Principal = Depends(require_permission("catalogue.write")),
) -> dict[str, Any]:
    """Edit a programme.

    Only the fields the client sent, so two counsellors with one programme
    open do not overwrite each other's untouched columns.

    `verified_at` is deliberately NOT cleared. Clearing it would violate
    `programmes_published_is_verified` and drag a live programme back to draft
    — taking it away from students because somebody corrected a spelling. What
    moves is `updated_at`, which makes `edited_since_verified` true: the row
    stays published and says out loud that a figure changed after the last
    check.
    """
    current = _require(principal.tenant_id, programme_id)
    fields = body.model_dump(exclude_unset=True)

    if "name" in fields and not (fields["name"] or "").strip():
        raise _invalid("name", "A programme needs a name.")

    catalogue_repo.update(
        principal.tenant_id,
        programme_id,
        _to_columns(fields, principal.tenant_id, current),
    )
    return enveloped(_detail(principal.tenant_id, programme_id))


class IntakeIn(BaseModel):
    intake: str
    application_deadline: date | None = None
    is_open: bool = True

    @field_validator("intake")
    @classmethod
    def _month(cls, v: str) -> str:
        if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", v.strip()):
            raise ValueError("Use YYYY-MM, for example 2027-09.")
        return v.strip()


@router.put("/api/programmes/{programme_id}/intakes")
def put_intakes(
    programme_id: UUID,
    intakes: list[IntakeIn],
    principal: Principal = Depends(require_permission("catalogue.write")),
) -> dict[str, Any]:
    """Replace the complete set of intakes.

    The whole list, not a diff — the same contract as PUT /countries. Each
    intake carries ITS OWN deadline: January and September close months apart,
    and one shared date means the agent quotes the wrong one to half the
    students.
    """
    _require(principal.tenant_id, programme_id)

    months = [i.intake for i in intakes]
    if len(set(months)) != len(months):
        raise _invalid("intake", "Each intake can only appear once.")

    catalogue_repo.set_intakes(
        principal.tenant_id, programme_id,
        [i.model_dump() for i in intakes],
    )
    return enveloped(_detail(principal.tenant_id, programme_id))


class RequirementIn(BaseModel):
    fact_key: str
    rule: str
    description: str
    mandatory: bool = True

    @field_validator("rule")
    @classmethod
    def _evaluable(cls, v: str, info: ValidationInfo) -> str:
        """A rule nothing can evaluate is refused here, not stored.

        `check_requirements` calls float() on the number in the rule while a
        student is waiting. An unparseable one raises there — a 500 mid
        conversation, caused by something typed weeks earlier on a different
        screen. See services/rules.py for what is actually load-bearing.

        `fact_key` is declared above this field, so it is already in
        `info.data` — the same ordering trick api/users.py uses.
        """
        fact_key = info.data.get("fact_key")
        if fact_key is None:
            # fact_key failed its own validation; its error is the useful one.
            return v
        return validate_rule(fact_key, v)

    @field_validator("description")
    @classmethod
    def _readable(cls, v: str) -> str:
        """A rule with no words produces a verdict the agent cannot explain."""
        if not v.strip():
            raise ValueError("A requirement needs words a student can read.")
        return v.strip()


@router.put("/api/programmes/{programme_id}/requirements")
def put_requirements(
    programme_id: UUID,
    requirements: list[RequirementIn],
    principal: Principal = Depends(require_permission("catalogue.write")),
) -> dict[str, Any]:
    """Replace the complete set of entry requirements, in the order given."""
    _require(principal.tenant_id, programme_id)
    catalogue_repo.set_requirements(
        principal.tenant_id, programme_id,
        [r.model_dump() for r in requirements],
    )
    return enveloped(_detail(principal.tenant_id, programme_id))


@router.post("/api/programmes/{programme_id}/verify")
def verify_programme(
    programme_id: UUID,
    principal: Principal = Depends(require_permission("catalogue.verify")),
) -> dict[str, Any]:
    """Put your name on it, and let students see it.

    A different permission from editing, which is the point: a counsellor may
    be trusted to correct a fee without being the person who certifies it.

    The completeness check is here so the answer names what is missing. The
    database would refuse the row anyway — `programmes_published_is_complete`
    — but as a CHECK violation, which tells a counsellor nothing.
    """
    row = _require(principal.tenant_id, programme_id)

    if row["status"] == "archived":
        raise _invalid("status", "Restore this programme before verifying it.")

    missing = [label for column, label in _REQUIRED_TO_PUBLISH
               if row.get(column) is None]
    if missing:
        raise ApiError(
            http.HTTP_422_UNPROCESSABLE_CONTENT,
            "VALIDATION_FAILED",
            f"Still needs {', '.join(missing)}.",
            details=[{"field": "programme", "issue": label} for label in missing],
        )

    catalogue_repo.verify(principal.tenant_id, programme_id, principal.user_id)
    return enveloped(_detail(principal.tenant_id, programme_id))


@router.post("/api/programmes/{programme_id}/archive")
def archive_programme(
    programme_id: UUID,
    principal: Principal = Depends(require_permission("catalogue.write")),
) -> dict[str, Any]:
    """Take it out of the catalogue, and keep it.

    There is no DELETE. Past `tool_calls` name this id and the dashboard
    rebuilds shortlists from them, so removing the row turns a completed
    shortlist into a dangling reference nobody can explain.
    """
    _require(principal.tenant_id, programme_id)
    catalogue_repo.set_status(principal.tenant_id, programme_id, "archived")
    return enveloped(_detail(principal.tenant_id, programme_id))


@router.post("/api/programmes/{programme_id}/restore")
def restore_programme(
    programme_id: UUID,
    principal: Principal = Depends(require_permission("catalogue.write")),
) -> dict[str, Any]:
    """Bring an archived programme back — to published if it was verified,
    otherwise to draft. Never straight to what students can see on the word of
    the caller alone."""
    _require(principal.tenant_id, programme_id)
    catalogue_repo.set_status(principal.tenant_id, programme_id, "restore")
    return enveloped(_detail(principal.tenant_id, programme_id))


@router.post("/api/programmes/{programme_id}/duplicate",
             status_code=http.HTTP_201_CREATED)
def duplicate_programme(
    programme_id: UUID,
    principal: Principal = Depends(require_permission("catalogue.write")),
) -> dict[str, Any]:
    """Copy a programme with its intakes and requirements, as a new draft.

    Unverified, and not by accident: an agency adding five courses at one
    university copies the first four times, and a copy inheriting the
    original's verification would put four unchecked entries in front of
    students on somebody else's date.
    """
    _require(principal.tenant_id, programme_id)
    new_id = catalogue_repo.duplicate(
        principal.tenant_id, programme_id, principal.user_id
    )
    return enveloped(_detail(principal.tenant_id, new_id))


@router.get("/api/institutions")
def list_institutions(
    principal: Principal = Depends(require_permission("catalogue.read")),
) -> dict[str, Any]:
    """The universities this agency holds programmes for, for the editor's
    picker. Counted so a rename can show what it would affect."""
    return enveloped([
        {**row, "id": str(row["id"])}
        for row in catalogue_repo.list_institutions(principal.tenant_id)
    ])
