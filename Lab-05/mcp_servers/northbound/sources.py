"""Source allowlists — the safety boundary for anything fetched from the web.

The agent's whole design rests on one rule: it may not state a fact that did
not come from a verified source. Adding a web search puts a hole in that,
because a search result IS a tool result — the letter of the rule survives
while the point of it does not.

This module is where the hole gets closed. Every web result is filtered by
its HOST before the agent sees it. Not by the prompt, not by asking the
search engine nicely, not by a parameter we pass to a vendor: by a check in
our own code, on our side of the boundary.

That distinction matters more with Brave than it would have with Tavily.
Tavily takes a structured `include_domains` argument; Brave takes `site:`
operators inside the query string, and a query operator is a REQUEST, not a
guarantee. So `site_query()` builds the operators (they help relevance) and
`filter_results()` enforces the boundary (it is what actually holds). If the
search engine ignores the operators entirely, the allowlist still works.

Two separate lists, because the two features have different risk profiles:

- `visa_sources(country)` — official government domains only. Visa
  information is regulated advice in most jurisdictions, so the agent may
  relay only what a government publishes, attributed and linked, and the
  escalation still fires either way.
- `programme_sources(country)` — universities and official study portals.
  Used to DISCOVER programmes missing from the catalogue, never to
  recommend them: a scraped programme has no `Requirement` rows, so its
  eligibility is not merely unknown, it is uncomputable.

Both lists are deliberately short and curated. A real deployment would
maintain them per tenant; the failure mode of a list that is too small is a
student told "I couldn't find an official source", which is safe. The
failure mode of one that is too broad is a student acting on a diploma
mill's marketing page, which is not.
"""

from __future__ import annotations

import os
from urllib.parse import urlsplit

# ---------------------------------------------------------------------------
# THE SWITCH
# ---------------------------------------------------------------------------
#
# False turns the host allowlist OFF: the whole public web is searchable and
# every result reaches the agent. The lists below stay exactly as they are —
# they are simply not consulted — so flipping this back is one edit, and the
# two states can be demonstrated side by side.
#
# This is a deliberate teaching switch, not a config knob to leave alone.
# What actually changes when it is False:
#
#   - Programme discovery searches the open web. Expect agency marketing,
#     ranking farms, and pages that look like a university and are not.
#   - Visa research can return a forum post or a migration agent's blog, and
#     the agent has no way to tell it from gov.uk. THIS is the dangerous one:
#     the whole reason visa answers are relayable is that the source is a
#     government publisher. Remove that and "the official page says X"
#     becomes a claim about a stranger's website.
#   - `fetch_page` will follow a redirect anywhere.
#
# The tools' own result notes change with this flag, so the agent is never
# told its sources were vetted when they were not. Scheme checking stays on
# either way — refusing `javascript:` is not a domain question.
#
# Override per-process with NORTHBOUND_ENFORCE_ALLOWLIST=1 / 0.
ENFORCE_HOST_ALLOWLIST = os.environ.get(
    "NORTHBOUND_ENFORCE_ALLOWLIST", "0"
).strip().lower() in ("1", "true", "yes", "on")


def enforcement_enabled() -> bool:
    """Whether host filtering is live. Callers that build provider-side
    domain filters (Exa's includeDomains, Brave's site: operators) check this
    so they don't quietly re-impose the restriction the switch turned off."""
    return ENFORCE_HOST_ALLOWLIST

# ---------------------------------------------------------------------------
# The lists
# ---------------------------------------------------------------------------

# Government domains, by the student's target country. Subdomains are
# included automatically by the boundary-aware match below, so `gov.uk`
# covers `www.gov.uk` and `homeoffice.gov.uk` without listing each.
VISA_DOMAINS: dict[str, tuple[str, ...]] = {
    "uk": ("gov.uk",),
    "australia": (
        "homeaffairs.gov.au",
        "immi.homeaffairs.gov.au",
        "studyaustralia.gov.au",
    ),
    "canada": ("canada.ca", "cic.gc.ca", "gc.ca"),
    "germany": (
        "auswaertiges-amt.de",
        "make-it-in-germany.com",
        "bamf.de",
        "study-in-germany.de",
    ),
}

# Universities and official study portals, by target country. Academic
# suffixes (`ac.uk`, `edu.au`) admit any institution under them, which is
# the intent — the catalogue gap we are filling is "a real university we
# have not indexed yet".
PROGRAMME_DOMAINS: dict[str, tuple[str, ...]] = {
    "uk": ("ac.uk", "ucas.com"),
    "australia": ("edu.au", "studyaustralia.gov.au"),
    "canada": ("educanada.ca", "univcan.ca"),
    "germany": ("hochschulkompass.de", "daad.de", "study-in-germany.de"),
}

# Applied to every list regardless of country. Kept separate so it is obvious
# these are cross-border sources rather than a country's own institutions.
GLOBAL_PROGRAMME_DOMAINS: tuple[str, ...] = ()


# ---------------------------------------------------------------------------
# Host matching
# ---------------------------------------------------------------------------


def host_of(url: str) -> str | None:
    """The lowercase hostname of an http(s) URL, or None if unusable.

    Returns None rather than raising for anything that is not a plain http(s)
    URL with a hostname — `javascript:`, `data:`, `file:`, a bare string, a
    URL with no host. Callers treat None as "not allowed", so a malformed or
    exotic URL fails closed instead of skipping the check.
    """
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return None
    if parts.scheme.lower() not in ("http", "https"):
        return None
    host = (parts.hostname or "").strip().rstrip(".").lower()
    if not host or not host.isascii():
        # Non-ASCII means an un-normalised IDN. A genuine internationalised
        # host arrives punycoded (`xn--…`) and simply won't match our
        # ASCII allowlist, which is the correct outcome; a raw unicode host
        # is a homograph risk we decline to reason about.
        return None
    return host


def host_matches(host: str, domain: str) -> bool:
    """True when `host` IS `domain` or sits beneath it.

    The match is anchored on a label boundary, which is the whole point:

        host_matches("www.gov.uk",   "gov.uk")  -> True
        host_matches("gov.uk",       "gov.uk")  -> True
        host_matches("notgov.uk",    "gov.uk")  -> False   suffix, not label
        host_matches("gov.uk.evil.com", "gov.uk") -> False  prefix, not suffix

    A naive `host.endswith(domain)` gets the third case wrong and hands an
    attacker the allowlist for the price of registering one domain.
    """
    host = host.strip().rstrip(".").lower()
    domain = domain.strip().rstrip(".").lower()
    if not host or not domain:
        return False
    return host == domain or host.endswith("." + domain)


def is_allowed(url: str, allowlist: tuple[str, ...] | list[str]) -> bool:
    """True when the URL's host sits on the allowlist. Fails closed.

    With ENFORCE_HOST_ALLOWLIST off, any well-formed http(s) URL passes. The
    scheme check still runs: `javascript:` and `data:` are malformed-URL
    problems, not domain-policy ones, and letting those through would be a
    different bug than the one the switch is exploring.
    """
    host = host_of(url)
    if host is None:
        return False
    if not ENFORCE_HOST_ALLOWLIST:
        return True
    return any(host_matches(host, d) for d in allowlist)


# ---------------------------------------------------------------------------
# Resolving a country to its lists
# ---------------------------------------------------------------------------


def _key(country: str | None) -> str:
    return (country or "").strip().lower()


def visa_sources(country: str | None) -> tuple[str, ...]:
    """Official government domains for this country, or () if unknown.

    An empty tuple is meaningful and safe: `filter_results` against () keeps
    nothing, so an unrecognised country yields no web results at all rather
    than falling back to the open internet for a visa question.
    """
    return VISA_DOMAINS.get(_key(country), ())


def programme_sources(country: str | None) -> tuple[str, ...]:
    """University and study-portal domains for this country, or () if unknown."""
    known = PROGRAMME_DOMAINS.get(_key(country), ())
    return tuple(known) + GLOBAL_PROGRAMME_DOMAINS


def supported_countries() -> list[str]:
    """Countries with a visa allowlist, for error messages that tell the
    agent what it CAN do rather than only what it cannot."""
    return sorted(VISA_DOMAINS)


# ---------------------------------------------------------------------------
# Query building + result filtering
# ---------------------------------------------------------------------------


def site_query(allowlist: tuple[str, ...] | list[str], limit: int = 6) -> str:
    """`site:` operators for a Brave query. Relevance hint ONLY.

    Brave has no structured domain filter, so this is how the intent reaches
    the engine. It is not enforcement — `filter_results` is. Capped because a
    query stuffed with operators degrades result quality, and the cap is safe
    precisely because dropping an operator cannot widen what we accept.
    """
    if not allowlist or not ENFORCE_HOST_ALLOWLIST:
        return ""
    return " OR ".join(f"site:{d}" for d in list(allowlist)[:limit])


def filter_results(
    results: list[dict], allowlist: tuple[str, ...] | list[str] | None
) -> tuple[list[dict], list[dict]]:
    """Split results into (kept, dropped) by host. THIS is the boundary.

    Every result keeps its `url` and gains a `source_host`, so whatever the
    agent goes on to say can be traced to a domain we chose to trust. The
    dropped list is returned rather than discarded so the caller can log how
    much was refused — a search that is 90% dropped means the allowlist and
    the query disagree, which is worth seeing in the trace.
    """
    kept: list[dict] = []
    dropped: list[dict] = []
    # `allowlist=None` means "this caller does not restrict hosts at all" —
    # distinct from an EMPTY allowlist, which means "nothing is permitted".
    # Without the distinction a caller that deliberately searches the open web
    # would silently drop every result the moment someone re-enabled the
    # global switch, which is the opposite of what they asked for.
    unrestricted = allowlist is None or not ENFORCE_HOST_ALLOWLIST
    for result in results:
        url = str(result.get("url") or "")
        host = host_of(url)
        if host is None:
            # Scheme check, always. Refusing `javascript:` is not a domain
            # policy, and it applies even to callers that restrict nothing.
            dropped.append(result)
            continue
        if unrestricted or any(host_matches(host, d) for d in allowlist or ()):
            kept.append({**result, "source_host": host})
        else:
            dropped.append(result)
    return kept, dropped
