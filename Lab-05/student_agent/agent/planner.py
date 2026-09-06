"""Planner — a small LLM call that runs BEFORE the main agent on every turn.

The planner has one job: read the student's message and produce a short
<plan> block that scopes the agent's work. It does NOT call tools. The plan
is prepended to the user message so the main agent reads "intent + what the
message is carrying over from earlier + approach + what to look up + which
skills" before it picks its first tool.

Why a separate call:
- The same LLM that does intent recognition AND tool calling tends to drop
  the intent half once tools become available. A dedicated planner call has
  no tool affordances, so it cannot skip ahead.
- Plans are per-turn, not per-build. They live in the user-message space
  alongside the prompt they reasoned about.
- Same model family as the main agent (gpt-5.4-mini by default) keeps
  latency low — ~1s for a non-streaming completion at ~150 output tokens.

What the planner is given, and why each part is load-bearing:

- **The student's message.** Obvious, and for a long time the ONLY thing it
  got — which was the bug. A consultancy conversation is cumulative: by turn
  four "what about Perth, under 40,000?" carries a subject, a level and a
  country that were all established earlier and appear nowhere in that
  sentence. A planner handed only those seven words cannot scope the turn,
  and the plan it writes teaches the main agent to search for a master's in
  Perth with no field attached. That is not a planner reasoning badly; it is
  a planner reasoning correctly about an under-specified input.
- **`lead_facts`** — the same block the main agent gets. This is what makes
  `carried_context` answerable at all.
- **`history`** — the last few turns, text only. Facts cover what the student
  has formally STATED; history covers what they were just talking about,
  which is often narrower ("the Camden Met one", "the second one").

Catalogue strategy:
- **Tools**: passed in from the caller (main.py extracts them from the built
  agent's `tool_registry` so the planner sees exactly what the main agent
  has, with no drift). Falls back to a hardcoded mirror when called without
  an override, so the module is usable standalone (tests, REPL).
- **Skills**: auto-discovered from `SKILL.md` frontmatter under
  `student_agent/skills/` — the same source `AgentSkills` reads.

There is deliberately no policies section. Lab-01 had one; this lab has no
policy documents — the tools are the authority — and a mandatory `policies:`
output field that can only ever be filled with "(no policies configured)"
trains the planner to emit filler.
"""

from __future__ import annotations

import os
import re
from datetime import date
from pathlib import Path

from openai import AsyncOpenAI


# (prompt_tokens, completion_tokens) from the most recent plan_for_prompt call.
# Read and reset by main.py immediately after awaiting the planner, so the
# window in which a concurrent turn could read the wrong one is a few
# statements wide. A per-call return value would be cleaner; this keeps the
# planner's signature stable for the tests and REPL use the module documents.
LAST_USAGE: tuple[int, int] = (0, 0)

_HERE = Path(__file__).parent
_AGENT_ROOT = _HERE.parent
_SKILLS_DIR = _AGENT_ROOT / "skills"

# Blocks the harness injects into the user message. Stripped before a past
# turn is replayed to the planner: `<lead_facts>` arrives fresh via its own
# parameter (a stale copy from three turns ago would contradict it), and
# `<plan>` / `<notes>` are the harness talking to itself.
_INJECTED_BLOCK_RE = re.compile(
    r"<(plan|lead_facts|notes)\b.*?</\1>", re.DOTALL | re.IGNORECASE
)

# Per-message cap in the replayed transcript. Long enough to keep a student's
# actual question intact; short enough that three turns stay well under the
# planner's ~200-token history budget.
_HISTORY_CHARS = 400


# ----- Catalogue loaders --------------------------------------------------


def _parse_frontmatter(content: str) -> dict[str, str]:
    """Tiny YAML-frontmatter reader. Strings + bare values only; skips
    nested structures. Returns {} if no `---` fence at the top."""
    if not content.startswith("---"):
        return {}
    end = content.find("\n---", 3)
    if end == -1:
        return {}
    out: dict[str, str] = {}
    for line in content[3:end].strip().split("\n"):
        m = re.match(r"([a-zA-Z_][\w-]*):\s*(.*)", line)
        if not m:
            continue
        key, value = m.group(1), m.group(2).strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        out[key] = value
    return out


def _skills_catalogue() -> str:
    """`name — description` per SKILL.md frontmatter, sorted by skill dir."""
    if not _SKILLS_DIR.exists():
        return "(no skills configured)"
    lines: list[str] = []
    for skill_dir in sorted(_SKILLS_DIR.iterdir()):
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.exists():
            continue
        fm = _parse_frontmatter(skill_md.read_text())
        name = fm.get("name", skill_dir.name)
        desc = fm.get("description", "")
        lines.append(f"- {name} — {desc}" if desc else f"- {name}")
    return "\n".join(lines) or "(no skills)"


def format_tool_specs(tool_specs: list[dict]) -> str:
    """Format a list of Strands tool specs (`agent.tool_registry.get_all_tool_specs()`)
    into the planner's `name — first line of description` form.

    Filters out the `skills` meta-tool because individual skills get their
    own section in the planner prompt — including it under tools too would
    just be noise.
    """
    lines: list[str] = []
    for spec in tool_specs:
        inner = spec.get("toolSpec", spec)
        name = inner.get("name", "")
        if not name or name == "skills":
            continue
        desc = (inner.get("description") or "").strip()
        first_line = desc.splitlines()[0].strip() if desc else ""
        lines.append(f"- {name} — {first_line}" if first_line else f"- {name}")
    return "\n".join(lines) or "(no tools)"


def _tools_catalogue_fallback() -> str:
    """Hardcoded mirror of the student agent's tool surface, used only when
    the caller doesn't pass a live tools catalogue (tests, REPL).

    The live path (main.py) extracts from `agent.tool_registry`; this is just
    a safety net so the module can be imported and exercised without a built
    agent on hand. The two web tools are listed because the fallback has no
    way to know whether web search is enabled — a plan that names a tool the
    agent lacks is a smaller failure than one that omits a tool it has."""
    return """\
- search_programmes — search the verified catalogue by country, field, max_tuition
- get_programme — one catalogue programme: fees, deadlines, intakes, requirements
- check_requirements — eligibility verdict for one lead against one programme
- build_shortlist — the ONLY sanctioned way programmes reach a student (3–5, confidence floor)
- escalate — hand the lead to a human counsellor with a trigger
- book_slot — book a counsellor appointment
- schedule_followup — durably record a dated action (document chase, intake cutoff, verification)
- research_visa_question — official immigration/government pages, relayed with source links
- find_unverified_programmes — university course pages for what the catalogue cannot serve
- update_lead_facts — record a fact the student stated, with their exact words
- append_note — one short line of episodic context about the person
- compact_note — rewrite this lead's notes when they get long"""


# ----- History -------------------------------------------------------------


def format_history(messages: list[dict] | None, turns: int = 3) -> str:
    """Render the last `turns` student messages and the replies between them
    as a compact transcript for the planner.

    Text blocks only. Tool calls and tool results are dropped on purpose: the
    planner has no tools, cannot act on them, and a single web result would
    blow the whole history budget. What it needs from history is the thread of
    the conversation, not the machinery underneath it.

    Returns "" when there is nothing to show, which the caller passes straight
    through — the prompt then omits the section rather than showing an empty
    heading.
    """
    if not messages:
        return ""

    rendered: list[str] = []
    user_seen = 0
    for msg in reversed(messages):
        role = msg.get("role")
        if role not in ("user", "assistant"):
            continue
        text = _message_text(msg)
        if not text:
            continue
        rendered.append(f"{'student' if role == 'user' else 'agent'}: {text}")
        if role == "user":
            user_seen += 1
            if user_seen >= turns:
                break

    return "\n".join(reversed(rendered))


def _message_text(msg: dict) -> str:
    """Plain text of one Strands message, with harness-injected blocks removed
    and the result clipped to `_HISTORY_CHARS`."""
    content = msg.get("content")
    if isinstance(content, str):
        parts = [content]
    elif isinstance(content, list):
        parts = [
            block["text"]
            for block in content
            if isinstance(block, dict) and isinstance(block.get("text"), str)
        ]
    else:
        return ""

    text = _INJECTED_BLOCK_RE.sub("", "\n".join(parts)).strip()
    text = re.sub(r"\s+", " ", text)
    if len(text) > _HISTORY_CHARS:
        text = text[:_HISTORY_CHARS].rstrip() + "…"
    return text


# ----- Planner prompt + call ----------------------------------------------


def _planner_system_prompt(
    tools_catalogue: str,
    skills_catalogue: str | None,
    lead_facts: str,
    history: str,
) -> str:
    """Build the planner's system prompt.

    `skills_catalogue=None` is the signal that skills are disabled for this
    turn (the main agent doesn't have the AgentSkills plugin loaded). In that
    case the skills section, the `skills:` output field, and the skills-related
    rule are all dropped — the planner can't suggest a skill the main agent has
    no way to load.

    `lead_facts` and `history` are omitted the same way when empty (a first
    contact has neither), so the planner is never shown a heading with nothing
    under it and asked to reason from it.
    """
    today = date.today().isoformat()

    skills_on = skills_catalogue is not None
    skills_output_field = (
        "skills:\n"
        "- <skills the main agent should load BEFORE its first tool call; omit the section if none apply>\n"
        if skills_on
        else ""
    )
    skills_rule = (
        "- `skills` is a hint, not a mandate. List only the ones whose procedure clearly matches the intent. If no skill applies, omit the section."
        if skills_on
        else "- Skills are NOT available this turn. Do not include a `skills` field in your <plan>."
    )
    skills_section = (
        f"\nSkills the main agent can load (procedure documents):\n{skills_catalogue}\n"
        if skills_on
        else ""
    )
    facts_section = (
        f"\nWhat this student has already told us:\n{lead_facts}\n"
        if lead_facts.strip()
        else "\nWhat this student has already told us: nothing yet — this is a first contact.\n"
    )
    history_section = (
        f"\nThe last few turns (text only, tool calls omitted):\n{history}\n"
        if history.strip()
        else ""
    )

    return f"""You are the planning layer of an overseas-education consultancy's student-facing agent. Your only job is to produce one short <plan> block that scopes the next turn for the main agent BEFORE it reaches for tools.

You do NOT call tools. You output exactly one <plan> block, then stop.

Output format (exact tags, nothing outside <plan>):

<plan>
intent: <one line. What the student ACTUALLY wants — distinguish what they are asking ABOUT from what they NEED. "Is Australia cheaper?" from someone with a fixed budget is a question about affordable options, not a country comparison.>
carried_context: <one line. What this message ASSUMES from earlier in the conversation but does not restate — their subject, level, target country, budget, or a specific programme they mean by "that one". Copy the actual values from the facts and history above. Write "none — this message stands alone" only when it genuinely does.>
approach: <one or two lines. High-level direction. Verified catalogue before the web, always. Escalation is a fallback, not an opening move.>
facts_needed:
- <gating facts NOT yet stated that this specific turn needs; omit the whole section if none>
info_needed:
- <concrete things the agent should look up>
{skills_output_field}</plan>

Rules:
- Be terse. The whole plan fits in 10–15 lines.
- Do NOT list step-by-step tool calls; the main agent picks tools. You scope the problem.
- Do NOT invent tools or skills. Only reference items from the lists below.
{skills_rule}
- **`carried_context` is the most important field you write.** This conversation is cumulative. A student who established their subject four turns ago will not repeat it, and the main agent writes its search queries from what is in front of it. If you leave the subject out, it searches without one and returns programmes in the wrong field. Restate the values; do not gesture at them.
- Never put a fact in `carried_context` that is not in the facts block or the history above. If the student has not stated their field of study, say so — that is a `facts_needed` item, not something to fill in.
- The gating facts are: target_country, field_of_study, qualification, grades, english_test, budget_per_year, intended_intake. The first five gate a shortlist; budget and intake affect which requirements can be checked.
- For a purely informational turn (a visa question, a "how long does X take"), a one-line intent and one info item is enough. Do not manufacture `facts_needed` for a turn that does not need them.
- If you genuinely cannot infer intent from the message, say so in `intent:` — do not guess.

Tools the main agent has:
{tools_catalogue}
{skills_section}{facts_section}{history_section}
Today's date: {today}
"""


async def plan_for_prompt(
    prompt: str,
    model: str,
    *,
    lead_facts: str = "",
    history: str = "",
    tools_catalogue: str | None = None,
    skills_catalogue: str | None = None,
    skills_enabled: bool = True,
) -> str:
    """Generate a <plan> block for the student's next-turn message.

    Args:
        prompt: The student's raw message.
        model:  The OpenAI model id (same family as the main agent).
        lead_facts: The rendered `<lead_facts>` block for this lead — pass
            `agent.facts.render_lead_facts(lead_id)`. Without it the planner
            cannot fill `carried_context`, which is the field the main agent
            relies on to keep a subject attached to a follow-up question.
        history: Recent turns as a compact transcript — pass
            `format_history(agent.messages)`. Empty on a first contact.
        tools_catalogue: Optional override for the tools section. When the
            caller has a built agent on hand, pass
            `format_tool_specs(agent.tool_registry.get_all_tool_specs())` so
            the planner sees the live tool surface (including whether the web
            tools are registered at all). Defaults to a hardcoded fallback.
        skills_catalogue: Optional override for the skills section. When
            `skills_enabled=True` and this is None, falls back to disk-based
            discovery of `SKILL.md` frontmatter. Ignored when
            `skills_enabled=False`.
        skills_enabled: When False, the planner is told skills aren't
            available this turn and is instructed NOT to emit a `skills:`
            field. Pass `False` whenever the main agent doesn't have the
            AgentSkills plugin loaded (i.e. `profile.skills_dir` is None / the
            UI skills toggle is off). Otherwise the plan can suggest skills
            the agent has no way to load.

    Returns:
        A string containing exactly one <plan>...</plan> block, ready to
        prepend to the student's message before invoking the main agent.
    """
    tools = tools_catalogue if tools_catalogue is not None else _tools_catalogue_fallback()
    if skills_enabled:
        skills = skills_catalogue if skills_catalogue is not None else _skills_catalogue()
    else:
        skills = None  # sentinel: drop the skills section entirely

    client = AsyncOpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    response = await client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "system",
                "content": _planner_system_prompt(tools, skills, lead_facts, history),
            },
            {"role": "user", "content": prompt},
        ],
        temperature=0.2,
    )
    # Stash this call's usage on the module so the caller can attribute it
    # without changing the return type every caller depends on. The planner is
    # a second LLM call per turn, and "the planner costs 15% of the turn" is
    # only visible if its tokens are counted separately from the agent's.
    usage = getattr(response, "usage", None)
    global LAST_USAGE
    LAST_USAGE = (
        int(getattr(usage, "prompt_tokens", 0) or 0),
        int(getattr(usage, "completion_tokens", 0) or 0),
    )
    return (response.choices[0].message.content or "").strip()
