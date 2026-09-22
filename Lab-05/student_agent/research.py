"""The fallback reader, for pages that refuse to be fetched.

A large share of UK universities sit behind Cloudflare's bot challenge.
Kingston and Hertfordshire both answer a plain request with 403 and the
words "Just a moment…", and Exa's crawler gets a 500 from them — so
`exa.fetch_contents` has nothing to hand `extraction.extract`, and the whole
primary path stops at the first step. Our own headless browser would not
help: that challenge is aimed at headless browsers specifically.

Exa's AGENT reads them. It is a different product from `/contents`: given a
url it researches the topic rather than fetching the page, and it comes back
with the fields already extracted.

WHY THIS IS THE FALLBACK AND NOT THE READER. Measured against the same two
pages the primary path handles:

    primary   5–7s     ~$0.002    quote is a verified substring of ONE page
    agent    19–52s    $0.03–0.14  quote is the agent's wording, uncheckable

Fifteen to seventy times the cost and three to ten times the wait, for pages
the cheap path already reads well. And the evidence is weaker in a way that
matters here: we never receive the page text, so there is nothing to check a
quote against. `extraction.verify` cannot run.

THE PART TO WATCH. The agent SEARCHES — five searches on one observed run —
so an answer can come from somewhere other than the url that was pasted. On
a Kingston run it returned the course duration cited to prospects.ac.uk, a
third-party listings site. That is a real claim and it may well be correct,
but it is not what a counsellor pasting a Kingston link believes they are
confirming. `grounding` gives a citation per field, so the check is possible
— see `_host_of` below, which puts the citing host in `section` where the
form already shows it.

Everything from here is `unclear`, never `quoted`. Nothing read this way can
be presented as something a person could check on the page in front of them.
"""

from __future__ import annotations

import logging
import os
from urllib.parse import urlsplit

from exa import ExaError
from extraction import (
    Extraction,
    ExtractedFields,
    ProposedIntake,
    RequirementPoint,
    Sourced,
)

log = logging.getLogger(__name__)

#: Past this the agent has been running long enough that the counsellor has
#: given up. It bills for compute either way, so waiting longer buys nothing.
#:
#: The SDK's own default is an HOUR, which is not a timeout so much as the
#: absence of one — a blocked page would hold a request open until something
#: else gave out.
DEFAULT_TIMEOUT = 120.0

#: Enough to read one page, not enough to research a topic.
#:
#: The cost control, and the only one available. Three runs on the same kind
#: of page cost $0.0332, $0.0976 and $0.1392 at the default effort — a
#: four-fold spread for one job, because an agent decides for itself how
#: much searching to do. `budget.maxCostDollars` would be the direct answer
#: and does not fit: the API refuses anything under $1, and accepts it only
#: for the metered efforts, so the smallest cap available is roughly ten
#: times what a run should cost. Capping the WORK is what is left.
EFFORT = "low"

#: What the agent is asked for. Flat strings, because the agent answers in
#: prose and `services/pages.py` converts — the same division the primary
#: path uses, so both producers hand the pipeline the same kind of value.
#:
#: `*_source` fields sit beside their value deliberately. The grounding list
#: gives a citation per field too, and asking for the sentence as well means
#: the counsellor sees WHAT was read and not only WHERE from.
OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string", "description": "The programme's full title."},
        "institution": {"type": "string", "description": "The university's full name."},
        "country": {"type": "string", "description": "The country it is taught in."},
        "city": {"type": "string", "description": "The city it is taught in."},
        "level": {"type": "string", "description": "The award, e.g. MSc, BA (Hons)."},
        "field": {"type": "string", "description": "The subject area."},
        "tuition_per_year": {
            "type": "string",
            "description": (
                "The INTERNATIONAL tuition for one year, as written. Empty "
                "string if the page gives only a home fee or no fee."
            ),
        },
        "currency": {"type": "string", "description": "Three-letter code, e.g. GBP."},
        "duration_months": {"type": "string", "description": "Full-time length in months."},
        "intake_month": {"type": "string", "description": "The start month, e.g. September."},
        "intake_year": {"type": "string", "description": "The start year, if stated."},
        "application_deadline": {"type": "string", "description": "The deadline, as written."},
        "entry_requirements": {
            "type": "string",
            "description": (
                "Every entry requirement, one per line. Include the ones "
                "with no number — a portfolio, references, work experience."
            ),
        },
    },
}

#: `structured` key -> the `ExtractedFields` name it fills.
_FIELD_KEYS = (
    "name", "institution", "country", "city", "level", "field",
    "tuition_per_year", "currency", "duration_months",
)


def _host_of(url: str) -> str | None:
    try:
        return (urlsplit(url).hostname or "").replace("www.", "").lower() or None
    except ValueError:
        return None


def _citations(grounding) -> dict[str, str]:
    """`structured.<field>` -> the host that was cited for it.

    Exa returns grounding as a list of per-field entries, each carrying one
    or more citations. Only the first is kept: a value assembled from two
    sources is not a value with a source, and showing the first host is
    honest about which page to go and look at.
    """
    found: dict[str, str] = {}
    for entry in grounding or []:
        field = getattr(entry, "field", None) or ""
        name = field.split(".")[-1]
        for citation in getattr(entry, "citations", None) or []:
            host = _host_of(getattr(citation, "url", "") or "")
            if host:
                found[name] = host
                break
    return found


def _sourced(value: str, asked_host: str | None, cited_host: str | None) -> Sourced:
    """One researched value, always `unclear`, attributed to its host.

    NEVER `quoted`. A quote is a promise that these words are on that page,
    and this path cannot keep it — there is no page text here to check
    against. Calling it quoted would launder a researched figure into a
    verified one, which is the failure the whole design is arranged around.

    `section` carries the citing host, and the form already renders it after
    the quote. Where that host is not the one the counsellor pasted — the
    observed case is a duration cited to prospects.ac.uk from a Kingston url
    — the label says so in the one place they are already looking.
    """
    off_site = bool(cited_host and asked_host and cited_host != asked_host)
    return Sourced(
        value=value.strip() or None,
        evidence="unclear",
        quote=f"Researched from {cited_host}" if cited_host else "Researched, not quoted",
        section=f"⚠ {cited_host}, not {asked_host}" if off_site else cited_host,
    )


def _absent() -> Sourced:
    return Sourced(value=None, evidence="absent", quote=None, section=None)


def research(url: str, *, timeout: float = DEFAULT_TIMEOUT) -> Extraction:
    """Read a page the fetcher could not, through Exa's agent.

    Returns the same `Extraction` the primary path produces, so everything
    downstream — `services.pages.normalise`, the route, the form — is
    unchanged. Two producers, one shape: the second implementation is what
    makes that a seam rather than a coincidence.
    """
    key = os.getenv("EXA_API_KEY", "").strip()
    if not key:
        raise ExaError("EXA_API_KEY is not set.")
    try:
        from exa_py import Exa
    except ImportError as exc:  # pragma: no cover - a deployment problem
        raise ExaError("the research reader is not installed") from exc

    asked_host = _host_of(url)
    try:
        client = Exa(api_key=key)
        run = client.agent.runs.create(
            query=url,
            output_schema=OUTPUT_SCHEMA,
            effort=EFFORT,
        )
        done = client.agent.runs.poll_until_finished(
            run.id, timeout_ms=int(timeout * 1000)
        )
    except Exception as exc:
        # The SDK raises its own exception types and adds to them between
        # versions. A fallback that crashed the request would be worse than
        # the failure it was reached for.
        raise ExaError(
            f"could not research {url}: {type(exc).__name__}", retryable=True
        ) from exc

    output = getattr(done, "output", None)
    data = (getattr(output, "structured", None) or {}) if output else {}
    if not data:
        raise ExaError(f"the research reader found nothing at {url}")

    cited = _citations(getattr(output, "grounding", None))
    fields = ExtractedFields(
        **{
            name: (
                _sourced(str(data[name]), asked_host, cited.get(name))
                if str(data.get(name) or "").strip()
                else _absent()
            )
            for name in _FIELD_KEYS
        }
    )

    intakes: list[ProposedIntake] = []
    month = str(data.get("intake_month") or "").strip()
    if month:
        year = str(data.get("intake_year") or "").strip()
        host = cited.get("intake_month") or cited.get("intake_year")
        intakes.append(
            ProposedIntake(
                month=month,
                # Kept when the agent gave one. The primary path demands the
                # year appear in its own quote; there is no quote to test
                # here, so the year travels as `unclear` like everything else
                # and a person confirms it.
                year=year or None,
                application_deadline=str(data.get("application_deadline") or "").strip() or None,
                evidence="unclear",
                quote=f"Researched from {host}" if host else "Researched, not quoted",
                section=host,
            )
        )

    host = cited.get("entry_requirements")
    requirements = [
        RequirementPoint(
            text=line.strip(" -•\t"),
            quote=line.strip(" -•\t"),
            section=f"Researched from {host}" if host else "Researched, not quoted",
            evidence="unclear",
        )
        for line in str(data.get("entry_requirements") or "").splitlines()
        if line.strip(" -•\t")
    ]

    cost = getattr(done, "cost_dollars", None)
    log.info(
        "researched %s (agent fallback, $%s)",
        url, getattr(cost, "total", cost),
    )
    return Extraction(
        fields=fields,
        intakes=intakes,
        requirements=requirements[:25],
        prompt_tokens=0,
        completion_tokens=0,
    )
