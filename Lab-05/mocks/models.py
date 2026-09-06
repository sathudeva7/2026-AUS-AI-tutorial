"""Pydantic models for the Northbound mock backend.

These shapes are what the client returns; tools call `model_dump()` on them
to hand structured dicts to the agent.

Three rules from the agent spec are encoded in the TYPES rather than left to
the system prompt, because a prompt-only rule is a v1 rule:

1. **Facts are stated, never inferred.** Every entry in `LeadFacts` is a
   `Fact`, and a `Fact` cannot be constructed without `source_quote` — the
   student's own words. "The agent guessed" becomes a validation error
   instead of a plausible-looking record.

2. **`indeterminate` is a first-class outcome.** `RequirementCheck.verdict`
   is a three-way Literal, not a bool, and an indeterminate check cannot be
   built without naming the `resolving_document` that would settle it. The
   spec's "tell the student exactly which document would resolve it" is
   therefore unskippable.

3. **Confidence is computed, not asserted.** `EligibilityResult` is only
   constructible via `from_checks()`, which derives the score from the
   verdicts. The LLM never picks the number it is later gated on — which
   matters, because self-reported model confidence is not calibrated.

`Shortlist` carries the same idea one level up: it cannot hold fewer than 3
or more than 5 entries, and it cannot be built below the 0.6 confidence
floor. Presenting a weak shortlist isn't discouraged; it's unrepresentable.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

# ---------------------------------------------------------------------------
# Vocabularies
# ---------------------------------------------------------------------------

# Three-way, deliberately. A bool would force "can't tell" to collapse into
# "no", which is the single failure this agent exists to avoid.
Verdict = Literal["pass", "fail", "indeterminate"]

# The complete escalation trigger list from the spec. Escalation is
# rule-driven, not judgement-driven, so the triggers are a closed set the
# pre-model gate can match against — not free text the LLM composes.
EscalationTrigger = Literal[
    "visa_refusal",
    "fee_dispute",
    "dependants_or_sponsorship",
    "low_confidence",
    "student_requested_human",
    "visa_or_immigration_advice",
    # Not a student-side trigger: the backend failed repeatedly and the agent
    # cannot answer without guessing. Without this the agent has no honest
    # label for "hand this to a human because the system is broken", and
    # would have to mislabel it as one of the above.
    "system_failure",
]

LeadStatus = Literal["active", "parked", "escalated", "withdrawn", "converted"]
FollowupStatus = Literal["pending", "fired", "cancelled"]
FollowupKind = Literal[
    "document_chase",
    "test_result",
    "intake_cutoff",
    "deposit_deadline",
    # A programme found on the web that is NOT in the verified catalogue. The
    # agent may surface it to the student as a candidate, but a human has to
    # check it into the catalogue before it can be checked, scored, or
    # shortlisted. Without this row the candidate is a sentence in a chat log
    # that nobody ever acts on.
    "catalogue_verification",
]

# Which LeadFacts field a requirement tests. Keeping this a closed set means
# a seed file with a typo'd key fails at load, not silently at match time.
FactKey = Literal[
    "target_country",
    "field_of_study",
    "qualification",
    "grades",
    "english_test",
    "budget_per_year",
    "intended_intake",
]


# ---------------------------------------------------------------------------
# Lead facts — the accumulating record
# ---------------------------------------------------------------------------


class Fact(BaseModel):
    """One thing the student actually said.

    `source_quote` is the load-bearing field: it must be the student's own
    words from the message history, and `update_lead_facts` is expected to
    reject a write whose quote doesn't appear there. That turns "never infer
    a missing field" from prompt guidance into something the harness checks.

    `value` is the normalised reading of that quote ("IELTS 6.5" from "i got
    a 6.5 overall in ielts"). Normalising is allowed; inventing is not.
    """

    value: str | float | int
    source_quote: str = Field(min_length=1)
    stated_at: str = ""  # ISO timestamp of the message it came from


class LeadFacts(BaseModel):
    """What we know about this lead, and nothing more.

    Every field is optional and every absent field means NOT YET STATED —
    never "assume the default". The agent asks for what `missing()` returns
    rather than filling gaps itself.
    """

    target_country: Fact | None = None
    field_of_study: Fact | None = None
    qualification: Fact | None = None
    grades: Fact | None = None
    english_test: Fact | None = None
    budget_per_year: Fact | None = None
    intended_intake: Fact | None = None

    def missing(self) -> list[str]:
        """Fact keys with no stated value yet — the agent's next questions."""
        return [name for name, val in self if val is None]

    def known(self) -> dict[str, str | float | int]:
        """Flat key → value view for prompt rendering and requirement matching."""
        return {name: val.value for name, val in self if val is not None}


class Lead(BaseModel):
    lead_id: str
    tenant_id: str
    email: str
    name: str | None = None
    country_of_residence: str | None = None
    status: LeadStatus = "active"
    facts: LeadFacts = Field(default_factory=LeadFacts)
    # Set by escalate / book_slot via Counsellor.countries. None means the
    # lead is sitting in the unassigned queue — the agent never round-robins
    # to fill the gap, so None is a real state the dashboard must render.
    assigned_counsellor_id: str | None = None
    created_at: str = ""


# ---------------------------------------------------------------------------
# Conversation + audit trail
# ---------------------------------------------------------------------------


class Message(BaseModel):
    lead_id: str
    role: Literal["student", "agent"]
    content: str
    timestamp: str = ""


class ToolCall(BaseModel):
    """One row of the audit trail, keyed to the lead.

    The spec's hard requirement is that any agent decision be reconstructable
    from ToolCall + Message alone — so this records the FULL args and the FULL
    result, not a summary. The counsellor dashboard renders these as a
    timeline; the internal assistant queries over them. Neither creates new
    agent behaviour, so this table is the only contract between them.
    """

    call_id: str
    lead_id: str
    tool: str
    args: dict
    result: dict | list | str | None = None
    ok: bool = True
    error: str | None = None
    agent_id: str = ""
    timestamp: str = ""


# ---------------------------------------------------------------------------
# Programme catalogue
# ---------------------------------------------------------------------------


class Requirement(BaseModel):
    """One entry requirement on a programme.

    `key` names the LeadFacts field this tests, so `check_requirements` can
    pair requirement to fact mechanically instead of asking the LLM to guess
    which of the student's details is relevant.
    """

    requirement_id: str
    key: FactKey
    rule: str  # machine-ish rule text, e.g. "bachelor_years>=4"
    description: str  # what the student would be told, in plain English
    mandatory: bool = True


class Programme(BaseModel):
    """A verified catalogue entry.

    `search_programmes` returns ONLY these. The agent may not state a fee,
    deadline, or entry requirement from its own knowledge, so anything absent
    here does not exist as far as the student is concerned. `verified_at` is
    the provenance stamp that makes that claim auditable.
    """

    programme_id: str
    institution: str
    country: str
    city: str
    name: str
    level: str  # foundation | bachelors | masters | phd
    field: str
    tuition_per_year: float
    currency: str
    duration_months: int
    intakes: list[str]  # e.g. ["2027-01", "2027-09"]
    application_deadline: str  # ISO date
    requirements: list[Requirement] = Field(default_factory=list)
    verified_at: str = ""  # ISO date this entry was last confirmed


# ---------------------------------------------------------------------------
# Eligibility
# ---------------------------------------------------------------------------


class RequirementCheck(BaseModel):
    """The outcome of testing one requirement against one lead's facts.

    `indeterminate` covers two situations that need OPPOSITE responses, so
    each check says which one it is:

      missing_fact=True   nobody has told us this yet. The fix is a question.
                          "What's your budget?" — ask, get an answer, done.

      resolving_document  we have what they said and still cannot map it.
                          The fix is paperwork: a transcript, an equivalency
                          report, a test report form.

    Exactly one of the two is set. Collapsing them — which this model used to
    do, by inventing a "document" called "the student's budget per year" —
    sends the agent chasing a document that does not exist for an answer it
    could have had by asking. Every downstream consumer reads this flag to
    pick between `qualify-lead` and `handle-indeterminate`.
    """

    requirement_id: str
    key: FactKey
    verdict: Verdict
    reason: str
    # Copied through from the Requirement so scoring doesn't need to re-join
    # against the programme. A failed optional requirement dents confidence;
    # a failed mandatory one ends the match.
    mandatory: bool = True
    # Indeterminate only: the ONE document that would settle it. `key` already
    # names what to ask for, so there is no matching field for the ask path.
    resolving_document: str | None = None
    # Indeterminate only: True when the student simply hasn't said.
    missing_fact: bool = False

    @model_validator(mode="after")
    def _indeterminate_has_exactly_one_next_step(self) -> RequirementCheck:
        if self.verdict == "indeterminate":
            if self.missing_fact and self.resolving_document:
                raise ValueError(
                    f"requirement {self.requirement_id}: a missing fact is answered "
                    "by asking, not by a document — set one or the other"
                )
            if not self.missing_fact and not self.resolving_document:
                raise ValueError(
                    f"requirement {self.requirement_id}: an indeterminate verdict "
                    "must either name the resolving_document that would settle it "
                    "or be flagged missing_fact"
                )
        else:
            if self.resolving_document:
                raise ValueError(
                    f"requirement {self.requirement_id}: resolving_document is only "
                    f"meaningful for indeterminate, got verdict={self.verdict!r}"
                )
            if self.missing_fact:
                raise ValueError(
                    f"requirement {self.requirement_id}: missing_fact is only "
                    f"meaningful for indeterminate, got verdict={self.verdict!r}"
                )
        return self


class EligibilityResult(BaseModel):
    """Per-programme eligibility, with a CONFIDENCE THE MODEL DID NOT CHOOSE.

    Build via `from_checks()`. Constructing one directly is possible in
    Python but pointless — the whole value of this type is that the number
    the 0.6 gate reads is derived from the verdicts in the same row, so a
    counsellor auditing the decision can recompute it by hand.

    The rule, deliberately simple enough to put on a slide:

      any MANDATORY fail        → fail,          confidence 0.0
      any indeterminate         → indeterminate, confidence = passed / total
      only OPTIONAL fails       → pass,          confidence = passed / total
      everything passed         → pass,          confidence 1.0
    """

    programme_id: str
    checks: list[RequirementCheck]
    verdict: Verdict
    confidence: float
    # The single requirement the match turns on — what the shortlist shows
    # next to each entry. None only when everything passed cleanly.
    hinge_requirement_id: str | None = None
    # The two ways this result can be undecided, split so the agent doesn't
    # have to re-scan `checks` to tell them apart:
    #   missing_facts       — fact keys nobody has stated. ASK for these.
    #   pending_documents   — paperwork that would settle the rest. CHASE these.
    # A programme blocked only by missing_facts needs a question, not an
    # escalation and not a document chase.
    missing_facts: list[FactKey] = Field(default_factory=list)
    pending_documents: list[str] = Field(default_factory=list)

    @classmethod
    def from_checks(
        cls, programme_id: str, checks: list[RequirementCheck]
    ) -> EligibilityResult:
        if not checks:
            # No requirements on file is not the same as "meets them all".
            return cls(
                programme_id=programme_id,
                checks=[],
                verdict="indeterminate",
                confidence=0.0,
                hinge_requirement_id=None,
            )

        blocking = [c for c in checks if c.verdict == "fail" and c.mandatory]
        unknown = [c for c in checks if c.verdict == "indeterminate"]
        soft_fail = [c for c in checks if c.verdict == "fail" and not c.mandatory]
        passed = [c for c in checks if c.verdict == "pass"]
        ratio = round(len(passed) / len(checks), 2)

        if blocking:
            verdict: Verdict = "fail"
            confidence = 0.0
            hinge = blocking[0].requirement_id
        elif unknown:
            # Indeterminate outranks a soft fail: "we can't tell" is the
            # outcome that needs a document from the student, and the spec
            # says prefer it over a guess in either direction.
            verdict = "indeterminate"
            confidence = ratio
            # Hinge on something we can actually chase before something we
            # merely haven't asked about. A missing answer is cheap to fix
            # and is reported separately in `missing_facts`; if a document is
            # also outstanding, that is the harder blocker and the one worth
            # showing next to the programme.
            hinge = next(
                (c.requirement_id for c in unknown if not c.missing_fact),
                unknown[0].requirement_id,
            )
        elif soft_fail:
            verdict = "pass"
            confidence = ratio
            hinge = soft_fail[0].requirement_id
        else:
            verdict = "pass"
            confidence = 1.0
            hinge = None

        # Deduplicated, order preserved — the agent reads these top to bottom
        # when deciding what to ask for and what to chase.
        missing = list(dict.fromkeys(c.key for c in unknown if c.missing_fact))
        documents = list(
            dict.fromkeys(
                c.resolving_document for c in unknown if c.resolving_document
            )
        )

        return cls(
            programme_id=programme_id,
            checks=checks,
            verdict=verdict,
            confidence=confidence,
            hinge_requirement_id=hinge,
            missing_facts=missing,
            pending_documents=documents,
        )


# ---------------------------------------------------------------------------
# Shortlist
# ---------------------------------------------------------------------------

# The structural hard minimum. Below this the agent escalates instead of
# presenting, and `Shortlist` refuses to construct at all.
#
# A tenant may raise this via agent-profile.yaml's `confidence_floor`, but
# never lower it: `profile.load_profile` clamps the configured value up to
# this number, and `client.build_shortlist` clamps again. A YAML typo can
# therefore only make the agent more cautious, never less — which is the
# only direction a config mistake should be able to move a safety gate.
CONFIDENCE_FLOOR = 0.6


class ShortlistEntry(BaseModel):
    """One programme on the shortlist, with the reason it's there.

    An `indeterminate` entry is allowed on a shortlist — a programme whose
    match turns on a document we haven't seen is still worth showing, and
    the missing document is the single most useful thing to tell a student.
    But it must be presented AS undecided, which is why `verdict` and
    `resolving_document` ride along: `hinge` alone is just the requirement's
    description text, identical whether it passed or couldn't be judged.
    Without these two the agent cannot tell "you meet this" from "we can't
    tell yet", and would present the second as the first.
    """

    programme_id: str
    confidence: float
    # Names the single requirement this match hinges on, in plain English —
    # so the student sees WHY it's a match, not just that it is.
    hinge: str
    # Carried through from the EligibilityResult so the agent can distinguish
    # a settled match from an undecided one without re-running the check.
    verdict: Verdict = "pass"
    # Indeterminate only, and the same split as RequirementCheck: paperwork to
    # chase versus answers to ask for. An entry undecided ONLY on missing_facts
    # is a question away from being settled — say so, rather than telling the
    # student to go and find a document.
    resolving_document: str | None = None
    missing_facts: list[FactKey] = Field(default_factory=list)

    @model_validator(mode="after")
    def _indeterminate_has_a_next_step(self) -> ShortlistEntry:
        if self.verdict == "indeterminate" and not (
            self.resolving_document or self.missing_facts
        ):
            raise ValueError(
                f"shortlist entry {self.programme_id}: an indeterminate entry must "
                "name either the resolving_document or the missing facts that "
                "would settle its hinge"
            )
        if self.verdict != "indeterminate" and (
            self.resolving_document or self.missing_facts
        ):
            raise ValueError(
                f"shortlist entry {self.programme_id}: resolving_document and "
                f"missing_facts are only meaningful for indeterminate, got "
                f"verdict={self.verdict!r}"
            )
        if self.verdict == "fail":
            raise ValueError(
                f"shortlist entry {self.programme_id}: a failed match cannot be "
                "shortlisted"
            )
        return self


class Shortlist(BaseModel):
    """Three to five programmes, none of them below the floor.

    Both spec rules are enforced structurally: a two-programme shortlist and
    a 0.4-confidence shortlist are unrepresentable, so the escalate path is
    the only way out when the agent can't meet the bar.
    """

    lead_id: str
    entries: list[ShortlistEntry] = Field(min_length=3, max_length=5)
    overall_confidence: float

    @model_validator(mode="after")
    def _meets_floor(self) -> Shortlist:
        if self.overall_confidence < CONFIDENCE_FLOOR:
            raise ValueError(
                f"overall_confidence {self.overall_confidence:.2f} is below the "
                f"{CONFIDENCE_FLOOR} floor — escalate instead of presenting"
            )
        return self


# ---------------------------------------------------------------------------
# Routing, escalation, follow-ups
# ---------------------------------------------------------------------------


class Counsellor(BaseModel):
    """`countries` is the routing key. escalate and book_slot assign by it;
    when no counsellor owns the student's country the lead goes to the
    unassigned queue rather than to whoever happens to be free."""

    counsellor_id: str
    name: str
    email: str
    countries: list[str]
    active: bool = True


class Escalation(BaseModel):
    escalation_id: str
    lead_id: str
    trigger: EscalationTrigger
    detail: str  # what the counsellor needs so they don't re-investigate
    # None means the unassigned queue — no counsellor owns this country.
    counsellor_id: str | None = None
    created_at: str = ""


class Followup(BaseModel):
    """Anything with a date becomes one of these — follow-ups are scheduled,
    not remembered. A background worker fires them; a student reply or a
    withdrawal cancels the pending ones."""

    followup_id: str
    lead_id: str
    kind: FollowupKind
    due_at: str  # ISO timestamp
    reason: str
    status: FollowupStatus = "pending"
    created_at: str = ""


class Slot(BaseModel):
    """A bookable counsellor appointment — what `book_slot` writes."""

    slot_id: str
    lead_id: str
    counsellor_id: str
    starts_at: str  # ISO timestamp
    duration_minutes: int = 30
    created_at: str = ""
