"""Load the agent profile from agent-profile.yaml.

The YAML is the complete declarative description of the agent: identity,
tenant, role, model, tool set, skill directory, MCP servers, memory config,
confidence floor. `agent/core.py` is a loader on top of this.

Two fields carry more weight than the rest:

- `role` ("student" or "counsellor") is declared ONCE, here, and stamped
  into every MCP server's env as NORTHBOUND_ROLE. The server registers a
  different tool set depending on it, so a role written in two places that
  disagree would hand a student session counsellor tools. One source of
  truth removes that failure entirely.
- `workspace` names the data directory. Both agents share one, so the
  counsellor can see what the student-facing agent did; `agent_id` stays
  distinct so the audit trail records who acted. See mocks/client.py.
"""

from dataclasses import dataclass, field, replace
from pathlib import Path

import yaml

# The structural hard minimum for the shortlist gate. A tenant may raise the
# floor in YAML but never lower it — see `load_profile`. Imported rather than
# redeclared so there is exactly one number, and the lab root must be on
# sys.path before this module is imported (the MCP server and main.py both
# arrange that before importing anything from `agent.`).
from mocks.models import CONFIDENCE_FLOOR

PROFILE_PATH = Path(__file__).parent.parent / "agent-profile.yaml"


@dataclass
class SessionMemory:
    # Within-session chat history. `agent.messages` capped by Strands'
    # SlidingWindowConversationManager; oldest messages dropped on overflow.
    window: int = 20


@dataclass
class EpisodicMemory:
    # Past-sessions per-customer summary in memory/customer_<id>.md, loaded
    # fully into the system prompt at agent build.
    enabled: bool = False
    # Char-count above which the system prompt nudges the agent to call
    # `compact_memory()` to summarize. 0 disables the nudge.
    compact_threshold: int = 4000


@dataclass
class MemoryConfig:
    session: SessionMemory = field(default_factory=SessionMemory)
    episodic: EpisodicMemory = field(default_factory=EpisodicMemory)


@dataclass
class PlannerConfig:
    # When enabled, every /api/run kicks off a small non-streaming LLM call
    # BEFORE the main agent to produce a <plan> block (intent, approach,
    # info_needed, skills, policies). The plan is prepended to the user
    # message. See `agent/planner.py`.
    enabled: bool = False


@dataclass
class MCPServerConfig:
    name: str
    command: str
    args: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)


@dataclass
class WebSearchConfig:
    """Web search — the one UNVERIFIED source the agent is allowed to touch.

    Off by default, and off is a real state: the two web tools are simply not
    registered, so an agent built with `enabled: false` cannot reach the
    internet at all rather than being asked nicely not to.

    `enabled` is not the same as *available*. Keys come from the environment,
    never from YAML — a committed profile must not be able to carry a
    credential. `is_available` is the honest answer to "can this actually
    run", and the MCP server registers the web tools only when it is True.

    TWO PROVIDERS, because the two web tools want different things.

      visa      Brave + a page fetch. Government guidance is keyword-findable
                and gov.uk serves plain HTML, so a cheap keyword search plus
                a fetch is the right shape.
      programme Exa. Course pages are JS-rendered and bot-protected — a plain
                fetch of a university site returns nothing at all, which is
                exactly what it did — and "marine biology masters" is a
                semantic query that keyword search answers with index pages.
                Exa returns the page TEXT with the result, so there is no
                fetch step to be blocked.

    Whichever provider runs, `sources.filter_results` still decides which
    hosts survive. The boundary does not move when the transport changes.
    """

    enabled: bool = False
    # Results requested from the provider BEFORE host filtering. The allowlist
    # drops most of them, so this is larger than what reaches the agent.
    max_results: int = 10
    # Results shown to the agent AFTER filtering. Small on purpose: the agent
    # must cite what it uses, and a wall of sources invites summarising
    # instead of quoting.
    max_shown: int = 3
    # Env vars holding the credentials. Named here rather than hardcoded so a
    # tenant can point at their own secrets without a code change.
    api_key_env: str = "BRAVE_API_KEY"
    exa_api_key_env: str = "EXA_API_KEY"
    # Characters of page text Exa returns per result.
    exa_max_chars: int = 6000

    @property
    def api_key(self) -> str:
        import os

        return os.environ.get(self.api_key_env, "").strip()

    @property
    def exa_api_key(self) -> str:
        import os

        return os.environ.get(self.exa_api_key_env, "").strip()

    @property
    def programme_search_available(self) -> bool:
        """Exa configured. When False, `find_unverified_programmes` is not
        registered — the Brave path is NOT used as a fallback for programme
        discovery, because it demonstrably does not work: university pages
        come back empty and the agent is left naming courses from titles."""
        return bool(self.enabled and self.exa_api_key)

    @property
    def is_available(self) -> bool:
        """Enabled AND holding a key. Anything else means no web tools."""
        return bool(self.enabled and self.api_key)


# Minimal fallback if agent.system_prompt is missing from YAML. Keep this
# functional but stark so the user notices and restores the real template.
_DEFAULT_SYSTEM_PROMPT = (
    "You are {name} (agent_id={agent_id}), speaking for {tenant_name}. "
    "Help students find overseas study programmes. Never state a fee, "
    "deadline, or entry requirement that did not come from a tool result — "
    "prefer 'indeterminate' over a guess. Escalate anything touching visas. "
    "(NOTE: `agent.system_prompt` is missing from agent-profile.yaml — "
    "restore the full template from the lab README.)"
)


@dataclass
class Profile:
    agent_id: str
    name: str
    # The consultancy this agent speaks for. Goes into the system prompt so
    # the agent introduces itself as the tenant, not as "an AI assistant".
    tenant_name: str
    # "student" or "counsellor" — decides which tool set the MCP server
    # registers. See the module docstring.
    role: str
    # Which data dir under mocks/data/. Both agents share one.
    workspace: str
    model: str
    language: str
    system_prompt: str
    skills_dir: str | None
    mcp_servers: list[MCPServerConfig]
    memory: MemoryConfig
    planner: PlannerConfig
    # The unverified tier. See WebSearchConfig — off unless both the YAML says
    # so and a key is present in the environment.
    web_search: WebSearchConfig
    # Below this, the agent escalates instead of presenting a shortlist.
    # Enforced in mocks/client.py's build_shortlist and by the harness hook —
    # the model never picks the number it is gated on.
    confidence_floor: float


def apply_overrides(
    profile: Profile,
    skills_enabled: bool | None = None,
    episodic_enabled: bool | None = None,
    planner_enabled: bool | None = None,
    web_search_enabled: bool | None = None,
) -> Profile:
    """Return a Profile copy with UI toggle overrides applied. `None` keeps
    the YAML default. Disabling skills wipes `skills_dir`; disabling episodic
    flips `memory.episodic.enabled`; toggling the planner flips
    `planner.enabled` (a per-request decision — no agent rebuild needed).
    The returned Profile is the single source of truth for `build_agent`
    and the per-request planner gate — no extra flag plumbing required."""
    if (
        skills_enabled is None
        and episodic_enabled is None
        and planner_enabled is None
        and web_search_enabled is None
    ):
        return profile

    new_skills_dir = profile.skills_dir if skills_enabled is not False else None
    new_episodic = profile.memory.episodic
    if episodic_enabled is not None:
        new_episodic = replace(profile.memory.episodic, enabled=episodic_enabled)
    new_planner = profile.planner
    if planner_enabled is not None:
        new_planner = replace(profile.planner, enabled=planner_enabled)
    new_web = profile.web_search
    if web_search_enabled is not None:
        # The toggle can only turn web search OFF that isn't already usable —
        # `is_available` still requires a key, so flipping this on without
        # BRAVE_API_KEY set changes nothing. That is intentional: the UI
        # should not be able to promise a capability the environment lacks.
        new_web = replace(profile.web_search, enabled=web_search_enabled)

    return replace(
        profile,
        skills_dir=new_skills_dir,
        memory=replace(profile.memory, episodic=new_episodic),
        planner=new_planner,
        web_search=new_web,
    )


def load_profile(path: Path = PROFILE_PATH) -> Profile:
    """Read agent-profile.yaml and return a typed Profile."""
    if not path.exists():
        raise FileNotFoundError(f"agent-profile.yaml not found at {path}. See README.")
    raw = yaml.safe_load(path.read_text())

    agent_section = raw.get("agent", {})
    memory_section = raw.get("memory", {}) or {}
    session_section = memory_section.get("session", {}) or {}
    episodic_section = memory_section.get("episodic", {})
    # Tolerate the shorthand `episodic: true` / `episodic: false`.
    if isinstance(episodic_section, bool):
        episodic_section = {"enabled": episodic_section}
    elif episodic_section is None:
        episodic_section = {}
    planner_section = raw.get("planner", {})
    # Tolerate the shorthand `planner: true` / `planner: false`.
    if isinstance(planner_section, bool):
        planner_section = {"enabled": planner_section}
    elif planner_section is None:
        planner_section = {}
    mcp_section = raw.get("mcp_servers") or []
    web_section = raw.get("web_search", {})
    # Tolerate the shorthand `web_search: true` / `web_search: false`.
    if isinstance(web_section, bool):
        web_section = {"enabled": web_section}
    elif web_section is None:
        web_section = {}
    if "api_key" in web_section:
        # A key in the profile would be a key in git. Refuse loudly rather
        # than silently ignoring it — the author clearly believed it was
        # being used, and a credential they think is set but isn't is worse
        # than a startup error.
        raise ValueError(
            "web_search.api_key must not appear in agent-profile.yaml — the "
            "profile is committed. Set the key in the environment instead "
            "(BRAVE_API_KEY), optionally renaming the var via "
            "web_search.api_key_env."
        )

    agent_id = agent_section.get("id", "northbound-student")
    role = str(agent_section.get("role", "student")).lower()
    if role not in ("student", "counsellor"):
        raise ValueError(
            f"agent.role must be 'student' or 'counsellor', got {role!r}"
        )

    # Stamp the role into every MCP server's env. Declaring it once at the
    # top of the YAML and deriving it here means the role the agent thinks
    # it has and the tool set its server registers can never disagree.
    # A value written in the YAML's own env block is overwritten, not
    # merged — there is exactly one source of truth.
    mcp_servers = [
        MCPServerConfig(
            name=entry["name"],
            command=entry["command"],
            args=list(entry.get("args", [])),
            env={**dict(entry.get("env", {})), "NORTHBOUND_ROLE": role},
        )
        for entry in mcp_section
    ]

    return Profile(
        agent_id=agent_id,
        name=agent_section.get("name", "Northbound Assistant"),
        tenant_name=agent_section.get("tenant_name", "Northbound Education"),
        role=role,
        workspace=agent_section.get("workspace") or agent_id,
        model=agent_section.get("model", "gpt-5.4-mini"),
        language=agent_section.get("language", "English"),
        system_prompt=agent_section.get("system_prompt") or _DEFAULT_SYSTEM_PROMPT,
        skills_dir=raw.get("skills_dir"),
        mcp_servers=mcp_servers,
        memory=MemoryConfig(
            session=SessionMemory(window=int(session_section.get("window", 20))),
            episodic=EpisodicMemory(
                enabled=bool(episodic_section.get("enabled", False)),
                compact_threshold=int(episodic_section.get("compact_threshold", 4000)),
            ),
        ),
        planner=PlannerConfig(
            enabled=bool(planner_section.get("enabled", False)),
        ),
        web_search=WebSearchConfig(
            enabled=bool(web_section.get("enabled", False)),
            max_results=int(web_section.get("max_results", 10)),
            max_shown=int(web_section.get("max_shown", 3)),
            api_key_env=str(web_section.get("api_key_env", "BRAVE_API_KEY")),
            exa_api_key_env=str(
                web_section.get("exa_api_key_env", "EXA_API_KEY")
            ),
            exa_max_chars=int(web_section.get("exa_max_chars", 6000)),
        ),
        # Clamped upward: config can make the shortlist gate stricter, never
        # looser. A YAML typo (0.06 for 0.6, say) would otherwise silently
        # weaken the one gate standing between a student and a shortlist the
        # agent isn't confident in. Wrong config should fail safe.
        confidence_floor=max(
            float(raw.get("confidence_floor", CONFIDENCE_FLOOR)), CONFIDENCE_FLOOR
        ),
    )
