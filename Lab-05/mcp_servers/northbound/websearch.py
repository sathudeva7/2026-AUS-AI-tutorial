"""Brave Search — the transport half of the unverified tier.

Split from the tools that use it for the same reason `sources.py` is split
from both: this file talks to the network and nothing else, so it can be
exercised against a fake response without a running MCP server, and the
policy decisions (which hosts, which wording, what the agent is allowed to
say) stay somewhere they can be read without wading through HTTP.

This module does NOT filter by host. `sources.filter_results` does that, and
the tools call it. Keeping the two apart means the enforcement point is one
function that every caller has to go through, rather than a flag on a search
helper that a future caller could forget to set.

Two steps, and the second one matters more than it looks. Brave returns only
titles, URLs and meta-descriptions — roughly one sentence per result. An agent
given that can honestly say "the official page is here" and nothing more,
which is what the first version of this did and why its answers were thin.

So `fetch_page` follows up: it retrieves the pages that survived the host
filter and extracts their text, giving the agent the actual published rules to
summarise rather than a search snippet to paraphrase. Summarising what gov.uk
says, with the link, is a legitimate thing to do — the risk is not the
summarising, it is dropping the CONDITION attached to a figure. "£1,334 per
month" is wrong for most people; "£1,334 per month for courses in London over
6 months" is right. The tool layer and the skill both carry that rule.

The fetch re-checks the host AFTER redirects, which is the only reason it
takes an allowlist rather than trusting that its caller already filtered.
"""

from __future__ import annotations

import html
import re

import httpx

from mcp_servers.northbound import sources

BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search"

# Brave's own ceiling. Asking for more is a 422, not a truncated response.
MAX_COUNT = 20

# Short on purpose. A student is waiting, and a visa question that takes
# fifteen seconds to half-answer is worse than one that escalates promptly.
DEFAULT_TIMEOUT = 8.0


class WebSearchError(RuntimeError):
    """A search that could not be completed. Carries a `remediation` the tool
    layer turns into the agent's next action — the agent cannot catch a
    Python exception, so every failure has to arrive as advice."""

    def __init__(self, detail: str, remediation: str = "escalate") -> None:
        super().__init__(detail)
        self.detail = detail
        self.remediation = remediation


def _normalise(raw: dict) -> dict:
    """One Brave result, reduced to the four fields the agent may use.

    Everything else Brave returns — thumbnails, profiles, ratings, extra
    snippets — is dropped here rather than passed through. A field the agent
    never sees is a field it cannot quote, and the less of a marketing page
    that reaches the model the less there is to mistake for a verified fact.
    """
    return {
        "title": (raw.get("title") or "").strip(),
        "url": (raw.get("url") or "").strip(),
        "description": (raw.get("description") or "").strip(),
        # Brave reports this inconsistently across result types; both keys
        # appear in practice and either is better than implying freshness we
        # do not have.
        "published": (raw.get("page_age") or raw.get("age") or "").strip(),
    }


def search(
    query: str,
    api_key: str,
    count: int = 10,
    timeout: float = DEFAULT_TIMEOUT,
) -> list[dict]:
    """Run one Brave web search. Returns normalised, UNFILTERED results.

    The caller MUST pass the results through `sources.filter_results` before
    letting the agent see them. Nothing here checks a host.

    Raises `WebSearchError` for every failure mode, with a remediation that
    distinguishes "try again" from "this will never work":

      401/403  the key is wrong or unauthorised — retrying will not fix it
      429      rate limited — a retry might, later
      5xx      Brave is down — a retry might
      timeout  the student is waiting; do not hang the turn on a second try
    """
    if not api_key:
        raise WebSearchError(
            "no Brave API key configured", "answer_without_web_sources"
        )
    if not query.strip():
        raise WebSearchError("empty search query", "do_not_act")

    try:
        response = httpx.get(
            BRAVE_ENDPOINT,
            params={
                "q": query.strip(),
                "count": max(1, min(int(count), MAX_COUNT)),
                # Web results only. Brave will otherwise mix in news, videos
                # and FAQ blocks, whose shapes `_normalise` would flatten into
                # something that looks like a page but is not one.
                "result_filter": "web",
                "safesearch": "moderate",
            },
            headers={
                "Accept": "application/json",
                "Accept-Encoding": "gzip",
                "X-Subscription-Token": api_key,
            },
            timeout=timeout,
        )
    except httpx.TimeoutException:
        raise WebSearchError(
            f"Brave search timed out after {timeout}s", "answer_without_web_sources"
        ) from None
    except httpx.HTTPError as exc:
        raise WebSearchError(
            f"could not reach Brave: {type(exc).__name__}",
            "answer_without_web_sources",
        ) from None

    if response.status_code in (401, 403):
        raise WebSearchError(
            "Brave rejected the API key", "answer_without_web_sources"
        )
    if response.status_code == 429:
        raise WebSearchError("Brave rate limit reached", "retry_once_then_escalate")
    if response.status_code >= 500:
        raise WebSearchError(
            f"Brave returned {response.status_code}", "retry_once_then_escalate"
        )
    if response.status_code >= 400:
        raise WebSearchError(
            f"Brave rejected the request ({response.status_code})", "do_not_act"
        )

    try:
        payload = response.json()
    except ValueError:
        raise WebSearchError(
            "Brave returned a response that was not JSON", "retry_once_then_escalate"
        ) from None

    results = ((payload or {}).get("web") or {}).get("results") or []
    return [_normalise(r) for r in results if isinstance(r, dict)]


# ---------------------------------------------------------------------------
# Page fetch — the actual content, not the meta-description
# ---------------------------------------------------------------------------

# Chunks that are never prose. Dropped whole, opening tag to closing tag, so
# their contents don't survive the tag strip below as a wall of CSS or JS.
_DROP_BLOCKS = re.compile(
    r"<(script|style|noscript|svg|head|nav|header|footer|form)\b[^>]*>.*?</\1\s*>",
    re.IGNORECASE | re.DOTALL,
)
# Block-level boundaries become newlines so headings and list items don't run
# together into one sentence — a requirement glued onto the heading above it
# reads as a different rule than it is.
_BLOCK_BREAK = re.compile(
    r"</?(p|div|li|ul|ol|tr|td|th|h[1-6]|br|section|article)\b[^>]*>",
    re.IGNORECASE,
)
_ANY_TAG = re.compile(r"<[^>]+>")
_BLANK_RUN = re.compile(r"\n{3,}")
_SPACE_RUN = re.compile(r"[ \t]{2,}")

# Per page. Enough for a full gov.uk guidance page; capped so three fetches
# cannot crowd the rest of the turn out of the context window.
MAX_PAGE_CHARS = 6000


def extract_text(markup: str) -> str:
    """HTML to readable text. Deliberately small and dependency-free.

    Not a general-purpose reader — it does not need to be. Every page reaching
    this function has already passed the host allowlist, so the input is a
    government or university page, which is clean, semantic HTML. Adding a
    parser dependency to handle hostile markup we have no route to would be
    solving a problem the allowlist already removed.
    """
    text = _DROP_BLOCKS.sub(" ", markup)
    text = _BLOCK_BREAK.sub("\n", text)
    text = _ANY_TAG.sub(" ", text)
    text = html.unescape(text)
    text = _SPACE_RUN.sub(" ", text)
    text = "\n".join(line.strip() for line in text.split("\n"))
    return _BLANK_RUN.sub("\n\n", text).strip()


def fetch_page(
    url: str,
    allowlist: tuple[str, ...] | list[str],
    timeout: float = DEFAULT_TIMEOUT,
    max_chars: int = MAX_PAGE_CHARS,
) -> str:
    """Fetch one allowlisted page and return its readable text, or "".

    RE-CHECKS THE HOST AFTER REDIRECTS. This is the whole reason the function
    takes an allowlist rather than trusting its caller's filtering: an
    allowlisted URL that 302s somewhere else would otherwise walk content in
    through a door the allowlist thought it had shut. The final URL is what
    gets checked, not the one we asked for.

    Returns "" for every failure — a page we could not read is simply a page
    with no content, and the caller still has the title, description and url
    to work with. Never raises: one unreachable page must not lose the two
    that did load.
    """
    if not sources.is_allowed(url, allowlist):
        return ""
    try:
        response = httpx.get(
            url,
            timeout=timeout,
            follow_redirects=True,
            headers={
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "en",
                "User-Agent": "NorthboundEducation/1.0 (student guidance assistant)",
            },
        )
    except httpx.HTTPError:
        return ""
    # The door the allowlist thought it had shut.
    if not sources.is_allowed(str(response.url), allowlist):
        return ""
    if response.status_code != 200:
        return ""
    if "html" not in response.headers.get("content-type", "").lower():
        return ""
    return extract_text(response.text)[:max_chars]


# ---------------------------------------------------------------------------
# Exa — search that already contains the page
# ---------------------------------------------------------------------------

EXA_ENDPOINT = "https://api.exa.ai/search"

# Residual chrome in Exa's extracted text. Nothing like GOV.UK's 6,000-character
# cookie banner, but a course page still opens with a few nav crumbs and the
# agent is told to summarise what it is given.
_CHROME_LINES = (
    "skip to content",
    "skip to main content",
    "skip to navigation",
    "back to top",
    "saved",
    "apply",
    "enquire",
    "menu",
)


def _strip_chrome(text: str) -> str:
    """Drop short navigation lines from the head of an extracted page.

    Only from the HEAD, and only short lines. A page whose body legitimately
    contains the word "Apply" in a sentence keeps it; a standalone nav item
    called "Apply" before the content starts does not. Stops at the first
    real line so nothing is removed from the middle of the prose.
    """
    lines = text.split("\n")
    start = 0
    for i, line in enumerate(lines):
        stripped = line.strip().lstrip("#*[ ").rstrip("]* ").lower()
        if not stripped or (len(stripped) < 30 and stripped in _CHROME_LINES):
            start = i + 1
            continue
        break
    return "\n".join(lines[start:]).strip()


def exa_search(
    query: str,
    api_key: str,
    include_domains: tuple[str, ...] | list[str] = (),
    count: int = 10,
    max_chars: int = 6000,
    timeout: float = 20.0,
) -> tuple[list[dict], float]:
    """Semantic search that returns each page's TEXT. Returns (results, cost).

    Why this exists next to `search()` rather than replacing it: the two web
    tools have different problems. Brave plus a fetch is right for gov.uk —
    keyword-findable, plain HTML. It is wrong for university course pages,
    which are JS-rendered and bot-protected; a plain fetch of one returns
    nothing, which is what it did, and the agent was left naming courses off
    their titles. Exa returns the extracted text in the search response, so
    there is no fetch to be blocked.

    `include_domains` goes to the API as a real parameter — Exa matches it as
    a suffix, so "edu.au" covers jcu.edu.au and uwa.edu.au, the same semantics
    as `sources.host_matches`. That is a genuine filter rather than Brave's
    `site:` hint. It is still NOT the enforcement point: results come back
    unfiltered as far as this module is concerned and the caller must pass
    them through `sources.filter_results`, exactly as with Brave. One
    enforcement point, whatever the transport.

    The second return value is Exa's own reported cost for the call, in USD,
    so a turn can show search spend beside token spend.

    Longer default timeout than Brave: Exa is retrieving and extracting
    pages, not just ranking links.
    """
    if not api_key:
        raise WebSearchError(
            "no Exa API key configured", "answer_without_web_sources"
        )
    if not query.strip():
        raise WebSearchError("empty search query", "do_not_act")

    body: dict = {
        "query": query.strip(),
        "numResults": max(1, min(int(count), 25)),
        "contents": {"text": {"maxCharacters": int(max_chars)}},
    }
    if include_domains:
        body["includeDomains"] = list(include_domains)

    try:
        response = httpx.post(
            EXA_ENDPOINT,
            json=body,
            timeout=timeout,
            headers={"x-api-key": api_key, "Content-Type": "application/json"},
        )
    except httpx.TimeoutException:
        raise WebSearchError(
            f"Exa search timed out after {timeout}s", "answer_without_web_sources"
        ) from None
    except httpx.HTTPError as exc:
        raise WebSearchError(
            f"could not reach Exa: {type(exc).__name__}",
            "answer_without_web_sources",
        ) from None

    if response.status_code in (401, 403):
        raise WebSearchError("Exa rejected the API key", "answer_without_web_sources")
    if response.status_code == 429:
        raise WebSearchError("Exa rate limit reached", "retry_once_then_escalate")
    if response.status_code >= 500:
        raise WebSearchError(
            f"Exa returned {response.status_code}", "retry_once_then_escalate"
        )
    if response.status_code >= 400:
        raise WebSearchError(
            f"Exa rejected the request ({response.status_code})", "do_not_act"
        )

    try:
        payload = response.json()
    except ValueError:
        raise WebSearchError(
            "Exa returned a response that was not JSON", "retry_once_then_escalate"
        ) from None

    cost = float(((payload or {}).get("costDollars") or {}).get("total", 0.0) or 0.0)
    out: list[dict] = []
    for raw in (payload or {}).get("results") or []:
        if not isinstance(raw, dict):
            continue
        out.append(
            {
                "title": (raw.get("title") or "").strip(),
                "url": (raw.get("url") or "").strip(),
                # Same key the Brave path uses, so `filter_results`, the
                # citation hooks and the trace summariser need no branch.
                "description": "",
                "published": (raw.get("publishedDate") or "").strip(),
                "content": _strip_chrome(raw.get("text") or ""),
            }
        )
    return out, cost
