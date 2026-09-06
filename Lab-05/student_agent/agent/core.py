"""The agent factory — `build_agent()`.

A thin loader. The agent has NO tools of its own — every catalogue/write tool
comes from the `northbound` MCP server declared in `agent-profile.yaml`, and
`update_lead_facts` / `append_note` / `compact_note` are in-process `@tool`s
(no team boundary to cross — see `agent/facts.py`).

Assumes `profile.role == "student"` and asserts it at build time. The
counsellor agent has its own, much smaller, `core.py` — a different hook set
(read-only scope, no escalation gate) rather than a role branch in this one.
"""

import os
import sys
from pathlib import Path

from mcp import StdioServerParameters, stdio_client
from strands import Agent, AgentSkills
from strands.agent.conversation_manager import SlidingWindowConversationManager
from strands.models.openai import OpenAIModel
from strands.tools.mcp import MCPClient

from agent import facts
from agent.hooks import (
    EscalationGateHook,
    CitationHook,
    GroundingHook,
    InputSanitiserHook,
    WebResultCompactorHook,
    LeadIdBindingHook,
)
from agent.profile import MCPServerConfig, Profile, load_profile
from mocks.client import NorthboundClient

# This service's root — student_agent/. Skills and the profile YAML live
# below it. mcp_servers/ and mocks/ do NOT — they live one level up, at the
# lab root, shared by both agents. See LAB_ROOT below and make_mcp_client.
ROOT = Path(__file__).parent.parent
LAB_ROOT = ROOT.parent


# ---------------------------------------------------------------------------
# MCP server construction
# ---------------------------------------------------------------------------


def make_mcp_client(config: MCPServerConfig, profile: Profile) -> MCPClient:
    """Build a stdio MCPClient from a profile entry. ToolProvider — pass to
    `Agent(tools=[...])`.

    Two things this agent's Phase-A restructure requires that Lab-01 did not:

    1. `cwd=LAB_ROOT` — the server module (`mcp_servers.northbound`) now lives
       one level above this agent's own directory, shared with the counsellor
       agent. Without an explicit cwd the subprocess resolves `-m
       mcp_servers.northbound` against wherever the parent process happened
       to start, which is not guaranteed to be the lab root.
    2. `NORTHBOUND_PROFILE=<abs path to this agent's YAML>` — the server
       calls `load_profile()` with no argument, which otherwise always
       resolves to `agent/profile.py`'s own directory (i.e. always the
       student's YAML). Without this the counsellor agent's subprocess would
       load the STUDENT profile and sign every audit row as
       `northbound-student` — silently breaking the one thing the
       agent_id/workspace split in `mocks/client.py` exists to provide.
    """
    full_env = dict(os.environ)
    full_env.update(config.env)
    full_env["NORTHBOUND_PROFILE"] = str(
        (ROOT / "agent-profile.yaml").resolve()
    )
    # Resolve `python` / `python3` to the parent process's interpreter so the
    # MCP subprocess inherits the same venv. Other commands pass through.
    command = sys.executable if config.command in ("python", "python3") else config.command
    return MCPClient(
        lambda: stdio_client(
            StdioServerParameters(
                command=command,
                args=list(config.args),
                env=full_env,
                cwd=str(LAB_ROOT),
            )
        )
    )


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------


def _notes_protocol() -> str:
    """Short protocol describing HOW to use episodic notes. Stays in the
    system prompt; the notes BODY itself is injected into the user message
    via `prepend_context()` so it doesn't get drowned by instruction text.

    Stricter than Lab-01's memory protocol in one respect: notes may never
    carry a programme fact (fee, deadline, requirement). A note is read back
    into a later system prompt, and anything factual written there gets
    repeated to a student as though a tool had verified it — which is the
    rule this whole agent exists to protect. The "when to write" framing is
    carried over from Lab-01 as a closing-step obligation, not a judgment
    call: an agent that treats it as optional skips it.
    """
    return """\
## Episodic notes

What `Lead.facts` cannot hold: this student's situation, promises you made, their tone, and patterns across the conversation. Critical continuity — when they return, or when a counsellor picks up the lead, this is what stops the conversation starting cold.

Prior notes for the current lead arrive at the top of their first user message of a new session, wrapped in `<notes>…</notes>` tags.

### Goes in
- Situation, not status ("father is driving the decision", not a fact field).
- Promises ("said we'd chase the transcript by Friday").
- Tone, 1–2 words ("anxious about cost").
- Patterns ("asked about visas three times").

### Never goes in — no exceptions
Fees, deadlines, entry requirements, programme ids as facts. Anything a tool returns. A note gets read back into a system prompt later and repeated as though it were verified — that is the one thing this agent must never do. Cite the tool instead: "discussed the Camden Met MSc — see search_programmes".

### When to write — the closing step of every turn
Did you, this turn, make a promise, learn something about the PERSON that no tool returns, or notice a pattern? Then call `append_note(lead_id="", note=...)` NOW, before your reply. A purely informational turn needs no note.

One line: situation — promise/action (if any) — tone — pattern (if any)."""


def prepend_context(
    lead_id: str | None,
    prompt: str,
    compact_threshold: int = 0,
    include_notes: bool = True,
) -> str:
    """Wrap `<lead_facts>` and (optionally) `<notes>` and prepend them to the
    user message.

    Facts go in on EVERY turn, and that is not merely a refresh. The sliding
    window trims by message count from the oldest end, so a block placed only
    in the first user message is the first thing deleted — the agent then
    behaves as though the student never stated anything. Re-rendering costs
    ~200 tokens and cannot go stale, since `update_lead_facts` may have
    written during the previous turn.

    Facts are ALWAYS included when a lead_id is present, even with nothing
    known yet ("known: (nothing yet)") — the system prompt's grounding rule
    depends on the model seeing explicitly what is NOT known, not on
    inferring it from an absent block.

    `include_notes=False` for later turns: notes are prose and can run to
    thousands of characters, so repeating them every turn would cost more
    than it buys. Facts are the part the rules actually depend on.
    """
    if not lead_id:
        return prompt
    lead_facts = facts.render_lead_facts(lead_id)
    notes = (
        facts.render_notes(lead_id, compact_threshold=compact_threshold)
        if include_notes
        else ""
    )
    blocks = [b for b in (lead_facts, notes) if b]
    if not blocks:
        return prompt
    return "\n\n".join(blocks) + "\n\n" + prompt


def _skills_protocol() -> str:
    """The instruction that makes the skills catalogue load-bearing.

    AgentSkills registers a `skills` tool and lists every SKILL.md's
    description under this header — but nothing in that machinery tells the
    model to USE it. A model that believes it already knows the procedure
    will not reach for a meta-tool first, so the catalogue sits in the prompt
    unread and the agent improvises the multi-step flows the skills exist to
    pin down.

    This lives in the harness rather than in agent-profile.yaml on purpose:
    it is only true when skills are actually loaded. Written into the
    profile's system_prompt it would survive the skills toggle being turned
    off and point the agent at a tool that no longer exists — the same class
    of bug as the planner suggesting skills the agent cannot load.
    """
    return """\
## Available skills

Before you act on a request that involves more than answering a single
question, load the skill that matches it. Each entry below names when it
applies.

- Load the skill FIRST, before your first tool call — not after you have
  started and stalled. The skills exist to fix the ORDER of operations, and
  a skill read halfway through cannot undo a call you already made.
- One skill covers most turns. Load a second only when the situation
  genuinely changes hands (qualifying a lead, then presenting to them).
- If a skill contradicts your instinct about what to do next, the skill
  wins. That is what it is for.
- If no skill matches, proceed without one. Do not force a fit."""


def _build_instructions(
    profile: Profile,
    notes_section: str = "",
    skills_section: str = "",
) -> str:
    """Format `profile.system_prompt`; append any provided sections in order.

    The caller decides whether each section is included — `build_agent`
    builds the section string alongside the matching plugin/tool decision so
    the enable condition lives in one place per feature.
    """
    base = profile.system_prompt.format(**vars(profile))
    if notes_section:
        base += "\n\n" + notes_section
    if skills_section:
        base += "\n\n" + skills_section
    return base


# ---------------------------------------------------------------------------
# Build the agent
# ---------------------------------------------------------------------------


def _resolve_skills_dir(profile: Profile) -> Path | None:
    """Return profile.skills_dir as an absolute Path, or None if unset / missing."""
    if not profile.skills_dir:
        return None
    path = Path(profile.skills_dir)
    if not path.is_absolute():
        path = ROOT / path
    return path if path.exists() else None


def build_agent(
    profile: Profile | None = None,
    lead_id: str | None = None,
) -> Agent:
    """Build the student-facing agent for one lead. `lead_id` is needed for
    fact/notes injection and hook binding. UI toggle overrides are baked
    into `profile` upstream via `apply_overrides` — this function just reads
    the profile."""
    if profile is None:
        profile = load_profile()
    if profile.role != "student":
        raise ValueError(
            f"student_agent.core.build_agent requires role='student', got "
            f"{profile.role!r} — the counsellor agent has its own core.py"
        )

    # --- Backend: one client, shared by every local tool and every hook
    # that needs to check or write state. `bind_client` is what lets the
    # module-level @tool functions in agent/facts.py reach it.
    client = NorthboundClient(agent_id=profile.agent_id, workspace=profile.workspace)
    facts.bind_client(client)

    # --- Tools: the northbound MCP server (student role — search/check/
    # shortlist/escalate/book/schedule) plus the in-process fact/notes tools.
    # `update_lead_facts` is never gated: recording facts is not optional.
    # `append_note` / `compact_note` are gated with the notes protocol below
    # — tool catalog must match what the prompt describes, or the model is
    # told about a capability it does not have.
    mcp_clients = [make_mcp_client(cfg, profile) for cfg in profile.mcp_servers]
    local_tools: list = [facts.update_lead_facts]
    notes_section = ""
    if profile.memory.episodic.enabled:
        notes_section = _notes_protocol()
        local_tools.extend([facts.append_note, facts.compact_note])

    # --- Skills: AgentSkills plugin auto-discovers SKILL.md under
    # skills_dir, injects the catalog into the system prompt under
    # "## Available skills", and registers a `skills` loader tool.
    plugins: list = []
    skills_section = ""
    skills_dir = _resolve_skills_dir(profile)
    if skills_dir:
        skills_section = _skills_protocol()
        plugins.append(AgentSkills(skills=[str(skills_dir)]))

    # --- Session memory: `agent.messages` on the returned Agent, capped by
    # Strands' SlidingWindowConversationManager. main.py caches one Agent per
    # lead_id, so messages survive between requests. Window size comes from
    # agent-profile.yaml's `memory.session.window`.
    # `per_turn=True` is REQUIRED, not a tuning knob. It defaults to False,
    # and with it False the manager's own hook computes `should_apply=False`
    # and never calls `apply_management` — so `window_size` is decoration and
    # `agent.messages` grows without limit. That is not theoretical: it put a
    # single turn at 218,000 input tokens before anyone noticed, because a
    # window that never applies looks exactly like a window that is large
    # enough.
    conversation_manager = SlidingWindowConversationManager(
        window_size=profile.memory.session.window,
        per_turn=True,
    )

    # --- Hooks. ORDER IS LOAD-BEARING: all four register on
    # BeforeInvocationEvent-family events with the default priority, so
    # Strands' HookRegistry (a stable sort by `order`, insertion order as
    # tiebreak) runs them in this list's order.
    #
    # InputSanitiserHook MUST run before EscalationGateHook: the gate scans
    # the student's message text for trigger phrases, and if a student's
    # spoofed <lead_facts> block were still live, the gate would be scanning
    # attacker-controlled markup rather than plain speech.
    hooks_: list = [InputSanitiserHook()]
    # Shrinks web page text in PAST turns so three 6,000-character course
    # pages don't ride along in every later request. Registered before the
    # gate so compaction happens before anything reads history.
    hooks_.append(WebResultCompactorHook())
    if lead_id:
        # The harness — not the LLM — is the principal for every lead-scoped
        # tool call. See agent/hooks.py::LeadIdBindingHook.
        hooks_.append(LeadIdBindingHook(lead_id=lead_id))
        # Rule-driven escalation, evaluated before the model runs. See
        # agent/hooks.py::EscalationGateHook.
        hooks_.append(
            EscalationGateHook(
                lead_id=lead_id,
                client=client,
                # Only then does the directive offer the relay path — it must
                # not send the model after a source it has no tool to fetch.
                web_research_available=profile.web_search.is_available,
            )
        )
        # Post-model check that flags reply content no tool result supports.
        # See agent/hooks.py::GroundingHook for its honest limitation (can
        # force one retry; cannot rewrite the reply).
        hooks_.append(GroundingHook(lead_id=lead_id, client=client))
        # Its pair for the unverified tier: a reply built on web results has
        # to carry one of the URLs those results came with. Registered even
        # when web search is off — with no web tools to fire, it collects no
        # URLs and never triggers, so there is no branch here to get wrong.
        hooks_.append(CitationHook(lead_id=lead_id, client=client))

    agent = Agent(
        agent_id=profile.agent_id,
        name=profile.name,
        description=(
            f"{profile.tenant_name}'s student-facing assistant. "
            f"Shortlist confidence floor {profile.confidence_floor:.2f}."
        ),
        model=OpenAIModel(model_id=profile.model),
        system_prompt=_build_instructions(profile, notes_section, skills_section),
        tools=[*mcp_clients, *local_tools],
        plugins=plugins,
        hooks=hooks_,
        conversation_manager=conversation_manager,
        # Suppress Strands' default PrintingCallbackHandler — it streams text
        # chunks straight to stdout (no newlines), which collides with our
        # own trace rendering. main.py collects tokens from stream_async
        # events itself and renders via SSE.
        callback_handler=None,
    )
    return agent
