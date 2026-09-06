"""NorthboundClient — file-backed mock backend, scoped by workspace.

Two separate ideas, deliberately two constructor parameters:

- `workspace` picks the data directory, `mocks/data/<workspace>/`.
- `agent_id` says who is acting, and is stamped on every ToolCall row.

The student agent and the counsellor agent SHARE a workspace — a counsellor
asking "what happened with this lead?" has to see what the student-facing
agent wrote — while each signs its own name in the audit trail. Omit
`workspace` and it defaults to `agent_id`, giving one isolated room per
agent; that is the right setting for a v1-vs-v2 twin, where the whole point
is that each agent acts on the world it created rather than one contaminated
by the other's writes.

Two classes of file live in that directory:

- **Seeded** (`programmes.json`, `leads.json`, `counsellors.json`) — copied
  from the read-only canonical seeds at `mocks/seeds/` on first use. The
  catalogue and the existing lead book are the world as it already is.
- **Runtime** (`messages.json`, `toolcalls.json`, `followups.json`,
  `escalations.json`, `slots.json`) — initialised EMPTY. Conversations,
  audit rows, and follow-ups are things the agent creates by doing its job;
  shipping them as fixtures would be shipping the answer.

Why file-backed and not pure in-memory: the MCP subprocesses are re-spawned
whenever the cached Agent is dropped. An in-memory client would lose every
mutation on that respawn — escalations would silently disappear, follow-ups
would vanish, and the demo would run backwards from intended. Disk-backed
state survives the subprocess lifecycle because the new client just reads
the JSON the previous one wrote.

The client holds a per-process in-memory cache for speed; it is refreshed
from disk on every mutation made by THIS instance.

Two guarantees are enforced HERE, server-side, not just in the prompt:

1. `update_lead_fact` rejects a fact whose `source_quote` does not appear in
   the lead's own messages. "Never infer a missing field" becomes a
   backend rule rather than a hope. Facts loaded from the seeds are
   historical — they came from sessions whose transcripts we don't ship —
   so the check applies only to writes made during a live session.
2. `build_shortlist` applies the 3–5 rule and the 0.6 confidence floor
   below the agent, so a weak shortlist cannot be presented even by a
   prompt-injected model. It raises `ShortlistUnavailable`, which the
   caller turns into an escalation.

Both mirror Lab-01's `can_refund()` + `RefundCapHook` pairing: the backend
refuses, and a harness hook refuses earlier. Defense in depth.

To reset state: call `reset()` (or `reset_data_files(workspace)` without an
instance) — wipes only that workspace's files, re-copies the seeds, and
empties the runtime files.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, get_args

from mocks.models import (
    CONFIDENCE_FLOOR,
    Counsellor,
    EligibilityResult,
    Escalation,
    EscalationTrigger,
    Fact,
    FactKey,
    Followup,
    FollowupKind,
    Lead,
    LeadStatus,
    Message,
    Programme,
    Requirement,
    RequirementCheck,
    Shortlist,
    ShortlistEntry,
    Slot,
    ToolCall,
)

SEEDS_DIR = Path(__file__).parent / "seeds"
DATA_ROOT = Path(__file__).parent / "data"

PROGRAMMES_FILE = "programmes.json"
LEADS_FILE = "leads.json"
COUNSELLORS_FILE = "counsellors.json"
MESSAGES_FILE = "messages.json"
TOOLCALLS_FILE = "toolcalls.json"
FOLLOWUPS_FILE = "followups.json"
ESCALATIONS_FILE = "escalations.json"
SLOTS_FILE = "slots.json"

# Copied from mocks/seeds/ — the world as it already is.
SEEDED_FILES = (PROGRAMMES_FILE, LEADS_FILE, COUNSELLORS_FILE)

# Episodic notes: one markdown file per lead under `<workspace>/notes/`.
# Deliberately in the SHARED workspace rather than inside one agent's
# directory — the counsellor agent is a separate service and needs to read
# these for its briefing. Free-text markdown, no schema, same as Lab-01's
# per-customer memory files.
NOTES_DIR = "notes"

# Created empty — the world the agent builds. Shipping these as fixtures
# would be shipping the answer.
RUNTIME_FILES: dict[str, list] = {
    MESSAGES_FILE: [],
    TOOLCALLS_FILE: [],
    FOLLOWUPS_FILE: [],
    ESCALATIONS_FILE: [],
    SLOTS_FILE: [],
}

VALID_FACT_KEYS = frozenset(get_args(FactKey))
VALID_TRIGGERS = frozenset(get_args(EscalationTrigger))
VALID_STATUSES = frozenset(get_args(LeadStatus))
VALID_FOLLOWUP_KINDS = frozenset(get_args(FollowupKind))


# ---------------------------------------------------------------------------
# Errors — structured refusals the MCP layer turns into tool results
# ---------------------------------------------------------------------------


class NorthboundError(Exception):
    """Base for backend refusals that the agent is expected to handle."""


class FactNotStated(NorthboundError):
    """A fact write whose source_quote isn't in the lead's own messages."""


class ShortlistUnavailable(NorthboundError):
    """Not enough programmes clear the floor. Carries the escalation trigger."""

    def __init__(self, reason: str, trigger: str = "low_confidence") -> None:
        super().__init__(reason)
        self.reason = reason
        self.trigger = trigger


class NoCounsellorAvailable(NorthboundError):
    """No ACTIVE counsellor owns this country — cannot book against nobody."""


# ---------------------------------------------------------------------------
# Data-dir plumbing
# ---------------------------------------------------------------------------


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _load_seed(name: str):
    return json.loads((SEEDS_DIR / name).read_text())


def _workspace_dir(workspace: str) -> Path:
    if not workspace:
        raise ValueError("workspace is required — it names the data dir to work in")
    return DATA_ROOT / workspace


def _seed_if_missing(data_dir: Path) -> None:
    """Lazy initialisation. Seeded files are copied from the canonical seeds;
    runtime files are created empty. Existing files are left alone — that's
    how mid-demo state survives an MCP subprocess restart."""
    data_dir.mkdir(parents=True, exist_ok=True)
    for name in SEEDED_FILES:
        target = data_dir / name
        if not target.exists():
            target.write_text(json.dumps(_load_seed(name), indent=2) + "\n")
    for name, empty in RUNTIME_FILES.items():
        target = data_dir / name
        if not target.exists():
            target.write_text(json.dumps(empty, indent=2) + "\n")


def reset_data_files(workspace: str) -> None:
    """Delete this workspace's files and re-initialise: seeds re-copied, runtime
    files emptied, episodic notes removed. Only the named workspace is touched —
    a sibling workspace (say, a v1 agent's isolated world) is left alone.

    Notes are swept here too. A reset that wipes the ledger but leaves a lead's
    notes behind is worse than no reset at all: the agent walks into the next
    demo remembering a conversation the data says never happened."""
    data_dir = _workspace_dir(workspace)
    data_dir.mkdir(parents=True, exist_ok=True)
    for name in (*SEEDED_FILES, *RUNTIME_FILES):
        target = data_dir / name
        if target.exists():
            target.unlink()
    notes_dir = data_dir / NOTES_DIR
    if notes_dir.exists():
        for note in notes_dir.glob("lead_*.md"):
            note.unlink()
    _seed_if_missing(data_dir)


# ---------------------------------------------------------------------------
# Requirement rule evaluation
# ---------------------------------------------------------------------------

_YEARS_RE = re.compile(r"(\d+)\s*-?\s*year", re.IGNORECASE)
_NUMBER_RE = re.compile(r"(\d+(?:\.\d+)?)")


def _threshold(rule: str) -> float:
    """Pull N out of `key>=N` / `key<=N`."""
    return float(re.split(r"[<>]=", rule)[-1])


def _degree_years(value: Any) -> int | None:
    match = _YEARS_RE.search(str(value))
    return int(match.group(1)) if match else None


def _number(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    match = _NUMBER_RE.search(str(value))
    return float(match.group(1)) if match else None


# Intake codes are YYYY-MM ("2027-09"). Matched loosely enough to survive a
# value the agent wrapped in words ("starting 2027-09") but strictly enough
# that "any intake next year" reads as no intake at all rather than as one.
_INTAKE_RE = re.compile(r"\b(20\d{2})-(0[1-9]|1[0-2])\b")


def _intake_code(value: Any) -> str | None:
    match = _INTAKE_RE.search(str(value))
    return f"{match.group(1)}-{match.group(2)}" if match else None


def evaluate_requirement(
    req: Requirement, facts_known: dict[str, Any], programme: Programme
) -> RequirementCheck:
    """Test one requirement against one lead's stated facts.

    The whole point of this function is the third outcome. A missing fact, an
    unparseable qualification, or a degree shorter than the rule are all
    `indeterminate` — never `fail` — because none of them mean the student
    doesn't qualify. They mean we cannot tell yet, and each one names the
    document that would settle it.
    """
    def check(
        verdict: str,
        reason: str,
        doc: str | None = None,
        missing: bool = False,
    ) -> RequirementCheck:
        return RequirementCheck(
            requirement_id=req.requirement_id,
            key=req.key,
            verdict=verdict,  # type: ignore[arg-type]
            reason=reason,
            mandatory=req.mandatory,
            resolving_document=doc,
            missing_fact=missing,
        )

    value = facts_known.get(req.key)
    if value is None:
        # Nobody has asked. This used to invent a "document" named after the
        # fact — "the student's budget per year" — which sent the agent
        # chasing paperwork for something a question answers in one turn.
        pretty = req.key.replace("_", " ")
        return check(
            "indeterminate",
            f"the student has not stated their {pretty}",
            missing=True,
        )

    if req.key == "qualification":
        need = int(_threshold(req.rule))
        got = _degree_years(value)
        if got is None:
            return check(
                "indeterminate",
                f"cannot read a degree length from {value!r}",
                "official transcript showing programme duration",
            )
        if got < need:
            # THE case from the spec. A 3-year degree against a 4-year rule is
            # not a rejection — plenty of such degrees are accepted on
            # evidence. Guessing either way is the failure mode.
            return check(
                "indeterminate",
                f"{got}-year degree against a {need}-year requirement; "
                "cannot be mapped without evidence",
                "official transcript with credit hours, or a WES/ECA "
                "equivalency report",
            )
        return check("pass", f"{got}-year degree meets the {need}-year requirement")

    if req.key == "grades":
        need = _threshold(req.rule)
        got = _number(value)
        if got is None:
            return check(
                "indeterminate",
                f"cannot read a percentage from {value!r} — grading scale unknown",
                "official transcript with the institution's grading scale",
            )
        if got < need:
            return check("fail", f"{got:g}% against {need:g}% required")
        return check("pass", f"{got:g}% meets the {need:g}% requirement")

    if req.key == "english_test":
        need = _threshold(req.rule)
        got = _number(value)
        if got is None:
            return check(
                "indeterminate",
                f"cannot read a band score from {value!r}",
                "the English test report form (TRF)",
            )
        if got < need:
            return check("fail", f"{value} against IELTS {need:g} required")
        return check("pass", f"{value} meets the IELTS {need:g} requirement")

    if req.key == "intended_intake":
        code = _intake_code(value)
        if code is None:
            # "any intake next year", "sometime in autumn", "ASAP" — the
            # student has said SOMETHING about timing but not named an
            # intake. That is not a rejection: they have not chosen an
            # intake this programme doesn't run, they have not chosen one at
            # all. Failing here hard-zeroes the programme on a vague answer
            # and buries four perfectly good matches, which is exactly the
            # guess this function exists to refuse to make.
            # They said something about timing but did not name an intake.
            # No document fixes that; asking which intake does.
            return check(
                "indeterminate",
                f"cannot read an intake from {value!r} — "
                f"open intakes are {', '.join(programme.intakes)}",
                missing=True,
            )
        if code not in programme.intakes:
            # They named a real intake and this programme does not run it.
            # That IS a genuine mismatch, not an unknown.
            return check(
                "fail",
                f"{code} is not an open intake (available: {', '.join(programme.intakes)})",
            )
        return check("pass", f"{code} is an open intake")

    if req.key == "budget_per_year":
        budget = _number(value)
        if budget is None:
            # Same shape as the intake case: a vague answer about money is
            # still an answer we can just ask them to make specific.
            return check(
                "indeterminate",
                f"cannot read a budget figure from {value!r}",
                missing=True,
            )
        if programme.tuition_per_year > budget:
            return check(
                "fail",
                f"tuition {programme.currency} {programme.tuition_per_year:,.0f} "
                f"exceeds the stated budget of {budget:,.0f}",
            )
        return check(
            "pass",
            f"tuition {programme.currency} {programme.tuition_per_year:,.0f} "
            f"is within the stated budget",
        )

    # Unreachable while FactKey and this dispatch stay in sync; if a new key
    # is added to the Literal without a branch here, say so rather than
    # silently passing the requirement.
    return check(
        "indeterminate",
        f"no rule evaluator for requirement key {req.key!r}",
        "manual review by a counsellor",
    )


# ---------------------------------------------------------------------------
# The client
# ---------------------------------------------------------------------------


class NorthboundClient:
    """File-backed backend for the overseas-education consultancy.

    State lives on disk under `mocks/data/<workspace>/`. A per-instance cache
    speeds up reads within a process; every mutation writes through to disk
    so a fresh instance (an MCP subprocess respawn, say) picks up the world
    as the previous one left it.
    """

    def __init__(self, agent_id: str, workspace: str | None = None) -> None:
        # Two separate jobs, deliberately two parameters:
        #   agent_id  — WHO is acting; stamped on every ToolCall row.
        #   workspace — WHICH data dir to work in.
        # The student and counsellor agents share one workspace (the
        # counsellor must see what the student agent wrote) while signing
        # their own name in the audit trail. Omitting `workspace` gives one
        # room per agent, which is what you want for a v1-vs-v2 twin whose
        # worlds are supposed to stay isolated.
        self._agent_id = agent_id
        self._workspace = workspace or agent_id
        self._data_dir = _workspace_dir(self._workspace)
        _seed_if_missing(self._data_dir)
        self._reload_cache()

    # Every file this client caches. Ordered so `_stamps` is comparable.
    _CACHED_FILES = (
        PROGRAMMES_FILE,
        LEADS_FILE,
        COUNSELLORS_FILE,
        MESSAGES_FILE,
        TOOLCALLS_FILE,
        FOLLOWUPS_FILE,
        ESCALATIONS_FILE,
        SLOTS_FILE,
    )

    def _reload_cache(self) -> None:
        read = lambda name: json.loads((self._data_dir / name).read_text())  # noqa: E731
        self._programmes: dict = read(PROGRAMMES_FILE)
        self._leads: dict = read(LEADS_FILE)
        self._counsellors: dict = read(COUNSELLORS_FILE)
        self._messages: list = read(MESSAGES_FILE)
        self._toolcalls: list = read(TOOLCALLS_FILE)
        self._followups: list = read(FOLLOWUPS_FILE)
        self._escalations: list = read(ESCALATIONS_FILE)
        self._slots: list = read(SLOTS_FILE)
        self._stamps = self._disk_stamps()

    def _disk_stamps(self) -> tuple:
        out = []
        for name in self._CACHED_FILES:
            try:
                out.append((self._data_dir / name).stat().st_mtime_ns)
            except FileNotFoundError:
                out.append(-1)
        return tuple(out)

    def _refresh(self) -> None:
        """Reload if anyone else has written since our last read.

        Writes reload first (see `record_tool_call`), but READS were served
        straight from the cache — and this client is not the only writer.
        The harness process and the MCP subprocess each hold one against the
        same workspace, and they split the work: `update_lead_facts` runs in
        the harness, `check_requirements` and `build_shortlist` run in the
        subprocess.

        So the subprocess answered from the lead as it looked when it booted.
        Facts written earlier in the same turn were invisible to the
        eligibility check that depends on them, and every requirement came
        back `indeterminate` for a fact the student had actually stated. That
        does not surface as an error — it surfaces as a confident wrong
        verdict and a spurious escalation, which is worse.

        mtime-gated, so the ordinary case costs eight `stat` calls rather
        than eight file reads.
        """
        if self._disk_stamps() != self._stamps:
            self._reload_cache()

    def reset(self) -> None:
        """Clear the workspace this client works in — not just this agent's
        share of it. Both agents pointed at the same workspace see the reset."""
        reset_data_files(self._workspace)
        self._reload_cache()

    # ----- Disk write-through ------------------------------------------------

    def _flush(self, name: str, payload) -> None:
        """Write atomically: temp file in the same directory, then rename.

        `write_text` truncates and then writes, which is not atomic. Two
        processes writing the same path (the harness and the MCP subprocess
        both hold a client against this workspace) can interleave: both
        truncate to zero, both write from offset 0, and the longer write's
        tail survives past the end of the shorter one. The result is a file
        containing a complete JSON document followed by garbage — `json.loads`
        fails with "Extra data" and every subsequent read of that workspace
        raises.

        That is not hypothetical; it happened and took the service down. A
        rename is atomic on POSIX, so a reader sees either the old file or
        the new one, never a torn mixture. `os.replace` also overwrites
        silently, which is what we want.

        The temp file's name must be unique PER CALL, not per process. A
        pid-scoped name looks safe and isn't: uvicorn runs endpoint handlers
        in a threadpool against one shared client, so two concurrent turns
        have the same pid and collide on the same temp path — reproducing the
        exact interleaving described above one level down, and then renaming
        the torn result into place. `mkstemp` gives a name no other caller can
        hold, which is the property this actually needs.

        This does NOT make concurrent updates transactional — two writers can
        still race and the last one wins. Losing one update is survivable for
        a mock backend; a corrupt file that breaks all future reads is not.
        """
        target = self._data_dir / name
        fd, tmp_path = tempfile.mkstemp(
            dir=self._data_dir, prefix=f".{name}.", suffix=".tmp"
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(json.dumps(payload, indent=2) + "\n")
            os.replace(tmp_path, target)
        except BaseException:
            # Never leave a half-written temp file behind for the next glob
            # or `make clean` to trip over.
            Path(tmp_path).unlink(missing_ok=True)
            raise

    # ----- Leads -------------------------------------------------------------

    def get_lead(self, lead_id: str) -> Lead | None:
        self._refresh()  # another process may have written since our last read
        record = self._leads.get(lead_id)
        return Lead(**record) if record else None

    def all_leads(self) -> dict[str, Lead]:
        """Every lead, unscoped. For the harness and the reset path — NOT a
        tool. Counsellor-facing reads go through `leads_for_countries`."""
        self._refresh()  # another process may have written since our last read
        return {lid: Lead(**rec) for lid, rec in self._leads.items()}

    def leads_for_countries(
        self, countries: list[str], status: str | None = None
    ) -> list[Lead]:
        """Leads whose target country this counsellor owns.

        The tenancy rule lives here, in the backend, rather than in the MCP
        server — same reasoning as everywhere else in this file. Priya owns
        UK and Ireland, so Priya cannot pull a Canadian lead even if the
        model asks for one by id.

        A lead who has not yet stated a target country belongs to nobody and
        appears for no counsellor; it surfaces via `unassigned_leads()`
        instead, which is the queue meant for exactly that case.
        """
        self._refresh()  # another process may have written since our last read
        owned = {c.lower() for c in countries}
        out: list[Lead] = []
        for record in self._leads.values():
            lead = Lead(**record)
            target = lead.facts.target_country
            if target is None or str(target.value).lower() not in owned:
                continue
            if status is not None and lead.status != status:
                continue
            out.append(lead)
        return out

    def counsellor_owns_lead(self, counsellor_id: str, lead_id: str) -> bool:
        """Scope check for the counsellor-session hook. False for an unknown
        counsellor, an unknown lead, or a lead outside their countries."""
        counsellor = self.get_counsellor(counsellor_id)
        lead = self.get_lead(lead_id)
        if counsellor is None or lead is None:
            return False
        target = lead.facts.target_country
        if target is None:
            return False
        return str(target.value).lower() in {c.lower() for c in counsellor.countries}

    def create_lead(
        self,
        email: str,
        tenant_id: str = "northbound-demo",
        name: str | None = None,
        country_of_residence: str | None = None,
    ) -> Lead:
        """First contact. A student who opens the chat widget with no prior
        record gets a lead row before anything else happens, so every message
        and tool call has something to key against."""
        self._reload_cache()  # see note on record_tool_call
        for lid, rec in self._leads.items():
            if rec.get("email") == email:
                return Lead(**rec)
        # Highest existing number + 1, NOT len() + 1. With five seeds those
        # agree, and they keep agreeing right up until a lead is removed —
        # at which point len()+1 mints an id that an existing lead already
        # holds and `self._leads[lead_id] = ...` overwrites that student's
        # record. Nothing deletes leads today; this costs one line and stops
        # the day something does.
        highest = 0
        for existing in self._leads:
            match = re.fullmatch(r"lead_(\d+)", existing)
            if match:
                highest = max(highest, int(match.group(1)))
        lead_id = f"lead_{highest + 1:03d}"
        lead = Lead(
            lead_id=lead_id,
            tenant_id=tenant_id,
            email=email,
            name=name,
            country_of_residence=country_of_residence,
            created_at=_now(),
        )
        self._leads[lead_id] = lead.model_dump()
        self._flush(LEADS_FILE, self._leads)
        return lead

    def set_lead_status(self, lead_id: str, status: str) -> Lead:
        if status not in VALID_STATUSES:
            raise ValueError(f"unknown lead status {status!r}")
        self._reload_cache()
        record = self._leads.get(lead_id)
        if record is None:
            raise KeyError(f"no such lead: {lead_id}")
        record["status"] = status
        self._flush(LEADS_FILE, self._leads)
        return Lead(**record)

    def assign_counsellor(self, lead_id: str, counsellor_id: str | None) -> Lead:
        self._reload_cache()
        record = self._leads.get(lead_id)
        if record is None:
            raise KeyError(f"no such lead: {lead_id}")
        record["assigned_counsellor_id"] = counsellor_id
        self._flush(LEADS_FILE, self._leads)
        return Lead(**record)

    # ----- Facts -------------------------------------------------------------

    @staticmethod
    def _normalise(text: str) -> str:
        return re.sub(r"[^a-z0-9 ]+", " ", text.lower())

    def update_lead_fact(
        self, lead_id: str, key: str, value: Any, source_quote: str
    ) -> Fact:
        """Record one fact the student actually stated.

        `source_quote` must appear in one of this lead's own messages. That
        is the server-side half of "never infer a missing field": an agent
        that decides the student *probably* has IELTS 6.5 cannot write it,
        because it cannot produce a quote that exists in the transcript.

        Facts loaded from the seeds bypass this by construction — they are
        historical, from sessions whose transcripts we don't ship.
        """
        if key not in VALID_FACT_KEYS:
            raise ValueError(
                f"unknown fact key {key!r}; expected one of {sorted(VALID_FACT_KEYS)}"
            )
        self._reload_cache()
        record = self._leads.get(lead_id)
        if record is None:
            raise KeyError(f"no such lead: {lead_id}")
        if not source_quote or not source_quote.strip():
            raise FactNotStated(
                f"cannot record {key!r} without the student's own words"
            )

        haystack = " ".join(
            self._normalise(m["content"])
            for m in self._messages
            if m["lead_id"] == lead_id and m["role"] == "student"
        )
        if self._normalise(source_quote).strip() not in haystack:
            raise FactNotStated(
                f"source_quote for {key!r} does not appear in this lead's "
                "messages — ask the student rather than inferring it"
            )

        fact = Fact(value=value, source_quote=source_quote, stated_at=_now())
        record.setdefault("facts", {})[key] = fact.model_dump()
        self._flush(LEADS_FILE, self._leads)
        return fact

    # ----- Episodic notes ----------------------------------------------------
    #
    # What `Lead.facts` structurally cannot hold: tone, promises made, patterns
    # across the conversation, family context. One markdown file per lead, in
    # the shared workspace so the counsellor agent can read it for a briefing.
    #
    # The discipline is stricter than Lab-01's: notes hold observations about
    # the PERSON, never facts about programmes. A fee, deadline, or entry
    # requirement written here would end up in a system prompt and be repeated
    # to a student as though a tool had returned it — which is the one thing
    # this agent must never do. Cite the tool instead.

    def _note_path(self, lead_id: str) -> Path:
        return self._data_dir / NOTES_DIR / f"{lead_id}.md"

    def load_note(self, lead_id: str) -> str:
        """The lead's note file, or an empty string if none exists yet."""
        self._refresh()  # another process may have written since our last read
        path = self._note_path(lead_id)
        return path.read_text(encoding="utf-8") if path.exists() else ""

    def append_note(self, lead_id: str, text: str) -> None:
        """Add one timestamped observation. Append-only — the agent adds to
        the record rather than rewriting history."""
        path = self._note_path(lead_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")
        with path.open("a", encoding="utf-8") as fh:
            fh.write(f"\n## {stamp}\n{text.strip()}\n")

    def write_note(self, lead_id: str, content: str) -> None:
        """Overwrite the whole note file — compaction only. Destructive."""
        path = self._note_path(lead_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def clear_note(self, lead_id: str) -> None:
        """Remove a lead's notes. Used by the reset path, not by the agent."""
        path = self._note_path(lead_id)
        if path.exists():
            path.unlink()

    # ----- Conversation ------------------------------------------------------

    def append_message(self, lead_id: str, role: str, content: str) -> Message:
        self._reload_cache()
        message = Message(
            lead_id=lead_id, role=role, content=content, timestamp=_now()  # type: ignore[arg-type]
        )
        self._messages.append(message.model_dump())
        self._flush(MESSAGES_FILE, self._messages)
        return message

    def get_messages(self, lead_id: str) -> list[Message]:
        self._refresh()  # another process may have written since our last read
        return [Message(**m) for m in self._messages if m["lead_id"] == lead_id]

    # ----- Audit trail -------------------------------------------------------

    def record_tool_call(
        self,
        lead_id: str,
        tool: str,
        args: dict,
        result: Any = None,
        ok: bool = True,
        error: str | None = None,
    ) -> ToolCall:
        """One audit row per tool call. The spec's hard requirement is that any
        agent decision be reconstructable from ToolCall + Message alone, so
        this stores the full args and full result rather than a summary.

        Reloads before appending. Two different `NorthboundClient` instances
        share this file — the harness's (used by EscalationGateHook and
        GroundingHook) and the MCP subprocess's own. Without a reload here,
        whichever instance writes last overwrites the file with only the rows
        IT knew about, silently discarding everything the other process wrote
        in between. This was a real bug: a live run logged ~250 tool calls
        from the subprocess, then a single harness-side grounding check wiped
        the file down to its own 2 rows. Every write method below that
        mutates a list shared with the subprocess has the same reload for the
        same reason — see the module docstring.
        """
        self._reload_cache()
        call = ToolCall(
            call_id=f"tc_{len(self._toolcalls) + 1:05d}",
            lead_id=lead_id,
            tool=tool,
            args=args,
            result=result,
            ok=ok,
            error=error,
            agent_id=self._agent_id,
            timestamp=_now(),
        )
        self._toolcalls.append(call.model_dump())
        self._flush(TOOLCALLS_FILE, self._toolcalls)
        return call

    def get_tool_calls(self, lead_id: str) -> list[ToolCall]:
        self._refresh()  # another process may have written since our last read
        return [ToolCall(**t) for t in self._toolcalls if t["lead_id"] == lead_id]

    # ----- Catalogue ---------------------------------------------------------

    def get_programme(self, programme_id: str) -> Programme | None:
        record = self._programmes.get(programme_id)
        return Programme(**record) if record else None

    def search_programmes(
        self,
        country: str | None = None,
        field: str | None = None,
        level: str | None = None,
        intake: str | None = None,
        max_tuition: float | None = None,
        limit: int = 20,
    ) -> list[Programme]:
        """Verified catalogue entries only.

        Everything the agent is allowed to say about a fee, a deadline, or an
        entry requirement comes from here. A programme absent from this
        result does not exist as far as the student is concerned.
        """
        out: list[Programme] = []
        for record in self._programmes.values():
            p = Programme(**record)
            if country and p.country.lower() != country.lower():
                continue
            if field and field.lower() not in p.field.lower():
                continue
            if level and p.level.lower() != level.lower():
                continue
            if intake and intake not in p.intakes:
                continue
            if max_tuition is not None and p.tuition_per_year > max_tuition:
                continue
            out.append(p)
        out.sort(key=lambda p: (p.country, p.tuition_per_year))
        return out[:limit]

    # ----- Eligibility -------------------------------------------------------

    def check_requirements(self, lead_id: str, programme_id: str) -> EligibilityResult:
        """Per-requirement verdicts plus a confidence the model did not pick.

        Returns pass / fail / indeterminate for the programme as a whole, with
        a reason on every individual check. The confidence is derived by
        `EligibilityResult.from_checks`, so a counsellor auditing the decision
        can recompute it by hand from the same row.
        """
        lead = self.get_lead(lead_id)
        if lead is None:
            raise KeyError(f"no such lead: {lead_id}")
        programme = self.get_programme(programme_id)
        if programme is None:
            raise KeyError(f"no such programme: {programme_id}")

        known = lead.facts.known()
        checks = [evaluate_requirement(r, known, programme) for r in programme.requirements]
        return EligibilityResult.from_checks(programme_id, checks)

    def _hinge_text(self, programme: Programme, requirement_id: str | None) -> str:
        if requirement_id is None:
            return "all requirements met"
        for req in programme.requirements:
            if req.requirement_id == requirement_id:
                return req.description
        return requirement_id

    @staticmethod
    def _hinge_document(result: EligibilityResult) -> str | None:
        """The document that would settle an indeterminate entry's hinge, or
        None when the hinge is a question rather than paperwork.

        `from_checks` prefers a document-backed check as the hinge, so this
        returns None only when EVERY outstanding check is a missing fact — in
        which case `missing_facts` on the entry carries the next step instead.
        """
        if result.verdict != "indeterminate":
            return None
        for check in result.checks:
            if check.requirement_id == result.hinge_requirement_id:
                return check.resolving_document
        return None

    def build_shortlist(
        self,
        lead_id: str,
        country: str | None = None,
        field: str | None = None,
        limit: int = 5,
        floor: float | None = None,
    ) -> Shortlist:
        """Three to five programmes, none below the floor — or nothing at all.

        The 3–5 rule and the confidence floor are enforced HERE, below the
        agent, so a weak shortlist cannot be presented even by a
        prompt-injected model. When the bar can't be met this raises
        `ShortlistUnavailable` carrying the escalation trigger, which is the
        only other way out.

        `floor` lets a stricter tenant raise the bar (the MCP server passes
        the agent's configured floor). It is clamped against
        `CONFIDENCE_FLOOR` so it can only ever move upward — a caller asking
        for 0.3 gets 0.6, not a weakened gate.
        """
        effective_floor = max(floor or 0.0, CONFIDENCE_FLOOR)
        lead = self.get_lead(lead_id)
        if lead is None:
            raise KeyError(f"no such lead: {lead_id}")

        target = country or (
            str(lead.facts.target_country.value) if lead.facts.target_country else None
        )
        if not target:
            raise ShortlistUnavailable(
                "the student has not stated a target country", "low_confidence"
            )
        wanted = field or (
            str(lead.facts.field_of_study.value) if lead.facts.field_of_study else None
        )

        candidates = self.search_programmes(country=target, field=wanted)
        on_field = {p.programme_id for p in candidates}
        if len(candidates) < 3:
            # A student's wording ("data science") rarely partitions a
            # catalogue into three matches, and the shortlist needs three.
            # Top up with the rest of the country rather than escalating over
            # a vocabulary mismatch — field matches still rank first below.
            candidates += [
                p
                for p in self.search_programmes(country=target)
                if p.programme_id not in on_field
            ]

        scored: list[tuple[EligibilityResult, Programme]] = []
        for programme in candidates:
            result = self.check_requirements(lead_id, programme.programme_id)
            if result.confidence >= effective_floor:
                scored.append((result, programme))
        # Confidence first; among equally confident matches, prefer the ones
        # in the field the student actually asked about.
        scored.sort(
            key=lambda pair: (
                -pair[0].confidence,
                0 if pair[1].programme_id in on_field else 1,
            )
        )

        if len(scored) < 3:
            raise ShortlistUnavailable(
                f"only {len(scored)} programme(s) in {target} clear the "
                f"{effective_floor} confidence floor; at least 3 are needed "
                "to present a shortlist",
                "low_confidence",
            )

        chosen = scored[: max(3, min(limit, 5))]
        entries = [
            ShortlistEntry(
                programme_id=result.programme_id,
                confidence=result.confidence,
                hinge=self._hinge_text(programme, result.hinge_requirement_id),
                verdict=result.verdict,
                resolving_document=self._hinge_document(result),
                missing_facts=(
                    result.missing_facts
                    if result.verdict == "indeterminate"
                    else []
                ),
            )
            for result, programme in chosen
        ]
        overall = round(sum(e.confidence for e in entries) / len(entries), 2)
        return Shortlist(lead_id=lead_id, entries=entries, overall_confidence=overall)

    # ----- Routing -----------------------------------------------------------

    def get_counsellor(self, counsellor_id: str) -> Counsellor | None:
        record = self._counsellors.get(counsellor_id)
        return Counsellor(**record) if record else None

    def find_counsellor_for_country(self, country: str | None) -> Counsellor | None:
        """Routing is explicit: the owner of the student's country, or nobody.

        `active` is checked deliberately. A counsellor who owns the country
        but is on leave is NOT a match — routing to them would look like
        success and strand the lead. Returning None sends it to the
        unassigned queue, which is a real state, not a failure.
        """
        if not country:
            return None
        for record in self._counsellors.values():
            c = Counsellor(**record)
            if c.active and any(
                owned.lower() == country.lower() for owned in c.countries
            ):
                return c
        return None

    def unassigned_leads(self) -> list[Lead]:
        """The manual-pickup queue the dashboard renders."""
        self._refresh()  # another process may have written since our last read
        return [
            Lead(**rec)
            for rec in self._leads.values()
            if rec.get("assigned_counsellor_id") is None
            and rec.get("status") in ("escalated", "parked")
        ]

    # ----- Escalation --------------------------------------------------------

    def escalate(self, lead_id: str, trigger: str, detail: str) -> Escalation:
        """Route to the counsellor who owns the student's country, or to the
        unassigned queue. Never round-robins to fill the gap."""
        if trigger not in VALID_TRIGGERS:
            raise ValueError(
                f"unknown escalation trigger {trigger!r}; expected one of "
                f"{sorted(VALID_TRIGGERS)}"
            )
        self._reload_cache()  # see record_tool_call
        lead = self.get_lead(lead_id)
        if lead is None:
            raise KeyError(f"no such lead: {lead_id}")

        target = (
            str(lead.facts.target_country.value) if lead.facts.target_country else None
        )
        counsellor = self.find_counsellor_for_country(target)
        escalation = Escalation(
            escalation_id=f"esc_{len(self._escalations) + 1:04d}",
            lead_id=lead_id,
            trigger=trigger,  # type: ignore[arg-type]
            detail=detail,
            counsellor_id=counsellor.counsellor_id if counsellor else None,
            created_at=_now(),
        )
        self._escalations.append(escalation.model_dump())
        self._flush(ESCALATIONS_FILE, self._escalations)

        self.assign_counsellor(lead_id, escalation.counsellor_id)
        self.set_lead_status(lead_id, "escalated")
        return escalation

    def get_escalations(self, lead_id: str) -> list[Escalation]:
        self._refresh()  # another process may have written since our last read
        return [
            Escalation(**e) for e in self._escalations if e["lead_id"] == lead_id
        ]

    # ----- Scheduling --------------------------------------------------------

    def schedule_followup(
        self, lead_id: str, kind: str, due_at: str, reason: str
    ) -> Followup:
        """Anything with a date becomes a row here — follow-ups are scheduled,
        not remembered."""
        if kind not in VALID_FOLLOWUP_KINDS:
            raise ValueError(
                f"unknown follow-up kind {kind!r}; expected one of "
                f"{sorted(VALID_FOLLOWUP_KINDS)}"
            )
        self._reload_cache()  # see record_tool_call
        followup = Followup(
            followup_id=f"fu_{len(self._followups) + 1:04d}",
            lead_id=lead_id,
            kind=kind,  # type: ignore[arg-type]
            due_at=due_at,
            reason=reason,
            created_at=_now(),
        )
        self._followups.append(followup.model_dump())
        self._flush(FOLLOWUPS_FILE, self._followups)
        return followup

    def cancel_followups(self, lead_id: str) -> list[str]:
        """A student reply or a withdrawal cancels the pending ones. Returns
        the ids cancelled so the caller can say what it stood down."""
        self._reload_cache()  # see record_tool_call
        cancelled: list[str] = []
        for record in self._followups:
            if record["lead_id"] == lead_id and record["status"] == "pending":
                record["status"] = "cancelled"
                cancelled.append(record["followup_id"])
        if cancelled:
            self._flush(FOLLOWUPS_FILE, self._followups)
        return cancelled

    def due_followups(self, now: str | None = None) -> list[Followup]:
        """What the background worker should fire. Pending and past due."""
        self._refresh()  # another process may have written since our last read
        cutoff = now or _now()
        return [
            Followup(**f)
            for f in self._followups
            if f["status"] == "pending" and f["due_at"] <= cutoff
        ]

    def mark_followup_fired(self, followup_id: str) -> Followup:
        self._reload_cache()  # see record_tool_call — the background worker
        # runs as yet another process against this same file.
        for record in self._followups:
            if record["followup_id"] == followup_id:
                record["status"] = "fired"
                self._flush(FOLLOWUPS_FILE, self._followups)
                return Followup(**record)
        raise KeyError(f"no such follow-up: {followup_id}")

    def get_followups(self, lead_id: str) -> list[Followup]:
        self._refresh()  # another process may have written since our last read
        return [Followup(**f) for f in self._followups if f["lead_id"] == lead_id]

    # ----- Booking -----------------------------------------------------------

    def book_slot(
        self,
        lead_id: str,
        starts_at: str,
        counsellor_id: str | None = None,
        duration_minutes: int = 30,
    ) -> Slot:
        """Book against the counsellor who owns the student's country.

        Unlike `escalate`, "nobody owns this country" is an error here — you
        cannot book an appointment with an empty queue. The caller escalates
        to the unassigned queue instead.
        """
        self._reload_cache()  # see record_tool_call
        lead = self.get_lead(lead_id)
        if lead is None:
            raise KeyError(f"no such lead: {lead_id}")

        if counsellor_id is None:
            target = (
                str(lead.facts.target_country.value)
                if lead.facts.target_country
                else None
            )
            counsellor = self.find_counsellor_for_country(target)
            if counsellor is None:
                raise NoCounsellorAvailable(
                    f"no active counsellor owns {target!r} — the lead belongs in "
                    "the unassigned queue, not in someone else's calendar"
                )
            counsellor_id = counsellor.counsellor_id

        slot = Slot(
            slot_id=f"slot_{len(self._slots) + 1:04d}",
            lead_id=lead_id,
            counsellor_id=counsellor_id,
            starts_at=starts_at,
            duration_minutes=duration_minutes,
            created_at=_now(),
        )
        self._slots.append(slot.model_dump())
        self._flush(SLOTS_FILE, self._slots)
        self.assign_counsellor(lead_id, counsellor_id)
        return slot

    def get_slots(self, lead_id: str) -> list[Slot]:
        self._refresh()  # another process may have written since our last read
        return [Slot(**s) for s in self._slots if s["lead_id"] == lead_id]
