"""MCP server: the Northbound consultancy backend.

One server, two tool sets, chosen at startup from NORTHBOUND_ROLE:

    shared      search_programmes, get_programme, check_requirements,
                build_shortlist
    student     escalate, book_slot, schedule_followup
    counsellor  list_leads, get_lead_briefing, get_lead_timeline,
                get_unassigned_queue

The gate is structural, not defensive. FastMCP registers tools when the
decorator runs, so a student session's subprocess never executes the
counsellor block — `list_leads` is not hidden or refused in that process, it
does not exist. There is no prompt that reaches a tool which was never
defined, and no role flag left to flip at runtime.

`mocks/client.py` holds the capability (27 public methods); this file decides
what the model may ask for (7 or 8). The gap between those numbers is the
security boundary. `all_leads`, `record_tool_call`, `reset`,
`assign_counsellor` and friends are deliberately absent: an agent that can
write its own audit trail can forge it, and an agent that can enumerate every
lead is one injection away from leaking the book.

Three things this layer adds on top of the client:

1. **Docstrings written for a model**, not a developer — when to reach for
   the tool, and what each error means for the next turn.
2. **Structured errors.** The client raises Python; an LLM cannot catch an
   exception. Every failure comes back as a dict with `error`, `detail`, and
   a `remediation` naming the next action.
3. **Automatic audit.** `@audited` records every call — full args, full
   result — so a tool physically cannot run without leaving a ToolCall row.
   The spec requires any decision be reconstructable from ToolCall + Message
   alone; leaving that to each tool's discretion would eventually miss one.

What this file does NOT do: decide whose data. Every tool takes `lead_id`
(or `counsellor_id`) as a parameter and the harness hook overwrites it with
the session's trusted value. The server enforces rules; the harness enforces
identity.

Run via stdio (Strands' MCPClient launches it as a subprocess from
agent/core.py). Standalone, for debugging:

    NORTHBOUND_ROLE=student python -m mcp_servers.northbound
"""

import functools
import logging
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

# Lab root on sys.path so we can import the shared `mocks` package and the
# agent's profile/identity. This file is at
# Lab-05/mcp_servers/northbound/__main__.py — THREE parents up is Lab-05/.
# (Lab-01's equivalent was four; the servers used to live inside the agent
# directory. Getting this wrong fails at import with a confusing
# ModuleNotFoundError, so it is spelled out.)
_LAB_ROOT = Path(__file__).parent.parent.parent
if str(_LAB_ROOT) not in sys.path:
    sys.path.insert(0, str(_LAB_ROOT))

# The agent package lives under the student agent; the profile loader and
# AgentIdentity are shared by both agents.
_AGENT_ROOT = _LAB_ROOT / "student_agent"
if str(_AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(_AGENT_ROOT))

from mcp.server.fastmcp import FastMCP  # noqa: E402

from agent.identity import AgentIdentity  # noqa: E402
from agent.profile import load_profile  # noqa: E402
from mcp_servers.northbound import sources, websearch  # noqa: E402
from mocks.client import (  # noqa: E402
    FactNotStated,
    NoCounsellorAvailable,
    NorthboundClient,
    ShortlistUnavailable,
)

# Silence the MCP framework's INFO logs (otherwise every list_tools call
# leaks into the on-stage trace).
logging.basicConfig(level=logging.WARNING)
for _noisy in ("mcp", "mcp.server", "mcp.server.lowlevel", "FastMCP"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

mcp = FastMCP("northbound")

# ---------------------------------------------------------------------------
# State at launch
# ---------------------------------------------------------------------------

ROLE = os.environ.get("NORTHBOUND_ROLE", "student").strip().lower()
if ROLE not in ("student", "counsellor"):
    raise SystemExit(
        f"NORTHBOUND_ROLE must be 'student' or 'counsellor', got {ROLE!r}"
    )

# The spawning agent sets NORTHBOUND_PROFILE to its own agent-profile.yaml.
# Without this, `load_profile()`'s default always resolves relative to
# agent/profile.py's own location — i.e. always the student's YAML — and the
# counsellor agent's subprocess would sign every audit row as
# northbound-student. See student_agent/agent/core.py::make_mcp_client.
_profile_path_override = os.environ.get("NORTHBOUND_PROFILE")
_profile = (
    load_profile(Path(_profile_path_override))
    if _profile_path_override
    else load_profile()
)
_identity = AgentIdentity(
    agent_id=_profile.agent_id,
    name=_profile.name,
    tenant_name=_profile.tenant_name,
    role=ROLE,
    confidence_floor=_profile.confidence_floor,
)
# Both agents point at the same workspace so the counsellor can see what the
# student-facing agent did; `agent_id` keeps their audit rows distinguishable.
_client = NorthboundClient(
    agent_id=_profile.agent_id, workspace=_profile.workspace
)


# ---------------------------------------------------------------------------
# Error translation + audit
# ---------------------------------------------------------------------------


def _now_plus_days(days: int) -> str:
    """An ISO due date N days out, for follow-ups the agent files on the
    student's behalf rather than from a date a tool returned."""
    return (
        (datetime.now(timezone.utc) + timedelta(days=days))
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z")
    )


def _error(code: str, status: int, detail: str, remediation: str, **extra) -> dict:
    """One envelope for every failure, so the model learns a single shape.

    `remediation` is the field that matters: it names the next action, which
    is what stops a model retrying a permanently-failing call in a loop.
    """
    return {
        "error": code,
        "code": status,
        "detail": detail,
        "remediation": remediation,
        **extra,
    }


def _translate(exc: Exception) -> dict:
    """Python exception -> structured tool result an LLM can act on."""
    if isinstance(exc, ShortlistUnavailable):
        return _error(
            "shortlist_unavailable",
            422,
            exc.reason,
            "escalate",
            trigger=exc.trigger,
        )
    if isinstance(exc, NoCounsellorAvailable):
        return _error(
            "no_counsellor_available",
            409,
            str(exc),
            "escalate",
        )
    if isinstance(exc, FactNotStated):
        return _error(
            "fact_not_stated",
            422,
            str(exc),
            "ask_the_student",
        )
    if isinstance(exc, KeyError):
        return _error("not_found", 404, str(exc).strip("'\""), "do_not_act")
    if isinstance(exc, ValueError):
        return _error("invalid_argument", 400, str(exc), "fix_the_argument")
    # Anything unplanned. The remediation points at the prompt's "When a tool
    # fails" rule and at the `system_failure` escalation trigger.
    return _error(
        "internal_error",
        500,
        f"{type(exc).__name__}: {exc}",
        "retry_once_then_escalate",
    )


def audited(fn: Callable[..., Any]) -> Callable[..., Any]:
    """Record every call to the ToolCall audit trail, then return.

    Wraps the tool rather than trusting each one to log itself — the spec
    requires that any agent decision be reconstructable from ToolCall +
    Message alone, and a per-tool convention would eventually miss one.

    `functools.wraps` sets `__wrapped__`, so FastMCP's signature
    introspection still sees the real parameters and builds the correct JSON
    schema.
    """

    @functools.wraps(fn)
    def wrapper(**kwargs: Any) -> Any:
        # Audit rows are keyed to a lead. Lead-less calls (the counsellor's
        # queue view) key to the counsellor, or to "-" as a last resort.
        subject = kwargs.get("lead_id") or kwargs.get("counsellor_id") or "-"
        try:
            result = fn(**kwargs)
        except Exception as exc:  # noqa: BLE001 - translated, not swallowed
            payload = _translate(exc)
            _client.record_tool_call(
                subject, fn.__name__, kwargs, payload, ok=False,
                error=payload["error"],
            )
            return payload
        ok = not (isinstance(result, dict) and "error" in result)
        _client.record_tool_call(
            subject, fn.__name__, kwargs, result, ok=ok,
            error=None if ok else result.get("error"),
        )
        return result

    return wrapper


# ---------------------------------------------------------------------------
# Shared tools — both roles
# ---------------------------------------------------------------------------


def _register_shared_tools() -> None:
    @mcp.tool()
    @audited
    def search_programmes(
        country: str = "",
        field: str = "",
        level: str = "",
        intake: str = "",
        max_tuition: float = 0.0,
        limit: int = 20,
    ) -> dict:
        """Search the verified programme catalogue.

        This is the ONLY source of programme facts. Every fee, deadline,
        duration and entry requirement you state to a student must come from
        here or from `get_programme`. A programme absent from these results
        does not exist as far as the student is concerned — do not fill the
        gap from your own knowledge of universities.

        All filters are optional; omit one by leaving it empty (or 0 for
        `max_tuition`). `intake` matches an intake code like "2027-09".
        `field` is a substring match on the catalogue's own wording, so a
        student's phrasing may not match — prefer searching by `country`
        alone and reading the results over guessing a field name.

        Returns {"programmes": [...], "count": N}.
        """
        results = _client.search_programmes(
            country=country or None,
            field=field or None,
            level=level or None,
            intake=intake or None,
            max_tuition=max_tuition or None,
            limit=limit,
        )
        return {
            "programmes": [p.model_dump() for p in results],
            "count": len(results),
        }

    @mcp.tool()
    @audited
    def get_programme(programme_id: str) -> dict:
        """Full detail for one catalogue entry, including every entry
        requirement with its plain-English description.

        Use this when a student asks about a specific programme you have
        already surfaced. Returns {"error": "not_found"} if the id is not in
        the catalogue — which means it is not a programme this consultancy
        represents, not that you should describe it from memory.
        """
        programme = _client.get_programme(programme_id)
        if programme is None:
            return _error(
                "not_found",
                404,
                f"no programme {programme_id!r} in the verified catalogue",
                "do_not_act",
            )
        return programme.model_dump()

    @mcp.tool()
    @audited
    def check_requirements(lead_id: str, programme_id: str) -> dict:
        """Test this student's stated facts against one programme's entry
        requirements.

        Every requirement comes back as `pass`, `fail`, or `indeterminate`,
        with a reason. `indeterminate` is a real outcome, not a soft failure:
        it means the requirement CANNOT be decided from what we know.

        Two fields say what to DO about it, and they call for opposite
        actions — read them, don't guess from the reason text:

          `missing_facts`      fact keys the student has never stated. ASK
                               them. One question and the check re-runs
                               settled. Do not escalate over these and do not
                               send them looking for paperwork.
          `pending_documents`  we have what they said and still cannot map it
                               — a three-year degree against a four-year
                               rule, an unfamiliar grading board. CHASE the
                               named document with `schedule_followup`.

        A result with `missing_facts` and no `pending_documents` is not a
        problem, it is an unfinished conversation. Either way: do not estimate
        their chances in either direction.

        `confidence` is computed from the verdicts, not chosen by you.

        `lead_id` is supplied by the harness — pass an empty string.
        """
        result = _client.check_requirements(lead_id, programme_id)
        return result.model_dump()

    @mcp.tool()
    @audited
    def build_shortlist(
        lead_id: str, country: str = "", field: str = ""
    ) -> dict:
        """Build the student's shortlist: three to five programmes they can
        realistically get into.

        Each entry carries a confidence score and `hinge` — the single
        requirement the match turns on, in plain English. The hinge is the
        most useful thing to tell a student; lead with it.

        An entry's `verdict` says whether that match is settled (`pass`) or
        still undecided (`indeterminate`). For an undecided one, exactly one
        of these says what comes next: `resolving_document` (paperwork to
        chase) or `missing_facts` (answers to ask the student for). Entries
        blocked only on `missing_facts` are one question away from settled —
        ask before you present them as uncertain.

        This is the ONLY way to present programmes. Do not assemble a list
        yourself from search results.

        If fewer than three programmes clear the confidence floor, this
        returns {"error": "shortlist_unavailable", "remediation": "escalate"}
        with a `trigger` to pass to `escalate`. That is a real answer — do
        not retry with looser criteria or present a shorter list.

        `country` and `field` default to the student's stated facts; pass
        them only to explore an alternative they asked about. `lead_id` is
        supplied by the harness — pass an empty string.
        """
        shortlist = _client.build_shortlist(
            lead_id,
            country=country or None,
            field=field or None,
            floor=_identity.confidence_floor,
        )
        # Belt and braces: the client already applied the floor per entry.
        # The agent's own scoped authority re-checks the aggregate before it
        # goes out, so the identity is a real gate rather than decoration.
        allowed, why = _identity.can_present_shortlist(
            shortlist.overall_confidence
        )
        if not allowed:
            return _error(
                "shortlist_unavailable",
                422,
                why or "confidence below the agent's floor",
                "escalate",
                trigger="low_confidence",
            )
        return shortlist.model_dump()


# ---------------------------------------------------------------------------
# Student tools — write path
# ---------------------------------------------------------------------------


def _register_student_tools() -> None:
    @mcp.tool()
    @audited
    def escalate(lead_id: str, trigger: str, detail: str) -> dict:
        """Hand this lead to a human counsellor.

        Call this the moment a trigger appears — do not investigate first,
        and do not decide whether it really applies. Valid triggers:

          visa_refusal                any previous visa refusal, anywhere
          fee_dispute                 a fee, payment or refund disagreement
          dependants_or_sponsorship   dependants travelling, or a third-party
                                      sponsor
          low_confidence              build_shortlist refused
          student_requested_human     they asked to speak to a person
          visa_or_immigration_advice  ANY visa or immigration question
          system_failure              a tool failed repeatedly and you cannot
                                      answer without guessing

        `detail` is read by the counsellor who picks this up — give them what
        they need so they do not have to re-investigate: what the student
        asked, what you already established, and why this stopped with you.

        Routing is automatic, by the student's target country. If no active
        counsellor covers it the lead joins the unassigned queue and
        `counsellor_id` comes back null with `queued: true` — someone will
        still pick it up, so tell the student they will be contacted rather
        than that nobody is available.

        `lead_id` is supplied by the harness — pass an empty string.
        """
        escalation = _client.escalate(lead_id, trigger, detail)
        payload = escalation.model_dump()
        payload["queued"] = escalation.counsellor_id is None
        return payload

    @mcp.tool()
    @audited
    def book_slot(lead_id: str, starts_at: str, duration_minutes: int = 30) -> dict:
        """Book a counsellor appointment for this student.

        `starts_at` is an ISO timestamp. The counsellor is chosen
        automatically from the student's target country — you do not pick who,
        and you must not promise a named person.

        If no active counsellor covers their country this returns
        {"error": "no_counsellor_available", "remediation": "escalate"}. Book
        nothing and escalate instead: an appointment with nobody is worse for
        the student than an honest handover to a queue.

        `lead_id` is supplied by the harness — pass an empty string.
        """
        slot = _client.book_slot(
            lead_id, starts_at=starts_at, duration_minutes=duration_minutes
        )
        return slot.model_dump()

    @mcp.tool()
    @audited
    def schedule_followup(
        lead_id: str, kind: str, due_at: str, reason: str
    ) -> dict:
        """Schedule a dated follow-up. Anything with a date becomes one of
        these — follow-ups are scheduled, never remembered.

        `kind` is one of:
          document_chase    waiting on a transcript, certificate or reference
          test_result       waiting on IELTS/TOEFL or similar
          intake_cutoff     an application deadline approaching
          deposit_deadline  a payment date

        `due_at` is an ISO timestamp. `reason` is what the person chasing
        will read, so name the document or the deadline specifically.

        Schedule one whenever `check_requirements` returns `indeterminate`
        (to chase the resolving document) and whenever a tool result carries
        a deadline. `lead_id` is supplied by the harness — pass an empty
        string.
        """
        followup = _client.schedule_followup(lead_id, kind, due_at, reason)
        return followup.model_dump()


# ---------------------------------------------------------------------------
# Counsellor tools — read-only
# ---------------------------------------------------------------------------


def _register_counsellor_tools() -> None:
    @mcp.tool()
    @audited
    def list_leads(counsellor_id: str, status: str = "") -> dict:
        """List the leads in the countries you own.

        Scoped by the harness to the signed-in counsellor — you cannot see a
        colleague's leads. Optionally filter by `status`: active, parked,
        escalated, withdrawn, converted.

        `counsellor_id` is supplied by the harness — pass an empty string.
        """
        counsellor = _client.get_counsellor(counsellor_id)
        if counsellor is None:
            return _error(
                "not_found", 404, f"no counsellor {counsellor_id!r}", "do_not_act"
            )
        leads = _client.leads_for_countries(
            counsellor.countries, status=status or None
        )
        return {
            "countries": counsellor.countries,
            "leads": [lead.model_dump() for lead in leads],
            "count": len(leads),
        }

    @mcp.tool()
    @audited
    def get_lead_briefing(lead_id: str) -> dict:
        """Everything known about one lead, in one call: their stated facts,
        what is still unknown, status and assigned counsellor, any
        escalations with the trigger that caused them, pending follow-ups,
        and the agent's episodic notes.

        Use this to answer "where are we with this student?". The `facts`
        block is what they actually told us — `missing` is what nobody has
        asked yet. `notes` are observations about the person (tone, promises,
        family context); programme facts are never stored there, so quote a
        tool result rather than the notes for anything factual.
        """
        lead = _client.get_lead(lead_id)
        if lead is None:
            return _error("not_found", 404, f"no lead {lead_id!r}", "do_not_act")
        escalations = _client.get_escalations(lead_id)
        followups = _client.get_followups(lead_id)
        return {
            "lead_id": lead.lead_id,
            "name": lead.name,
            "email": lead.email,
            "country_of_residence": lead.country_of_residence,
            "status": lead.status,
            "assigned_counsellor_id": lead.assigned_counsellor_id,
            "facts": lead.facts.known(),
            "missing": lead.facts.missing(),
            "escalations": [e.model_dump() for e in escalations],
            "pending_followups": [
                f.model_dump() for f in followups if f.status == "pending"
            ],
            "notes": _client.load_note(lead_id),
            "slots": [s.model_dump() for s in _client.get_slots(lead_id)],
        }

    @mcp.tool()
    @audited
    def get_lead_timeline(lead_id: str, limit: int = 50) -> dict:
        """The full audit trail for one lead: every message and every tool
        call the agent made, in order.

        This is the record of what the agent actually did and why — use it
        when you need to reconstruct a decision rather than summarise a
        state. `get_lead_briefing` answers "where are we"; this answers "how
        did we get here".
        """
        if _client.get_lead(lead_id) is None:
            return _error("not_found", 404, f"no lead {lead_id!r}", "do_not_act")
        events: list[dict] = [
            {
                "at": m.timestamp,
                "kind": "message",
                "role": m.role,
                "content": m.content,
            }
            for m in _client.get_messages(lead_id)
        ] + [
            {
                "at": t.timestamp,
                "kind": "tool_call",
                "tool": t.tool,
                "args": t.args,
                "ok": t.ok,
                "error": t.error,
                "agent_id": t.agent_id,
                "result": t.result,
            }
            for t in _client.get_tool_calls(lead_id)
        ]
        events.sort(key=lambda e: e["at"] or "")
        return {"lead_id": lead_id, "events": events[-limit:], "count": len(events)}

    @mcp.tool()
    @audited
    def get_unassigned_queue() -> dict:
        """Leads waiting for manual pickup — escalated or parked with no
        counsellor assigned.

        A lead lands here when no ACTIVE counsellor covers their target
        country, or when they have not stated a country yet. The agent never
        round-robins to fill the gap, so this queue is the only place these
        students are visible.
        """
        leads = _client.unassigned_leads()
        return {"leads": [lead.model_dump() for lead in leads], "count": len(leads)}


# ---------------------------------------------------------------------------
# Web tools — the UNVERIFIED tier
# ---------------------------------------------------------------------------


def _lead_country(lead_id: str, override: str = "") -> str:
    """The student's target country: the caller's override, else their stated
    fact, else "". Never guessed from anything else."""
    if override.strip():
        return override.strip()
    lead = _client.get_lead(lead_id)
    if lead is None or lead.facts.target_country is None:
        return ""
    return str(lead.facts.target_country.value)


def _run_search(
    question: str, allowlist, country: str, fetch: bool = True
) -> tuple[list[dict], int]:
    """Query Brave, filter by host, then read the surviving pages.

    The first two steps are always paired and always in this order.
    `site_query` puts the allowlist in front of the search engine as a hint;
    `filter_results` is what actually enforces it on our side. If Brave
    ignores the operators entirely, the boundary still holds.

    The third step is what makes the answers worth having. Brave returns a
    meta-description — one sentence — and an agent handed that can only point
    at a page, never summarise it. `fetch_page` retrieves the real text, and
    re-checks the host after redirects so a 302 cannot walk content in past
    the allowlist.

    A page that fails to load simply has no `content`; the title, description
    and url still stand, and the agent is told to fall back to pointing at it.
    """
    scoped = f"{question} {sources.site_query(allowlist)}".strip()
    raw = websearch.search(
        scoped,
        api_key=_profile.web_search.api_key,
        count=_profile.web_search.max_results,
    )
    kept, dropped = sources.filter_results(raw, allowlist)
    shown = kept[: _profile.web_search.max_shown]
    if fetch:
        for result in shown:
            result["content"] = websearch.fetch_page(result["url"], allowlist)
    return shown, len(dropped)


def _run_programme_search(query: str) -> tuple[list[dict], int, float]:
    """Exa for programme discovery. Returns (shown, dropped_count, cost_usd).

    A different transport from `_run_search` for a measured reason. Brave plus
    `fetch_page` was tried first and does not work here: university course
    pages are JS-rendered and bot-protected, so the fetch returned an empty
    string for study.unimelb.edu.au and the agent was left naming courses from
    their titles. Exa returns the extracted page text inside the search
    response, so there is no fetch step left to be blocked.

    NO HOST RESTRICTION AND NO COUNTRY. Deliberate, and it is the second
    thing this function got wrong.

    The country restriction was worse than useless here. It scoped the search
    to the country the student had already stated, so a student targeting the
    UK could not ask "what about Canada?" — the one question that most needs
    an open search. And an unstated country blocked the tool entirely.

    The allowlist was the other half. It is a good boundary for VISA answers,
    where the whole justification for relaying a figure is that a government
    published it. For programme discovery it mostly encoded my own ignorance:
    Canada's list held two portal sites and no universities, so a civil
    engineering search returned index pages, and Carleton — a real university
    — was invisible because I had never heard to list it.

    `filter_results(raw, None)` keeps the scheme check and nothing else:
    `javascript:` and `data:` URLs are still refused, because that is a
    malformed-URL problem rather than a domain-policy one. The tool's result
    `note` tells the agent plainly that these came from the open web.
    """
    raw, cost = websearch.exa_search(
        query,
        api_key=_profile.web_search.exa_api_key,
        include_domains=(),
        count=_profile.web_search.max_results,
        max_chars=_profile.web_search.exa_max_chars,
    )
    # None, not () — "this caller restricts nothing", as distinct from
    # "nothing is permitted". See sources.filter_results.
    kept, dropped = sources.filter_results(raw, None)
    return kept[: _profile.web_search.max_shown], len(dropped), cost


def _register_visa_research_tool() -> None:
    @mcp.tool()
    @audited
    def research_visa_question(
        question: str, country: str = "", lead_id: str = ""
    ) -> dict:
        """Look up what an OFFICIAL government source publishes on a visa or
        immigration question.

        This does not change what you are allowed to say. You still give no
        visa advice, and the escalation still fires — a counsellor decides
        what applies to this student. What this tool lets you do is stop
        escalating empty-handed: you may RELAY what a government page
        publishes, attributed and linked, while the counsellor confirms it.

        The difference is not subtle and it is not stylistic:

          ALLOWED  "The Home Office currently publishes a 3-week standard
                    processing time for this route: <url>. A counsellor will
                    confirm what applies to you."
          NOT      "Your visa should take about 3 weeks."

        The first repeats a published figure and names who published it. The
        second is an assessment of this person's case, which is regulated
        advice in most countries and is never yours to give.

        Each result carries `content`: the actual text of that page, not a
        search snippet. ANSWER THE QUESTION FROM IT. If a student asks what
        the requirements are, list what the page lists — do not reply "the
        official page covers eligibility" and leave them to go and read it.
        You have the page; use it.

        Rules for using what comes back:
        - **Conditions travel with their numbers.** This is the one that
          matters. "£1,334 per month" is wrong for most people. "£1,334 per
          month, for courses in London lasting over 6 months" is right. Never
          lift a figure away from the qualifier attached to it — a summary
          that drops the condition is confidently wrong for everyone it does
          not apply to.
        - Every claim you take from a result MUST carry that result's `url`
          in your reply. A figure without its link is indistinguishable from
          something you invented.
        - Summarise, don't editorialise. Say what the page says, in plainer
          words. Do not add, rank, reassure, or infer what it "means" for
          them.
        - If `content` is empty the page could not be read — fall back to
          pointing at the url, and say you could not read it.
        - Say when it was published if `published` is set, and that official
          guidance changes.
        - Never combine two sources into a single confident claim.
        - Never apply a general figure to this student's specific case. Say
          what the rule IS, never what it means for them.

        When host filtering is enabled, results are restricted to that
        country's official government domains before you see them; the
        result's `note` says whether it was. `country` defaults to the student's stated
        target country; pass it only to ask about somewhere else. `lead_id`
        is supplied by the harness — pass an empty string.
        """
        target = _lead_country(lead_id, country)
        if not target:
            return _error(
                "no_target_country",
                422,
                "the student has not stated a target country, so there is no "
                "government source to search",
                "ask_the_student",
            )

        allowlist = sources.visa_sources(target)
        if not allowlist and sources.enforcement_enabled():
            # Deliberately NOT a fallback to the open web. An unrecognised
            # country means we have no curated official source, and the safe
            # answer is none rather than whatever ranks first.
            return _error(
                "no_official_sources",
                422,
                f"no official government sources are configured for {target!r}",
                "escalate",
                supported_countries=sources.supported_countries(),
            )

        try:
            shown, dropped = _run_search(
                f"{question} student visa {target}", allowlist, target
            )
        except websearch.WebSearchError as exc:
            return _error(
                "web_search_failed", 503, exc.detail, exc.remediation
            )

        if not shown:
            return {
                "sources": [],
                "count": 0,
                "country": target,
                "dropped_offlist": dropped,
                "note": (
                    "No official source answered this. Do NOT fill the gap "
                    "from your own knowledge — say a counsellor will follow "
                    "up."
                ),
            }

        return {
            "sources": shown,
            "count": len(shown),
            "country": target,
            "dropped_offlist": dropped,
            "tier": "unverified",
            "citation_required": True,
            "note": (
                (
                    "Official government sources only. "
                    if sources.enforcement_enabled()
                    else "WARNING: host filtering is OFF. These results are "
                    "from the OPEN WEB and are NOT verified as official "
                    "government pages. Do not describe any of them as "
                    "official unless the url itself is plainly a government "
                    "domain. Treat anything else as a stranger's website. "
                )
                + "Quote or paraphrase closely, always with the url. This "
                "does not replace the escalation — a counsellor still "
                "confirms what applies to this student."
            ),
        }

def _register_programme_discovery_tool() -> None:
    @mcp.tool()
    @audited
    def find_unverified_programmes(query: str, lead_id: str = "") -> dict:
        """Find programmes that are NOT in the verified catalogue, when
        `search_programmes` came back empty or too thin.

        `query` IS THE WHOLE INPUT, and writing a good one is your job.

        This searches semantically, so it matches on what a page MEANS, not on
        keywords. Write the query the way the student asked the question. That
        is not a stylistic note — an earlier version of this tool took
        `field` + `country` + `level` and rebuilt a query from them, and a
        student asking about Kingston University got UCL and Brunel back,
        because the word "Kingston" had no field to live in and was thrown
        away before the search ran.

        Compose it from what they actually said:

        - **Name the institution if they named one.** Highest-signal thing in
          the query by a wide margin.
        - Keep their wording, including their spelling. "is there any courses
          in kingston univerity for msc civil enginering" returns the right
          Kingston pages; the tidied-up version does not.
        - Include the level, the subject and the location as part of a
          sentence, not as separate keys.
        - Do NOT rewrite their question into formal English. That is exactly
          what loses the detail that mattered.

        There is no country parameter and no domain restriction. A student
        targeting the UK may ask about Canada, and this will search for it —
        say where you looked, and note it is outside what you have discussed
        so far.

        These are CANDIDATES, never recommendations. A programme found this
        way has no requirement rows, which means its eligibility is not
        merely unknown — it cannot be computed at all. So:

        - Do NOT run `check_requirements` against one. There is nothing to
          check against.
        - Do NOT put one in a shortlist. `build_shortlist` reads the
          catalogue, and a confidence score for one of these would be
          invented.
        - Do NOT compare one to a catalogue programme as though they were the
          same kind of thing. One has been checked by this consultancy; the
          other has not.

        Each result carries `content`: the text of the university's own
        course page. Use it — a student who asks what a course involves
        deserves an answer, not a link. You MAY tell them what that page says
        about duration, structure, fees and entry requirements, as long as
        every one of those is attributed and linked:

          YES  "Melbourne's own course page lists AUD 48,000 a year for
                international students: <url>"
          NO   "The fee is AUD 48,000 a year."

        The second states it as a verified fact. It is not one — nobody here
        has checked it, the page may be a year out of date, and the student
        may budget on it.

        Always say plainly that these are not programmes this consultancy has
        verified yet, and that a counsellor is checking them. This tool files
        that check for you as a `catalogue_verification` follow-up. If
        `content` is empty the page would not load — point at the url and say
        so rather than guessing what it contains.

        Pass ONLY `query`. `lead_id` is filled in by the harness before this
        runs — omit it, and if you do pass it, it must match the session's
        lead or the call is refused.
        """
        if not query.strip():
            return _error(
                "empty_query",
                400,
                "query is required — compose it from what the student asked",
                "fix_the_argument",
            )

        try:
            shown, dropped, search_cost = _run_programme_search(query)
        except websearch.WebSearchError as exc:
            return _error(
                "web_search_failed", 503, exc.detail, exc.remediation
            )

        if not shown:
            return {
                "candidates": [],
                "count": 0,
                "query": query,
                "note": (
                    "Nothing came back. Say so — do not name programmes from "
                    "your own knowledge. If the student named an institution, "
                    "you may try once more with different wording; otherwise "
                    "offer what the verified catalogue does have."
                ),
            }

        # File the human check. Without this row the candidates are a
        # sentence in a chat log that nobody ever acts on, and the student
        # was told a counsellor would look.
        followup = _client.schedule_followup(
            lead_id,
            "catalogue_verification",
            _now_plus_days(3),
            f"verify {len(shown)} unlisted programme(s) for {query!r}: "
            + ", ".join(s["url"] for s in shown),
        )

        return {
            "candidates": shown,
            "count": len(shown),
            # Echoed back so the audit row shows exactly what was asked for —
            # more useful for evals than the old {field, country, level}.
            "query": query,
            "dropped_malformed": dropped,
            "tier": "unverified",
            "verified": False,
            "citation_required": True,
            "verification_followup_id": followup.followup_id,
            "search_cost_usd": round(search_cost, 4),
            "note": (
                "NOT catalogue entries, and these came from the OPEN WEB — "
                "no domain restriction applies to this tool. They may be "
                "agency marketing, ranking sites, or index pages rather than "
                "universities, so CHECK THE URL before calling anything a "
                "university programme. Each candidate's `content` is the "
                "page's own text — answer from it. "
                + "Present them as candidates a counsellor is checking, "
                "always with the url. Do not check requirements and do not "
                "shortlist. State fees and requirements as the source's "
                "claim, never as ours."
            ),
        }


# ---------------------------------------------------------------------------
# Role gate
# ---------------------------------------------------------------------------

_register_shared_tools()
if ROLE == "student":
    _register_student_tools()
    # Same structural gate as the role split: a web tool whose provider is not
    # configured is never DEFINED in this process. The agent is not asked to
    # avoid the internet — it has no way to reach it. Counsellor sessions get
    # neither: a counsellor doing their own research uses a browser, not an
    # agent that launders results.
    #
    # Gated per provider, because the two tools use different ones and either
    # key can be absent on its own. Notably there is no Brave fallback for
    # programme discovery: it was tried, university pages came back empty, and
    # an agent naming courses off their titles is worse than one saying it
    # cannot look.
    if _profile.web_search.is_available:
        _register_visa_research_tool()
    if _profile.web_search.programme_search_available:
        _register_programme_discovery_tool()
else:
    _register_counsellor_tools()


if __name__ == "__main__":
    mcp.run(transport="stdio")
