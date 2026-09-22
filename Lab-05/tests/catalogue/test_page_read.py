"""POST /api/programmes/read — the course page a programme is filled from.

Both paid calls are faked here — Exa's fetch and the model's reading. Not
for speed: a suite that calls a paid third party gives a different answer on
a bad wifi day, and the thing worth asserting is what this endpoint does
with each ANSWER, which is ours to choose. `tests/` still runs against real
Postgres; it is the outside services that are stubbed, not our own layer.

The extraction stub is AUTOUSE. A test that forgot it would reach OpenAI for
real, and a test suite that can spend money by omission is one that will.

No cross-tenant test, and its absence is deliberate — the usual one asks for
agency B's id and expects 404, and this endpoint addresses no row. What
stands in for it is the permission test: the page reader is behind
`catalogue.write`, so a counsellor cannot spend the agency's credits.
"""

from __future__ import annotations

import pytest

import api.catalogue as catalogue_api
import extraction
from exa import ExaError, PageContents
from extraction import (
    Extraction,
    ExtractedFields,
    ExtractionError,
    PageTooLong,
    ProposedIntake,
    RequirementPoint,
    Sourced,
)


PAGE = PageContents(
    url="https://www.bristol.ac.uk/study/postgraduate/taught/msc-data-science/",
    title="MSc Data Science | Study at Bristol",
    text="MSc Data Science\nOne year full-time\nUK: £19,600\nInternational: £37,900",
    cost=0.001,
)


def _sourced(value):
    return Sourced(value=value, evidence="quoted", quote="q", section=None)


#: What the reader returns for PAGE — RAW, as the page words it. The route
#: normalises it, and several tests below are about that conversion having
#: happened by the time it reaches the client.
READING = Extraction(
    fields=ExtractedFields(
        **{
            **{n: _sourced(None) for n in ExtractedFields.model_fields},
            "name": _sourced("MSc Data Science"),
            "level": _sourced("MSc"),
            "country": _sourced("United Kingdom"),
            "tuition_per_year": _sourced("£37,900"),
            "currency": _sourced("GBP"),
            "duration_months": _sourced("12"),
        }
    ),
    intakes=[
        ProposedIntake(
            month="September", year="2027",
            application_deadline="12 August 2027",
            evidence="quoted", quote="q", section=None,
        )
    ],
    requirements=[
        RequirementPoint(
            text="A 2:1 honours degree", quote="q",
            section="Entry requirements", evidence="quoted",
        )
    ],
    prompt_tokens=2597,
    completion_tokens=303,
)


@pytest.fixture
def reads(monkeypatch):
    """Make the reader answer however a test needs, without a network call.

    Patches the name as `api.catalogue` imported it. Patching `exa.fetch_
    contents` instead would not be seen: the route bound the function at
    import time.
    """

    def _install(result=PAGE, raises: Exception | None = None):
        calls: list[str] = []

        def fake(url, **kwargs):
            calls.append(url)
            if raises is not None:
                raise raises
            return result

        monkeypatch.setattr(catalogue_api, "fetch_contents", fake)
        return calls

    return _install


@pytest.fixture(autouse=True)
def extracts(monkeypatch):
    """The model, faked — and AUTOUSE, deliberately.

    A test that forgot to patch this would call OpenAI for real: slower, paid
    for, and answering differently on a bad day. Making it automatic means
    forgetting is not possible rather than merely discouraged.

    Call it to change the answer: `extracts(raises=...)`.
    """
    state: dict = {"result": READING, "raises": None, "calls": []}

    def fake(page_text, **kwargs):
        state["calls"].append(page_text)
        if state["raises"] is not None:
            raise state["raises"]
        return state["result"]

    monkeypatch.setattr(extraction, "extract", fake)

    def _set(result=None, raises=None):
        if result is not None:
            state["result"] = result
        state["raises"] = raises
        return state["calls"]

    _set.calls = state["calls"]
    return _set


def read(client, url="https://www.bristol.ac.uk/study/msc-data-science/"):
    return client.post("/api/programmes/read", json={"url": url})


# ---------------------------------------------------------------------------
# The happy path
# ---------------------------------------------------------------------------

def test_a_page_comes_back_as_text(client, seed, reads):
    reads()
    response = read(client)
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["title"] == "MSc Data Science | Study at Bristol"
    assert "£19,600" in data["text"]


def test_the_url_returned_is_where_the_fetch_ENDED(client, seed, reads):
    """Course pages redirect to the current year's entry. The page that was
    read is the one worth recording, not the one that was asked for."""
    reads()
    data = read(client, "https://www.bristol.ac.uk/old-link").json()["data"]
    assert data["url"] == PAGE.url


def test_the_response_is_enveloped(client, seed, reads):
    """`new_router` should be wrapping this. A bare body here means the route
    was registered under a plain APIRouter and every client parse breaks."""
    reads()
    body = read(client).json()
    assert body["success"] is True
    assert set(body["data"]) == {
        "url", "title", "text", "fields", "intakes", "requirements",
        "researched",
    }


def test_the_cost_is_not_sent_to_the_client(client, seed, reads):
    """What the agency spends is an operator's business, not a counsellor's.
    It is logged against the tenant instead."""
    reads()
    assert "cost" not in read(client).json()["data"]


# ---------------------------------------------------------------------------
# Refusals the counsellor can act on
# ---------------------------------------------------------------------------

def test_a_dead_page_names_the_url_field(client, seed, reads):
    """Observed live: Exa answers 200 with no content and CRAWL_NOT_FOUND.
    That has to reach the box the counsellor can fix, which means `details`
    — without it the client renders a whole-page failure."""
    reads(raises=ExaError("could not read …: CRAWL_NOT_FOUND (page returned 404)"))
    response = read(client)
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "url"


def test_the_refusal_says_why(client, seed, reads):
    reads(raises=ExaError("could not read …: CRAWL_NOT_FOUND (page returned 404)"))
    issue = read(client).json()["error"]["details"][0]["issue"]
    assert "CRAWL_NOT_FOUND" in issue


def test_something_that_is_not_a_url_is_refused(client, seed, reads):
    reads(raises=ExaError("not an http(s) url: 'hello world'"))
    response = read(client, "hello world")
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "url"


# ---------------------------------------------------------------------------
# Refusals the counsellor cannot
# ---------------------------------------------------------------------------

def test_a_reader_outage_is_502_not_422(client, seed, reads):
    """502 because the third party failed, not us — and a separate code
    because the offer is "try again", which is not the offer a bad link
    gets."""
    reads(raises=ExaError("Exa rate limit reached", retryable=True))
    response = read(client)
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "PAGE_READER_UNAVAILABLE"


def test_an_outage_does_not_blame_the_url(client, seed, reads):
    """No `details`, so the client raises a page-level error rather than
    marking a link wrong that is perfectly good."""
    reads(raises=ExaError("Exa timed out after 60s", retryable=True))
    assert not read(client).json()["error"].get("details")


# ---------------------------------------------------------------------------
# Who may spend the credits
# ---------------------------------------------------------------------------

def test_a_counsellor_cannot_read_pages(app, client, seed, reads):
    """Stands in for the cross-tenant test. Every read costs the agency
    money, so it sits behind the key that lets you save the result."""
    from auth import Principal, require_auth

    reads()
    app.dependency_overrides[require_auth] = lambda: Principal(
        clerk_user_id="ck_zoe",
        tenant_id=seed["tenant_a"],
        user_id=seed["zoe"],
        role="counsellor",
        grants=frozenset(),
    )
    response = read(client)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "MISSING_PERMISSION"


def test_a_signed_out_caller_is_refused(anon_client, seed, reads):
    reads()
    assert anon_client.post(
        "/api/programmes/read", json={"url": "https://example.ac.uk/x"}
    ).status_code == 401


def test_nothing_is_fetched_when_the_caller_is_refused(anon_client, seed, reads):
    """The permission check must come BEFORE the money is spent."""
    calls = reads()
    anon_client.post("/api/programmes/read", json={"url": "https://example.ac.uk/x"})
    assert calls == []


# ---------------------------------------------------------------------------
# What the reading turns into
# ---------------------------------------------------------------------------

def test_the_fields_arrive_converted(client, seed, reads):
    """The route's job is not to forward what the model said. `MSc` is not a
    level this catalogue stores and `United Kingdom` is not a country code —
    `services/pages.py` has to have run before any of it reaches a form."""
    reads()
    fields = read(client).json()["data"]["fields"]
    assert fields["level"]["value"] == "masters"
    assert fields["country"]["value"] == "GB"
    assert fields["tuition_per_year"]["value"] == "37900"


def test_every_field_carries_its_quote(client, seed, reads):
    """Without it the counsellor is confirming a model's word for a fee, and
    the review step is theatre."""
    reads()
    for field in read(client).json()["data"]["fields"].values():
        assert set(field) == {"value", "evidence", "quote", "section"}


def test_an_intake_arrives_in_the_shape_the_column_stores(client, seed, reads):
    reads()
    intake = read(client).json()["data"]["intakes"][0]
    assert intake["intake"] == "2027-09"
    assert intake["deadline_date"] == "2027-08-12"


def test_an_intake_keeps_what_the_page_said(client, seed, reads):
    """Both halves travel: the screen shows "September" beside "2027-09" so a
    person can check the conversion rather than trust it."""
    reads()
    intake = read(client).json()["data"]["intakes"][0]
    assert (intake["month"], intake["year"]) == ("September", "2027")
    assert intake["application_deadline"] == "12 August 2027"


def test_requirements_arrive_as_free_text(client, seed, reads):
    """No fact_key, no rule — those come with the rules pass. A requirement
    that cannot be evaluated is still one a counsellor needs to read."""
    reads()
    requirement = read(client).json()["data"]["requirements"][0]
    assert requirement["text"] == "A 2:1 honours degree"
    assert "fact_key" not in requirement
    assert "rule" not in requirement


def test_the_page_text_still_comes_back(client, seed, reads):
    """Kept while the prompt is being tuned: a thin extraction has to be
    checkable against what was actually read."""
    reads()
    assert "£37,900" in read(client).json()["data"]["text"]


# ---------------------------------------------------------------------------
# When the reading fails
# ---------------------------------------------------------------------------

def test_a_page_too_long_is_blamed_on_the_url(client, seed, reads, extracts):
    """The one extraction failure a counsellor can act on — they pointed at a
    prospectus. So it lands on the field they can change, with `details`."""
    reads()
    extracts(raises=PageTooLong("too long"))
    response = read(client)
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "url"


def test_any_other_reader_failure_is_502(client, seed, reads, extracts):
    """Our key, our quota, our outage. None of it is a fact about the link,
    so it must not be marked against it."""
    reads()
    extracts(raises=ExtractionError("the reader rejected the API key"))
    response = read(client)
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "PAGE_READER_UNAVAILABLE"
    assert not response.json()["error"].get("details")


def test_a_rate_limited_reader_is_502(client, seed, reads, extracts):
    reads()
    extracts(raises=ExtractionError("rate limited", retryable=True))
    assert read(client).status_code == 502


def test_nothing_is_read_when_the_fetch_failed(client, seed, reads, extracts):
    """Two paid calls, in order. A dead link must not also buy an extraction
    of the empty string."""
    reads(raises=ExaError("could not read …: CRAWL_NOT_FOUND"))
    read(client)
    assert extracts.calls == []


# ---------------------------------------------------------------------------
# The fallback, for pages that refuse to be fetched
# ---------------------------------------------------------------------------
#
# Cloudflare-protected universities answer Exa's crawler with a 500, so the
# primary path has no text to read. Exa's agent gets through. It costs 15-70x
# and its quotes cannot be checked against anything, so it runs here and
# nowhere else — and which universities need it changes week to week, which
# is why the choice is made from the error rather than from a list.


@pytest.fixture
def researches(monkeypatch):
    """The agent fallback, faked. Autouse is not needed — nothing reaches it
    unless a test makes the primary path fail with a page status."""

    def _install(result=READING, raises: Exception | None = None):
        calls: list[str] = []

        def fake(url, **kwargs):
            calls.append(url)
            if raises is not None:
                raise raises
            return result

        monkeypatch.setattr(catalogue_api.research, "research", fake)
        return calls

    return _install


def blocked(status=500):
    """What a bot challenge looks like by the time it reaches the route."""
    return ExaError(
        f"could not read …: CRAWL_UNKNOWN_ERROR (page returned {status})",
        page_status=status,
    )


def test_a_blocked_page_falls_back_to_research(client, seed, reads, researches):
    reads(raises=blocked())
    calls = researches()
    response = read(client)
    assert response.status_code == 200
    assert calls, "the fallback never ran"


def test_a_researched_reading_says_so(client, seed, reads, researches):
    """The flag the screen needs. Without it a researched reading looks
    exactly like a quoted one, and a counsellor confirms the weaker claim
    believing it is the stronger."""
    reads(raises=blocked())
    researches()
    assert read(client).json()["data"]["researched"] is True


def test_an_ordinary_read_is_not_marked_researched(client, seed, reads):
    reads()
    assert read(client).json()["data"]["researched"] is False


def test_a_dead_page_is_not_researched(client, seed, reads, researches):
    """404 is a link that will never work however it is read. An agent run
    costs thirty times the fetch, and spending it to confirm a typo is money
    for nothing."""
    reads(raises=ExaError("could not read …: CRAWL_NOT_FOUND", page_status=404))
    calls = researches()
    response = read(client)
    assert response.status_code == 422
    assert calls == []


def test_a_url_that_is_not_a_url_is_not_researched(client, seed, reads, researches):
    """No page status at all means the failure was ours, before any page was
    reached. There is nothing for an agent to research."""
    reads(raises=ExaError("not an http(s) url: 'hello world'"))
    calls = researches()
    assert read(client, "hello world").status_code == 422
    assert calls == []


def test_a_retryable_failure_is_not_researched(client, seed, reads, researches):
    """Exa being rate limited says nothing about the page. Retrying through
    the expensive door would turn a wait into a bill."""
    reads(raises=ExaError("Exa rate limit reached", retryable=True))
    calls = researches()
    assert read(client).status_code == 502
    assert calls == []


def test_when_research_also_fails_the_first_reason_is_given(
    client, seed, reads, researches
):
    """The counsellor's next move is the same either way — check the link or
    type it in — and "the page blocks readers" is the fact. That our recovery
    also failed is a detail of our plumbing."""
    reads(raises=blocked())
    researches(raises=ExaError("the research reader found nothing"))
    response = read(client)
    assert response.status_code == 422
    issue = response.json()["error"]["details"][0]["issue"]
    assert "CRAWL_UNKNOWN_ERROR" in issue


def test_the_model_is_never_called_on_the_research_path(
    client, seed, reads, researches, extracts
):
    """The agent returns fields, not text. Running the extractor over nothing
    would be a second paid call for an empty string."""
    reads(raises=blocked())
    researches()
    read(client)
    assert extracts.calls == []
