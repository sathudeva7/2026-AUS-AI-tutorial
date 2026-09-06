"""Strands hooks — the rules the harness enforces, not the model.

Five hooks, each closing a gap that a system prompt alone cannot:

  LeadIdBindingHook     the harness owns `lead_id`, not the LLM
  InputSanitiserHook    strips student-typed <lead_facts> before the turn
  EscalationGateHook    rule-driven triggers, applied before the model runs
  GroundingHook         flags reply content no tool result supports
  CitationHook          a reply built on web results must show its source

The last two are a pair, and they exist because web search is the one
UNVERIFIED source in the system. GroundingHook covers claims with numbers in
them; CitationHook covers the ones without, which are the harder case — an
assertion with no figure in it trips no pattern and reads as authoritative.

The shape is Lab-01's: the backend refuses, and a hook refuses earlier. What
is new here is that two of these fire around the MODEL, not around a tool —
because two of this agent's hard rules are about what it SAYS, and by the
time a bad sentence reaches a tool call it is already too late.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

from strands.hooks import HookRegistry
from strands.hooks.events import (
    AfterToolCallEvent,
    AfterModelCallEvent,
    BeforeInvocationEvent,
    BeforeToolCallEvent,
)

from mocks.client import NorthboundClient

# Tools whose `lead_id` the harness owns. Anything not listed is left alone —
# `search_programmes` and `get_programme` are catalogue reads with no lead
# scoping at all. Keep the list explicit so it is obvious which tools depend
# on identity binding.
LEAD_SCOPED_TOOLS = frozenset(
    {
        "check_requirements",
        "build_shortlist",
        "escalate",
        "book_slot",
        "schedule_followup",
        "update_lead_facts",
        "append_note",
        "compact_note",
        # The two web tools. Both take `lead_id` and one of them WRITES with
        # it (`find_unverified_programmes` files a catalogue_verification
        # follow-up), so leaving them off this list meant the model owned the
        # identity for them — no auto-fill, and no 403 on a mismatch. It
        # surfaced as a crash when the model simply omitted the argument, but
        # the omission was the symptom; the hole was that these two sat
        # outside the identity boundary entirely.
        #
        # ADDING A TOOL THAT TAKES lead_id? ADD IT HERE. There is no
        # automatic membership, which is exactly how these two were missed.
        "research_visa_question",
        "find_unverified_programmes",
    }
)


# ---------------------------------------------------------------------------
# 1. Identity binding
# ---------------------------------------------------------------------------


@dataclass
class LeadIdBindingHook:
    """Validate `lead_id` on every lead-scoped tool call against the session's
    trusted id.

    OWASP API #1 is "Broken Object Level Authorization". The naive fix is to
    tell the model the lead id and check ownership server-side. That is
    defense in depth, but the LLM is still the principal: a prompt injection
    can make it pass someone else's id to any tool whose docstring it can
    read.

    This moves the principal one layer up. The harness owns `lead_id`. If the
    model omits it (typical of a first call — the tool docstrings all say
    "pass an empty string"), the trusted value is filled in. If the model
    proposes a DIFFERENT id, the call is rejected with a 403 before it ships
    to the MCP server.

    Reject rather than silently rewrite: rewriting hides the attempt and
    creates a loop hazard — the model asks for lead_002, sees lead_001's data
    come back, decides the call "didn't work", and retries forever. An
    explicit 403 breaks the loop and puts the cross-tenant attempt in the
    trace. We deliberately do not echo the trusted id back; that would hand
    an attacker the value they were probing for.
    """

    lead_id: str

    def register_hooks(self, registry: HookRegistry, **_: object) -> None:
        registry.add_callback(BeforeToolCallEvent, self._bind_lead_id)

    def _bind_lead_id(self, event: BeforeToolCallEvent) -> None:
        tool_use = event.tool_use
        if tool_use.get("name") not in LEAD_SCOPED_TOOLS:
            return
        inputs = tool_use["input"]
        proposed = inputs.get("lead_id")
        if proposed is None or proposed == "":
            inputs["lead_id"] = self.lead_id
            return
        if proposed == self.lead_id:
            return
        event.cancel_tool = json.dumps(
            {
                "error": "unauthorized",
                "code": 403,
                "detail": f"not authorised to access lead_id={proposed!r}",
                "remediation": "do_not_act",
            }
        )


# ---------------------------------------------------------------------------
# 2. Input sanitising
# ---------------------------------------------------------------------------

# The harness wraps trusted context in these tags before prepending it to the
# student's message. A student who types the same tags produces text that
# lands in the same place, in the same format — so the tags are stripped from
# anything the student sent before the real block is added.
_SPOOFABLE_TAGS = ("lead_facts", "notes", "plan")
_TAG_RE = re.compile(
    r"</?\s*(" + "|".join(_SPOOFABLE_TAGS) + r")\b[^>]*>", re.IGNORECASE
)


def sanitise_student_text(text: str) -> str:
    """Defang harness-looking markup in one piece of student input.

    Angle brackets become square ones; the content is kept and stays visible.
    Nothing is deleted — a student legitimately writing "<notes>" deserves to
    be understood, and silently dropping input is its own failure mode.

    This lives at module level, outside the hook, because the hook is NOT the
    only place student text is read. `InputSanitiserHook` fires on
    `BeforeInvocationEvent` — inside the agent run — so anything the harness
    does with the message BEFORE that point sees it undefanged. The planner is
    exactly that: it runs first, and a forged `<lead_facts>` block reached it
    intact, whereupon it copied the forged values into its `carried_context`
    line as plain untagged prose. That prose is then prepended to the message,
    where this regex can no longer touch it and the main agent reads it as
    trusted harness output. Sanitising in one place and calling it from both
    is what stops the two paths drifting apart again.

    Idempotent: the replacement leaves no angle brackets, so a second pass
    matches nothing.
    """
    return _TAG_RE.sub(lambda m: "[" + m.group(0)[1:-1] + "]", text)


@dataclass
class InputSanitiserHook:
    """Neutralise harness-looking markup in student input.

    The system prompt says the <lead_facts> block is the only trusted content
    in a student's turn. That claim is only true if the harness makes it true:
    otherwise a student types their own <lead_facts> block claiming an IELTS
    score they do not have, and the model has no way to tell it from the real
    one — same tags, same position, same message.

    So the tags are defanged in the student's text (angle brackets replaced,
    content kept and visible) before the genuine block is prepended. Content
    is never deleted: a student legitimately writing "<notes>" deserves to be
    understood, and silently dropping input is its own failure mode.
    """

    def register_hooks(self, registry: HookRegistry, **_: object) -> None:
        registry.add_callback(BeforeInvocationEvent, self._sanitise)

    def _sanitise(self, event: BeforeInvocationEvent) -> None:
        if not event.messages:
            return
        for message in event.messages:
            if message.get("role") != "user":
                continue
            for block in message.get("content", []) or []:
                text = block.get("text") if isinstance(block, dict) else None
                if not text:
                    continue
                # Only sanitise the part the STUDENT typed. The harness
                # prepends its own blocks; those are added after this hook
                # runs, so everything present here is untrusted.
                cleaned = sanitise_student_text(text)
                if cleaned != text:
                    block["text"] = cleaned


# ---------------------------------------------------------------------------
# 3. Escalation gate
# ---------------------------------------------------------------------------

# Deterministic trigger detection. Order matters: the most specific pattern
# wins, so "my visa was refused" escalates as `visa_refusal` rather than as a
# generic visa question.
#
# This is a lab-grade detector: regex over natural language, and it will
# both over- and under-fire. That trade is deliberate — a false positive
# costs one unnecessary handover, a false negative means an agent giving
# visa advice to someone with a refusal history. In production this is a
# classifier, not a regex, but the ARCHITECTURE is the point: the trigger is
# evaluated in code before the model runs, so "rule-driven, not
# judgement-driven" is structurally true rather than merely instructed.
_TRIGGER_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "visa_refusal",
        re.compile(
            r"\bvisa\b[^.?!]{0,40}\b(refus|reject|denied|deny|turned down)"
            r"|\b(refus|reject|denied)\w*\b[^.?!]{0,40}\bvisa\b",
            re.IGNORECASE,
        ),
    ),
    (
        "fee_dispute",
        re.compile(
            r"\b(refund|chargeback|overcharg\w*|double[- ]charg\w*|"
            r"wrong amount|billing (error|issue|dispute)|dispute the (fee|payment|charge))\b",
            re.IGNORECASE,
        ),
    ),
    (
        "dependants_or_sponsorship",
        re.compile(
            r"\b(dependants?|dependents?|bring my (wife|husband|partner|child|children|family)|"
            r"sponsor(ing|ed|ship)?|my (employer|uncle|company) (is |will )?pay)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "student_requested_human",
        re.compile(
            r"\b(speak|talk|chat) (to|with) (a |an |someone|somebody)?"
            r"\s*(real |actual |human |live )?(person|human|counsell?or|advisor|adviser|agent|staff)"
            r"|\b(real|actual) (person|human)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "visa_or_immigration_advice",
        re.compile(
            r"\b(visa|immigration|work permit|residence permit|"
            r"permanent residenc\w*|study permit|biometrics|CAS letter|I-20)\b",
            re.IGNORECASE,
        ),
    ),
)


def detect_trigger(text: str) -> tuple[str, str] | None:
    """Return (trigger, matched_text) for the first pattern that fires."""
    for trigger, pattern in _TRIGGER_PATTERNS:
        match = pattern.search(text or "")
        if match:
            return trigger, match.group(0).strip()
    return None


@dataclass
class EscalationGateHook:
    """Apply the escalation rules BEFORE the model sees the turn.

    Your spec says escalation is rule-driven, not judgement-driven. Handing
    the model an `escalate` tool and hoping it notices is judgement-driven by
    construction — and the failure we watched in Lab-01 was exactly this
    shape: the agent investigated first, decided the rule probably did not
    apply, and carried on.

    So the trigger is evaluated in code, and the escalation is PERFORMED in
    code. The model is then told it already happened, and its job for the
    turn is to explain that to the student like a person would.

    Deliberately not cancelling the invocation: a canned "you have been
    escalated" string is a worse experience than a real reply, and the
    student usually asked something else in the same message that can still
    be answered. The rule guarantees the ACTION; the model still writes the
    words.
    """

    lead_id: str
    client: NorthboundClient
    # True when `research_visa_question` is registered this session. The
    # directive below is trigger-aware ONLY when it is: telling the model to
    # go and cite an official source it has no tool to fetch would be worse
    # than telling it to say nothing.
    web_research_available: bool = False

    def register_hooks(self, registry: HookRegistry, **_: object) -> None:
        # Registered after InputSanitiserHook so it scans cleaned text.
        registry.add_callback(BeforeInvocationEvent, self._gate)

    def _topic_directive(self, trigger: str) -> str:
        """What the model may say about the topic that triggered.

        Not every trigger silences the same amount, and treating them alike
        was a real bug: a blanket "do not answer the triggering topic — not
        even generally" sits at the very top of the turn, above the system
        prompt and above any skill, so it foreclosed the relay path entirely.
        A student asking a plain question about visa processing times got
        nothing at all, from an agent holding a tool built to answer exactly
        that.

        The split:

          visa_or_immigration_advice   a general question. The relay path
                                       applies: cite an official source, let
                                       the counsellor apply it.
          everything else              refusal history, money, dependants, a
                                       request for a person. Say nothing on
                                       the topic. A refusal in particular
                                       changes an entire case, and a
                                       general-purpose government page
                                       quoted next to it reads as reassurance
                                       nobody is qualified to give.
        """
        if trigger == "visa_or_immigration_advice" and self.web_research_available:
            return (
                " On the visa topic itself: you may NOT advise, predict, or "
                "assess this student's case. You MAY call "
                "`research_visa_question` and relay what an official "
                "government page publishes, naming the publisher and pasting "
                "its url in the same sentence. If it returns nothing, or no "
                "sources are configured for their country, say a counsellor "
                "will come back with the answer — and say nothing else about "
                "visas."
            )
        return (
            " Do not answer the triggering topic yourself — not even "
            "generally, and do not research it."
        )

    def _gate(self, event: BeforeInvocationEvent) -> None:
        if not event.messages:
            return
        last_user = None
        for message in reversed(event.messages):
            if message.get("role") == "user":
                last_user = message
                break
        if last_user is None:
            return

        text = " ".join(
            block.get("text", "")
            for block in (last_user.get("content") or [])
            if isinstance(block, dict)
        )
        found = detect_trigger(text)
        if found is None:
            return
        trigger, matched = found

        try:
            escalation = self.client.escalate(
                self.lead_id,
                trigger,
                f"Auto-escalated by the harness on trigger {trigger!r} "
                f"(matched: {matched!r}). Student's message: {text[:400]}",
            )
        except Exception as exc:  # noqa: BLE001 — never take the turn down
            directive = (
                "[harness] An escalation trigger fired for this turn "
                f"({trigger}) but the escalation could not be recorded: "
                f"{exc}. Tell the student a counsellor will follow up, and do "
                "not answer the triggering topic yourself."
            )
        else:
            queued = escalation.counsellor_id is None
            directive = (
                f"[harness] This turn matched the escalation rule "
                f"'{trigger}'. The escalation has ALREADY been recorded as "
                f"{escalation.escalation_id}"
                + (
                    " and is in the unassigned queue for manual pickup."
                    if queued
                    else f" and assigned to counsellor {escalation.counsellor_id}."
                )
                + " Do NOT call escalate again for this. Tell the student a "
                "counsellor will pick that part up"
                + (
                    " (do not name a person or promise a time)."
                    if queued
                    else "."
                )
                + self._topic_directive(trigger)
                + " You may still help with anything else they asked."
            )

        # Prepend the directive so the model reads it before the student's
        # words, the same placement the plan and lead_facts blocks use.
        last_user.setdefault("content", []).insert(0, {"text": directive})


# ---------------------------------------------------------------------------
# 4. Grounding
# ---------------------------------------------------------------------------

# The tools whose results are UNVERIFIED. Named here rather than sniffed from
# the result shape so adding a third web tool is a one-line change in an
# obvious place — a web tool missing from this set would silently become a
# verified grounding source, which is the failure mode with no symptom.
WEB_TOOLS = frozenset({"research_visa_question", "find_unverified_programmes"})

# Links as they appear in a Brave result. Used to check that a reply actually
# carries the citation for what it claims.
_URL_RE = re.compile(r"https?://[^\s\"'<>)\]]+")

# Figures a student could act on: money, years, intake codes, test scores,
# percentages. Bare small integers are ignored — "three to five programmes"
# and "two years" are prose, not claims.
_CLAIM_RE = re.compile(
    r"(?:[£$€]\s?\d[\d,]*(?:\.\d+)?)"          # £24,500  $46,000
    r"|(?:\b\d{4}-\d{2}\b)"                     # 2027-09
    r"|(?:\b(?:19|20)\d{2}\b)"                  # 2027
    r"|(?:\b\d[\d,]{3,}(?:\.\d+)?\b)"           # 24500  24,500
    r"|(?:\b\d+(?:\.\d+)?\s?%)"                 # 90%
    r"|(?:\b\d\.\d\b)"                          # 6.5
)


def _normalise_number(token: str) -> str:
    """Canonical form so a reply and a tool result compare equal.

    A tool returns the float 24500.0; the agent writes "£24,500". Without
    collapsing both to "24500" every correctly-grounded fee reads as a
    violation — and a detector that cries wolf on true statements is worse
    than none, because you stop believing it.
    """
    digits = re.sub(r"[^\d.]", "", token).strip(".")
    if not digits:
        return token
    try:
        value = float(digits)
    except ValueError:
        return digits
    return str(int(value)) if value == int(value) else str(value)


@dataclass
class GroundingHook:
    """Flag reply content that no tool result in this turn supports.

    The one rule that outranks the rest is "never state a fee, deadline, or
    entry requirement that did not come from a tool result". A prompt can
    ask for that; it cannot check it.

    So: collect every tool result during the turn, then scan the drafted
    reply for figures a student could act on. Anything not traceable to a
    tool result is a grounding violation.

    WHY THIS HOOK IS TIER-AWARE. Adding web search broke the rule above
    without changing a word of it, because a search result IS a tool result.
    Brave returns paragraphs of marketing copy and government prose, and
    almost any number a model might invent appears SOMEWHERE in that text. A
    hook that pooled all evidence together would have gone from strict to
    decorative overnight, silently, with every test still passing.

    So evidence is split:

      verified    the catalogue and eligibility tools. Grounds a claim
                  outright — this consultancy stands behind the number.
      unverified  the web tools. Grounds a claim ONLY when the reply also
                  carries the citation, because "the Home Office publishes X
                  (link)" is a different act from asserting X.

    A number supported only by web text, in a reply with no link, is treated
    exactly like a number supported by nothing.

    HONEST LIMITATION. Strands lets an AfterModelCall hook write exactly one
    field — `retry`. There is no way to hand the model a correction, so the
    best available response is to discard the reply and call again once, and
    record the violation either way. A retry at temperature 0 may well
    reproduce the same sentence. Treat this as a detector that sometimes
    fixes things, not a guarantee — the guarantee lives in the tools, which
    are the only place a fee can legitimately come from.

    `violations` accumulates for the trace and for tests.
    """

    lead_id: str
    client: NorthboundClient
    max_retries: int = 1
    violations: list[dict] = field(default_factory=list)
    _seen: list[str] = field(default_factory=list)
    _web_seen: list[str] = field(default_factory=list)
    _web_urls: list[str] = field(default_factory=list)
    _retries: int = 0

    def register_hooks(self, registry: HookRegistry, **_: object) -> None:
        registry.add_callback(BeforeInvocationEvent, self._reset)
        registry.add_callback(AfterToolCallEvent, self._collect)
        registry.add_callback(AfterModelCallEvent, self._check)

    def _reset(self, _event: BeforeInvocationEvent) -> None:
        self._seen = []
        self._web_seen = []
        self._web_urls = []
        self._retries = 0

    def _collect(self, event: AfterToolCallEvent) -> None:
        payload = json.dumps(event.result, default=str, ensure_ascii=False)
        if (event.tool_use or {}).get("name") in WEB_TOOLS:
            self._web_seen.append(payload)
            self._web_urls.extend(_URL_RE.findall(payload))
        else:
            self._seen.append(payload)

    def _check(self, event: AfterModelCallEvent) -> None:
        response = getattr(event, "stop_response", None)
        if response is None:
            return
        text = " ".join(
            block.get("text", "")
            for block in (response.message.get("content") or [])
            if isinstance(block, dict)
        )
        if not text.strip():
            return

        verified_numbers = {
            _normalise_number(tok)
            for tok in _CLAIM_RE.findall(" ".join(self._seen))
        }
        web_numbers = {
            _normalise_number(tok)
            for tok in _CLAIM_RE.findall(" ".join(self._web_seen))
        }
        # A web-derived number is grounded only when the reply carries one of
        # the URLs those results came with. Checking against the URLs WE saw,
        # rather than for any link-shaped text, means the model cannot satisfy
        # the rule by inventing a plausible gov.uk path.
        cited = any(url in text for url in self._web_urls)

        unsupported = []
        web_uncited = []
        for tok in _CLAIM_RE.findall(text):
            value = _normalise_number(tok)
            if value in verified_numbers:
                continue
            if value in web_numbers:
                if not cited:
                    web_uncited.append(tok)
                continue
            unsupported.append(tok)

        if not unsupported and not web_uncited:
            return

        record = {
            "lead_id": self.lead_id,
            "unsupported": sorted(set(unsupported)),
            # Kept separate in the audit row: "you made this up" and "you read
            # it on the internet and didn't say where" are different failures
            # and a counsellor reviewing the trail should see which happened.
            "web_uncited": sorted(set(web_uncited)),
            "reply_excerpt": text[:240],
            "retried": self._retries < self.max_retries,
        }
        self.violations.append(record)
        # Land it in the audit trail — a hallucinated fee that gets caught
        # should be as visible to a counsellor as one that does not.
        try:
            self.client.record_tool_call(
                self.lead_id, "grounding_violation", {}, record, ok=False,
                error="ungrounded_claim",
            )
        except Exception:  # noqa: BLE001 — never take the turn down
            pass

        if self._retries < self.max_retries:
            self._retries += 1
            event.retry = True


# ---------------------------------------------------------------------------
# Citation — a web-derived reply must show its source
# ---------------------------------------------------------------------------


@dataclass
class CitationHook:
    """Require a source link in any reply built on web results.

    `GroundingHook` catches the numeric half of this: a figure that appears
    only in web text, in a reply with no link. But the worst web failures
    carry no numbers at all —

        "Processing is usually quite quick for Indian students."
        "That university is well regarded for data science."

    Nothing there matches a claim pattern, so the grounding check stays
    silent, and the student receives an assertion with no source, made by an
    agent that is not allowed to make assertions.

    This hook takes the blunter position: if a web tool ran and returned
    results this turn, the reply must contain one of the URLs those results
    came with. Not a link — one of THOSE links, checked against what we
    actually saw, so the model cannot satisfy the rule by inventing a
    plausible-looking gov.uk path.

    Two deliberate exemptions:

    - A turn where the web tool returned nothing (or errored) requires no
      citation. There is nothing to cite, and the agent is supposed to say so.
    - A reply that never got past the tool calls has no prose to check.

    SAME LIMITATION AS GroundingHook. `AfterModelCallEvent` exposes exactly
    one writable field, `retry`. There is no channel for "add the link", so
    the response is one retry plus an audit row either way. The real
    guarantee is upstream, in `sources.filter_results` — a link the student
    does receive is one we chose to trust.
    """

    lead_id: str
    client: NorthboundClient
    max_retries: int = 1
    violations: list[dict] = field(default_factory=list)
    _urls: list[str] = field(default_factory=list)
    _retries: int = 0

    def register_hooks(self, registry: HookRegistry, **_: object) -> None:
        registry.add_callback(BeforeInvocationEvent, self._reset)
        registry.add_callback(AfterToolCallEvent, self._collect)
        registry.add_callback(AfterModelCallEvent, self._check)

    def _reset(self, _event: BeforeInvocationEvent) -> None:
        self._urls = []
        self._retries = 0

    def _collect(self, event: AfterToolCallEvent) -> None:
        if (event.tool_use or {}).get("name") not in WEB_TOOLS:
            return
        self._urls.extend(_URL_RE.findall(json.dumps(event.result, default=str, ensure_ascii=False)))

    def _check(self, event: AfterModelCallEvent) -> None:
        if not self._urls:
            return  # no web results this turn — nothing to cite
        response = getattr(event, "stop_response", None)
        if response is None:
            return
        text = " ".join(
            block.get("text", "")
            for block in (response.message.get("content") or [])
            if isinstance(block, dict)
        )
        if not text.strip():
            return
        if any(url in text for url in self._urls):
            return

        record = {
            "lead_id": self.lead_id,
            "reason": "web results used without a source link",
            "available_urls": sorted(set(self._urls))[:5],
            "reply_excerpt": text[:240],
            "retried": self._retries < self.max_retries,
        }
        self.violations.append(record)
        try:
            self.client.record_tool_call(
                self.lead_id, "citation_violation", {}, record, ok=False,
                error="uncited_web_claim",
            )
        except Exception:  # noqa: BLE001 — never take the turn down
            pass

        if self._retries < self.max_retries:
            self._retries += 1
            event.retry = True


# ---------------------------------------------------------------------------
# History compaction — web pages shouldn't live in context forever
# ---------------------------------------------------------------------------

# Characters of page text kept per web result once the turn that fetched it
# is over. Enough to remember what the page was and roughly what it said;
# far short of re-reading it.
HISTORY_CONTENT_CHARS = 600

_TRUNCATED = "… [trimmed from history — search again for the full page]"

# The tool AgentSkills registers. Its result is the whole SKILL.md — 6,000 to
# 9,000 characters of procedure — returned as one plain string.
SKILLS_TOOL_NAME = "skills"

# What replaces a skill body once its turn is over. The invitation to re-load
# is the load-bearing half: without it a model that sees `skills(build-shortlist)`
# already in its history concludes it HAS the procedure and proceeds from a
# stub, which is worse than either keeping the body or never loading it.
_SKILL_STUB = (
    "[skill '{name}' was loaded in an earlier turn. Its procedure has been "
    "dropped from history to save context — you already acted on it then. "
    "If THIS turn needs those steps, call the skills tool for '{name}' again; "
    "re-loading is expected, not a mistake.]"
)
_SKILL_STUB_MARK = "dropped from history to save context"


@dataclass
class WebResultCompactorHook:
    """Shrink web page text in PAST turns, leaving the current one intact.

    A single `find_unverified_programmes` call returns three pages at 6,000
    characters each. The agent needs all of that to answer the question it
    was asked. It does not need to re-read three full course pages on every
    subsequent turn — but that is exactly what happens, because tool results
    stay in `agent.messages` and are re-sent with each request.

    The damage is not just cost. `SlidingWindowConversationManager` trims by
    MESSAGE COUNT, so those enormous results occupy the same 20 slots as a
    one-line reply, and a handful of web turns can push a whole conversation
    out of the window. Compacting the text does not free a slot, but it stops
    a 60,000-token context being mostly pages nobody is reading any more.

    Runs on BeforeInvocation, so everything it touches is from an earlier
    turn by definition — the current turn's results have not been fetched
    yet. `event.messages` is writable there; this is the one hook event that
    can rewrite history.

    Structure is preserved: the JSON is parsed, only the `content`/`text`
    fields are shortened, and every url and title survives. That matters
    because `CitationHook` checks replies against the urls we saw, and a
    blunt string truncation could cut one in half.

    Skill bodies get the same treatment for the same reason, but harder: they
    are REPLACED, not shortened. A SKILL.md runs 6,000–9,000 characters of
    procedure, and once the turn that loaded it has ended the agent has already
    followed it — re-reading the steps on every subsequent round buys nothing.
    Half a procedure is also worse than none, so truncating one at 600
    characters would leave the agent with the flow section and none of the
    anti-patterns. The stub keeps the skill's NAME (so the trace still shows
    what was loaded, and the model can see it once found this relevant) and
    tells it to re-load if it needs the steps again.

    The trade this makes: a conversation that stays inside one skill across
    several turns will re-load it, paying the ~9k tokens again. That is the
    losing case. The winning case — a skill loaded at turn 3 still riding
    along at turn 12, in every request — is the common one, and there is no
    version of this hook that gets both.
    """

    max_chars: int = HISTORY_CONTENT_CHARS
    compacted: int = 0
    skills_compacted: int = 0

    def register_hooks(self, registry: HookRegistry, **_: object) -> None:
        registry.add_callback(BeforeInvocationEvent, self._compact)

    def _shrink(self, payload: object) -> bool:
        """Recursively shorten `content`/`text` fields. Returns True if any
        were changed, so the caller only re-serialises when needed."""
        changed = False
        if isinstance(payload, dict):
            for key, value in payload.items():
                if (
                    key in ("content", "text")
                    and isinstance(value, str)
                    and len(value) > self.max_chars
                    # Already trimmed on an earlier turn. Re-trimming is
                    # idempotent (the head is the same 600 chars) but it
                    # re-serialises the whole result every turn and makes
                    # `compacted` count turns rather than results.
                    and not value.endswith(_TRUNCATED)
                ):
                    payload[key] = value[: self.max_chars] + _TRUNCATED
                    changed = True
                elif isinstance(value, (dict, list)):
                    changed |= self._shrink(value)
        elif isinstance(payload, list):
            for item in payload:
                changed |= self._shrink(item)
        return changed

    @staticmethod
    def _skill_name(use: dict) -> str:
        """The `skill_name` argument of a `skills` call. Providers hand tool
        input back as either a dict or a JSON string, so accept both."""
        payload = use.get("input")
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except (ValueError, TypeError):
                payload = None
        if isinstance(payload, dict):
            name = payload.get("skill_name")
            if isinstance(name, str) and name.strip():
                return name.strip()
        return "unknown"

    def _stub_skill(self, result: dict, name: str) -> bool:
        """Replace a skill result's body with the stub. Returns False if it was
        already stubbed on an earlier turn, so the counter reflects skills
        compacted rather than turns survived."""
        for part in result.get("content") or []:
            if isinstance(part, dict) and _SKILL_STUB_MARK in (part.get("text") or ""):
                return False
        result["content"] = [{"text": _SKILL_STUB.format(name=name)}]
        return True

    def _compact(self, event: BeforeInvocationEvent) -> None:
        # `event.messages` is NOT the conversation. Strands documents it as
        # "the input messages for this invocation" — the incoming user turn,
        # which by definition contains no tool results at all. Reading it here
        # made this hook a silent no-op: it found nothing to compact every
        # time and returned, while history grew unchecked.
        #
        # `event.agent.messages` is the live accumulated list, and mutating it
        # in place is what actually shrinks what gets re-sent.
        agent = getattr(event, "agent", None)
        messages = getattr(agent, "messages", None)
        if not messages:
            return

        # Resolve toolUseIds by tool NAME, so we only touch results we
        # understand. Matching on the id rather than sniffing the payload means
        # a catalogue result that happens to contain a "content" key is left
        # alone. Two buckets, two treatments: web results get shortened,
        # skill bodies get replaced outright.
        web_ids: set[str] = set()
        skill_ids: dict[str, str] = {}
        for message in messages:
            for block in message.get("content") or []:
                if not isinstance(block, dict):
                    continue
                use = block.get("toolUse") or block.get("tool_use")
                if not isinstance(use, dict):
                    continue
                tool_id = use.get("toolUseId") or use.get("tool_use_id")
                if not tool_id:
                    continue
                name = use.get("name")
                if name in WEB_TOOLS:
                    web_ids.add(tool_id)
                elif name == SKILLS_TOOL_NAME:
                    skill_ids[tool_id] = self._skill_name(use)
        if not web_ids and not skill_ids:
            return

        for message in messages:
            for block in message.get("content") or []:
                if not isinstance(block, dict):
                    continue
                result = block.get("toolResult") or block.get("tool_result")
                if not isinstance(result, dict):
                    continue
                tool_id = result.get("toolUseId") or result.get("tool_use_id")
                if tool_id in skill_ids:
                    if self._stub_skill(result, skill_ids[tool_id]):
                        self.skills_compacted += 1
                    continue
                if tool_id not in web_ids:
                    continue
                for part in result.get("content") or []:
                    if not isinstance(part, dict):
                        continue
                    if isinstance(part.get("json"), (dict, list)):
                        if self._shrink(part["json"]):
                            self.compacted += 1
                        continue
                    text = part.get("text")
                    if not isinstance(text, str) or len(text) <= self.max_chars:
                        continue
                    try:
                        parsed = json.loads(text)
                    except (ValueError, TypeError):
                        # Not JSON — truncate the raw string rather than
                        # leaving a 6k blob, but keep the head so the model
                        # can still tell what the call was.
                        part["text"] = text[: self.max_chars] + _TRUNCATED
                        self.compacted += 1
                        continue
                    if self._shrink(parsed):
                        part["text"] = json.dumps(parsed, ensure_ascii=False)
                        self.compacted += 1
