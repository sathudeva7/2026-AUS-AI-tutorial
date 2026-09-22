"""Calls to Exa's /contents API — one known URL in, that page's text out.

Separate from `api/catalogue.py` for the same reason `clerk.py` is separate
from `auth.py`: a module that decides what a counsellor may do should not
also be the place the HTTP client lives.

This is transport and nothing else. It does not decide WHICH pages may be
read — that is a policy question, and this codebase keeps policy apart from
the network layer (see `mcp_servers/northbound/sources.py`, which filters by
host for the agent's web tools). The caller applies the rule; this file
fetches what it is given.

WHY EXA AND NOT A FETCH. The obvious implementation is httpx.get plus an HTML
parser, and it does not work here. University course pages build themselves
with JavaScript: the Bristol MSc Data Science page returns 200 and 99KB of
markup containing no fee at all, because "£19,600" arrives afterwards. A
plain fetch therefore succeeds and silently omits the figures the reader
exists to collect, which is worse than failing. Exa renders the page before
extracting, and returns the fees.

DELIBERATELY NOT SHARED with `mcp_servers/northbound/websearch.py`, which
also talks to Exa. That module runs inside the agent's MCP server — a
separate PROCESS, started as `python -m mcp_servers.northbound` — and this
one runs in the web API. Neither can import the other without the wrong
dependency appearing between them, and the two uses differ more than they
look: the agent asks a question and ranks answers, this fetches one page
somebody already chose. If a third caller ever appears, that is the moment
to promote a shared client to the lab root, not before.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

import httpx

log = logging.getLogger(__name__)

ENDPOINT = "https://api.exa.ai/contents"
ROOT = Path(__file__).resolve().parent.parent

#: Sixty seconds, where the rest of the codebase uses ten or twenty.
#:
#: `livecrawl` means Exa loads the page in a real browser before answering, so
#: this waits on a render, not a lookup. A heavy course page measured well
#: past twenty seconds; a timeout there would report "could not read" for
#: pages that read perfectly well given a moment.
DEFAULT_TIMEOUT = 60.0

#: Enough for a long course page. Leeds came back 16,465 characters with fees,
#: duration, IELTS and start dates all present, so this leaves real headroom.
DEFAULT_MAX_CHARS = 30_000

#: Always re-crawl; never accept Exa's stored copy.
#:
#: Not a performance knob. Exa's cache can be weeks old, and the values this
#: feature exists to collect are tuition and deadlines — the two that change
#: and the two a student acts on. A stale fee presented as the current one is
#: precisely the failure the verified catalogue exists to prevent, and it
#: would arrive wearing a quote from the page, which is what makes it
#: dangerous rather than merely wrong.
LIVECRAWL = "always"


class ExaError(RuntimeError):
    """Exa refused, could not read the page, or was unreachable.

    `retryable` separates "try again in a moment" (rate limit, Exa down,
    timeout) from "this will fail identically next time" (dead page, bad key,
    malformed URL). The caller needs that distinction: one of them justifies
    showing a retry button and the other makes it a lie.
    """

    def __init__(
        self,
        message: str,
        *,
        retryable: bool = False,
        page_status: int | None = None,
    ) -> None:
        super().__init__(message)
        self.retryable = retryable
        #: The status the PAGE gave Exa's crawler, where it gave one.
        #:
        #: Carried because 404 and 403/500 are different problems wearing one
        #: error. A 404 is a link that will never work and nothing else is
        #: worth trying; a bot-block is a page that exists and is readable by
        #: other means. The caller decides whether to spend money on the
        #: other means, and it cannot decide that from a sentence.
        self.page_status = page_status


@dataclass(frozen=True)
class PageContents:
    """One page, as Exa read it.

    `url` is what Exa ended up at, which is not always what was asked for —
    course pages redirect to the current year's entry. The caller records this
    one, because it is the page the text actually came from.
    """

    url: str
    title: str | None
    text: str
    #: USD for this call. Returned rather than logged and dropped because the
    #: feature spends money per click and somebody will ask what it costs.
    cost: float


def _api_key() -> str:
    """Read at call time, not import time.

    A missing key must be an error on the one request that needed it, not a
    crash at startup: the console has to keep serving the rest of the
    catalogue when the page reader is unconfigured.
    """
    key = os.getenv("EXA_API_KEY", "").strip()
    if not key:
        raise ExaError(f"EXA_API_KEY is not set. Add it to {ROOT / '.env'}")
    return key


def _validated(url: str) -> str:
    """Reject what is obviously not a web page before paying to find out."""
    candidate = (url or "").strip()
    parts = urlsplit(candidate)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ExaError(f"not an http(s) url: {candidate[:120]!r}")
    return candidate


def _refusal(payload: dict) -> tuple[str, int | None]:
    """Why Exa returned no content, in words worth showing someone.

    Exa reports per-URL failures in `statuses`, NOT in the HTTP status — see
    `fetch_contents`. The entry carries the page's own status code and a tag
    such as CRAWL_NOT_FOUND; both are more use than "it did not work".
    """
    entries = [s for s in payload.get("statuses") or [] if s.get("status") == "error"]
    # One URL goes out, so the first failure is ours. Matching on `id` as well
    # would only matter if Exa echoed a different string than it was sent, and
    # then it would discard the one reason we have.
    for status in entries:
        error = status.get("error") or {}
        tag = error.get("tag") or "unknown"
        code = error.get("httpStatusCode")
        return f"{tag}{f' (page returned {code})' if code else ''}", code
    return "Exa returned no content and gave no reason", None


def fetch_contents(
    url: str,
    *,
    max_chars: int = DEFAULT_MAX_CHARS,
    timeout: float = DEFAULT_TIMEOUT,
) -> PageContents:
    """Fetch one page's text through Exa. Raises `ExaError` on any failure.

    Never returns an empty-handed success. A page that could not be read is
    an error with a reason, because the caller's next move is to fill a form
    from this text — and a form filled from "" is a blank screen with no
    explanation, which reads to a counsellor as the feature being broken.

    THE TRAP, and it is easy to miss: a page Exa could not read still comes
    back as HTTP 200. The body carries an empty `results` list and the reason
    sits in `statuses`. Checking the status code alone passes straight over
    it. Observed live against a withdrawn Manchester course page: 200 OK,
    results [], CRAWL_NOT_FOUND.
    """
    target = _validated(url)
    key = _api_key()

    body = {
        "urls": [target],
        "text": {"maxCharacters": int(max_chars)},
        "livecrawl": LIVECRAWL,
    }

    try:
        response = httpx.post(
            ENDPOINT,
            json=body,
            timeout=timeout,
            headers={"x-api-key": key, "Content-Type": "application/json"},
        )
    except httpx.TimeoutException:
        # Worth its own wording: a render that outran the clock may well
        # succeed on a second attempt, where an unreachable host will not.
        raise ExaError(
            f"Exa timed out after {timeout:g}s", retryable=True
        ) from None
    except httpx.HTTPError as exc:
        raise ExaError(f"could not reach Exa: {type(exc).__name__}") from None

    if response.status_code in (401, 403):
        raise ExaError("Exa rejected the API key")
    if response.status_code == 429:
        raise ExaError("Exa rate limit reached", retryable=True)
    if response.status_code >= 500:
        raise ExaError(f"Exa returned {response.status_code}", retryable=True)
    if response.status_code >= 400:
        raise ExaError(f"Exa rejected the request ({response.status_code})")

    try:
        payload = response.json()
    except ValueError:
        raise ExaError("Exa returned a response that was not JSON", retryable=True) from None
    if not isinstance(payload, dict):
        raise ExaError("Exa returned a response that was not an object")

    cost = float((payload.get("costDollars") or {}).get("total", 0.0) or 0.0)

    results = payload.get("results") or []
    if not results:
        reason, page_status = _refusal(payload)
        raise ExaError(f"could not read {target}: {reason}", page_status=page_status)

    first = results[0] or {}
    text = (first.get("text") or "").strip()
    if not text:
        # A result carrying no text is a page we did not read. Treating it as
        # success hands the caller an empty extraction that looks like a page
        # which genuinely said nothing.
        reason, page_status = _refusal(payload)
        raise ExaError(f"could not read {target}: {reason}", page_status=page_status)

    log.info("exa read %s (%d chars, $%.4f)", target, len(text), cost)
    return PageContents(
        # Exa's own `url` where it has one: course pages redirect to the
        # current intake, and the page read is the page to record.
        url=first.get("url") or target,
        title=first.get("title") or None,
        text=text,
        cost=cost,
    )
