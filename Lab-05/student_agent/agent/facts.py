"""Lead facts and episodic notes — the agent's own write tools.

These live in-process rather than on the MCP server because they are
session-scoped state the agent owns end to end. There is no team boundary to
cross: nobody else writes a lead's facts mid-conversation. Same rule Lab-01
applies to `append_memory` — tools that stay local, stay local.

Two layers of memory, and the split matters:

- **Facts** (`update_lead_facts`) are structured, validated, and must be
  quoted. They go in `Lead.facts` and drive `check_requirements`, so a wrong
  one produces a wrong eligibility verdict.
- **Notes** (`append_note`, `compact_note`) are free text about the PERSON —
  tone, promises made, family context, patterns. They exist precisely
  because `Lead.facts` has no column for them.

Notes may never carry programme facts. A fee or a deadline written into a
note is loaded into a later system prompt and repeated to a student as
though a tool had returned it, which is the one thing this agent must never
do. Cite the tool instead.

The storage sits in the SHARED workspace (`mocks/data/<workspace>/`), not in
this agent's directory, so the counsellor agent can read notes for a
briefing. See mocks/client.py.
"""

from strands import tool

from mocks.client import FactNotStated, NorthboundClient
from mocks.models import CONFIDENCE_FLOOR  # noqa: F401  (re-exported for core)

# Built lazily so importing this module doesn't touch the filesystem — the
# MCP subprocess and the harness each construct their own client, and both
# read the same workspace on disk.
_client: NorthboundClient | None = None


def bind_client(client: NorthboundClient) -> None:
    """Point the local tools at the harness's client instance.

    Called once from `build_agent`. The tools are module-level functions
    (Strands' @tool decorator wraps a function, not a method), so the client
    has to reach them somehow; binding once at build time keeps it explicit
    rather than constructing a fresh client per call.
    """
    global _client
    _client = client


def _require_client() -> NorthboundClient:
    if _client is None:
        raise RuntimeError(
            "agent.facts is unbound — call bind_client() from build_agent()"
        )
    return _client


# ----- Agent-facing tools --------------------------------------------------


@tool
def update_lead_facts(
    lead_id: str, key: str, value: str, source_quote: str
) -> dict:
    """Record one fact the student has actually stated.

    Facts drive eligibility, so a wrong one produces a wrong verdict about
    someone's future. Only ever write what they said.

    `key` is one of: target_country, field_of_study, qualification, grades,
    english_test, budget_per_year, intended_intake.

    `value` is the normalised reading — "IELTS 6.5" from "i got a 6.5
    overall". Normalising is fine; inventing is not.

    `source_quote` MUST be the student's own words, copied from their
    message. The write is rejected if those words are not in this lead's
    messages.

    A rejection means you misheard them, not that you should try different
    wording. Ask the student to confirm, then write what they say. Do not
    reword the quote until it passes — that defeats the check entirely and
    puts an invented fact into their file.

    Do not infer. "They mentioned Berlin" is not a target country. "They
    sound well-off" is not a budget. If you need something nobody has
    stated, ask for it.

    `lead_id` is injected by the harness — pass an empty string.
    """
    client = _require_client()
    try:
        fact = client.update_lead_fact(lead_id, key, value, source_quote)
    except FactNotStated as exc:
        return {
            "error": "fact_not_stated",
            "code": 422,
            "detail": str(exc),
            "remediation": "ask_the_student_to_confirm",
        }
    except ValueError as exc:
        return {
            "error": "invalid_argument",
            "code": 400,
            "detail": str(exc),
            "remediation": "fix_the_argument",
        }
    except KeyError as exc:
        return {
            "error": "not_found",
            "code": 404,
            "detail": str(exc).strip("'\""),
            "remediation": "do_not_act",
        }
    return {"ok": True, "key": key, "value": fact.value}


@tool
def append_note(lead_id: str, note: str) -> dict:
    """Add one short observation about this student to their notes.

    Notes carry what the facts table cannot: their situation, promises you
    made, their tone, and patterns you noticed. When they come back weeks
    later — or when a counsellor picks the lead up — this is what stops the
    conversation starting cold.

    Goes in:
      - situation ("father is driving the Germany decision")
      - promises ("said we'd come back on the transcript by Friday")
      - tone, one or two words ("anxious about cost")
      - patterns ("asked about visas three times")

    Stays out — anything a tool returns. No fees, no deadlines, no entry
    requirements, no programme ids as facts. Those get re-read later and
    repeated to a student as though verified. Reference the tool instead:
    "discussed the Camden Met MSc — see search_programmes".

    When to write: did you make a promise, learn something about them that
    no tool returns, or notice a pattern? Then write one line, now, before
    you reply. A purely informational turn needs no note.

    `lead_id` is injected by the harness — pass an empty string.
    """
    client = _require_client()
    client.append_note(lead_id, note)
    return {"ok": True, "saved_for": lead_id}


@tool
def compact_note(lead_id: str, new_content: str) -> dict:
    """Rewrite this student's whole note file with a tighter version.

    Use ONLY when the notes have grown long and repetitive. You are
    OVERWRITING — everything not carried into `new_content` is gone. Keep
    every promise and every open thread; drop only repetition.

    `lead_id` is injected by the harness — pass an empty string.
    """
    client = _require_client()
    client.write_note(lead_id, new_content)
    return {"ok": True, "rewrote": lead_id}


# ----- Harness-facing helpers (not tools) ----------------------------------


def render_lead_facts(lead_id: str) -> str:
    """The <lead_facts> block prepended to the student's first message.

    Deliberately at user-message level rather than in the system prompt:
    facts change every turn, the system prompt is built once per agent, and
    the model weights recent user content more heavily than standing
    instructions.

    Lists what is KNOWN and what is MISSING, because "not stated" is the
    thing the agent must not paper over.
    """
    client = _require_client()
    lead = client.get_lead(lead_id)
    if lead is None:
        return ""
    known = lead.facts.known()
    missing = lead.facts.missing()
    lines = [f'<lead_facts lead_id="{lead_id}">']
    if known:
        lines.append("known:")
        lines += [f"  {k}: {v}" for k, v in known.items()]
    else:
        lines.append("known: (nothing yet — this is a first contact)")
    if missing:
        lines.append("not stated yet (ask, do not assume):")
        lines += [f"  {k}" for k in missing]
    lines.append("</lead_facts>")
    return "\n".join(lines)


def render_notes(lead_id: str, compact_threshold: int = 0) -> str:
    """The <notes> block, if this lead has any. Empty string if not."""
    client = _require_client()
    body = client.load_note(lead_id)
    if not body.strip():
        return ""
    notice = ""
    if compact_threshold and len(body) > compact_threshold:
        notice = (
            f"\n\n[note to agent: these notes are {len(body):,} chars "
            f"(threshold {compact_threshold:,}). Call compact_note before the "
            "turn ends.]"
        )
    return f'<notes lead_id="{lead_id}">\n{body.strip()}{notice}\n</notes>'
