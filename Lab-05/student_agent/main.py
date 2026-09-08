"""HTTP shell for the student-facing Northbound agent.

    GET  /health
    GET  /api/leads        the lead book, for the UI's lead picker
    GET  /api/tools        live tool surface for the current toggle state
    GET  /api/notes        a lead's episodic notes (the notes drawer)
    GET  /api/briefing     facts + escalations + follow-ups for one lead
    POST /api/run          one turn, streamed as SSE
    POST /api/reset        wipe the workspace back to seeds
    POST /api/end_session  drop the cached Agent ("time has passed")

One integration requirement worth stating up front: `/api/run` records the
student's message to the backend BEFORE invoking the agent. It has to.
`update_lead_facts` validates every `source_quote` against this lead's
recorded messages, so if the turn isn't persisted first, every fact write in
that turn fails with `fact_not_stated` — the anti-inference guard would fire
on true statements. The reply is appended after the turn for the same
reason in reverse: the counsellor's timeline needs both halves.
"""

import dataclasses
import json
import logging
import sys
from pathlib import Path
from typing import Any


# Lab root on sys.path so `mocks` and `mcp_servers` resolve — they live one
# level up, shared with the counsellor agent.
_LAB_ROOT = Path(__file__).parent.parent
if str(_LAB_ROOT) not in sys.path:
    sys.path.insert(0, str(_LAB_ROOT))

from dotenv import load_dotenv  # noqa: E402
from fastapi import Depends, FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from pydantic import BaseModel  # noqa: E402
from sse_starlette.sse import EventSourceResponse  # noqa: E402
from strands import Agent  # noqa: E402
from strands.models.openai import OpenAIModel  # noqa: E402

from agent.core import ROOT, build_agent, prepend_context  # noqa: E402
import envelope  # noqa: E402
from api import tenant as tenant_routes, users as users_routes  # noqa: E402
from auth import Principal, require_permission  # noqa: E402
from envelope import ApiError, EnvelopeRoute  # noqa: E402
from agent.hooks import sanitise_student_text  # noqa: E402
from agent import facts as facts_module, planner as planner_module, pricing  # noqa: E402
from agent.planner import format_history, format_tool_specs, plan_for_prompt  # noqa: E402
from agent.profile import apply_overrides, load_profile  # noqa: E402
from mocks.client import NorthboundClient, reset_data_files  # noqa: E402

load_dotenv(_LAB_ROOT / ".env")

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("northbound_student")

PROFILE = load_profile()

# The harness's own view of the backend — used by the read-only endpoints
# and to persist messages around each turn. `build_agent` constructs its own
# instance for the tools and hooks; both point at the same workspace and
# reload before every write (see mocks/client.py::record_tool_call).
CLIENT = NorthboundClient(agent_id=PROFILE.agent_id, workspace=PROFILE.workspace)

# Agents are expensive to build (MCP subprocess spawn) and the cached
# instance also IS the conversation memory — `agent.messages` accumulates
# across requests for the same lead. Per-lead cache key gives each student
# their own isolated history. In production each lead maps to a session/JWT.
_AGENTS: dict[str, Agent] = {}


def get_agent(lead_id: str, profile=PROFILE) -> Agent:
    if lead_id not in _AGENTS:
        _AGENTS[lead_id] = build_agent(profile=profile, lead_id=lead_id)
    return _AGENTS[lead_id]


# Dedicated catalog agents for /api/tools — one per (skills, episodic) combo
# so the drawer reflects the live tool set for the current UI toggles.
_CATALOG_AGENTS: dict[tuple[bool, bool], Agent] = {}


def _get_catalog_agent(skills_enabled: bool, episodic_enabled: bool) -> Agent:
    key = (skills_enabled, episodic_enabled)
    if key not in _CATALOG_AGENTS:
        profile = apply_overrides(
            PROFILE, skills_enabled=skills_enabled, episodic_enabled=episodic_enabled
        )
        _CATALOG_AGENTS[key] = build_agent(profile=profile, lead_id="_catalog")
    return _CATALOG_AGENTS[key]


# ---------------------------------------------------------------------------
# SSE event extraction from Strands' stream_async()
# ---------------------------------------------------------------------------


def _truncate(value: Any, n: int = 60) -> str:
    s = "" if value is None else str(value)
    return s if len(s) <= n else s[: n - 1] + "…"


def _summarize_args(name: str, args: dict | None) -> str:
    """One-line arg summary for the trace row. Domain-specific on purpose —
    a trace that reads "search_programmes(UK, data science)" is scannable;
    one that dumps the whole arg dict is not."""
    if not isinstance(args, dict):
        return _truncate(args)
    if name == "search_programmes":
        bits = [
            str(args.get(k))
            for k in ("country", "field", "level", "intake")
            if args.get(k)
        ]
        return ", ".join(bits) if bits else "(all)"
    if name in {"get_programme", "check_requirements"}:
        return args.get("programme_id", "?")
    if name == "build_shortlist":
        bits = [str(args.get(k)) for k in ("country", "field") if args.get(k)]
        return ", ".join(bits) if bits else "(from stated facts)"
    if name == "escalate":
        return f"{args.get('trigger', '?')}, \"{_truncate(args.get('detail', ''), 34)}\""
    if name == "book_slot":
        return args.get("starts_at", "?")
    if name == "schedule_followup":
        return f"{args.get('kind', '?')} due {args.get('due_at', '?')[:10]}"
    if name == "update_lead_facts":
        return f"{args.get('key', '?')}={_truncate(args.get('value', ''), 24)}"
    if name == "append_note":
        return f'"{_truncate(args.get("note", ""), 44)}"'
    if name == "compact_note":
        return "(rewrite)"
    if name == "skills":
        return args.get("skill_name", "?")
    if name == "research_visa_question":
        country = args.get("country") or "(stated)"
        return f'"{_truncate(args.get("question", ""), 40)}" · {country}'
    if name == "find_unverified_programmes":
        return f'"{_truncate(args.get("query", ""), 52)}"' 
    return ", ".join(f"{k}={_truncate(v, 25)}" for k, v in args.items() if k != "lead_id")


def _summarize_result(name: str, result: Any) -> tuple[str, bool]:
    """Return (summary, is_error). Errors surface `remediation` because that
    is the field that tells the model — and the person reading the trace —
    what happens next."""
    if isinstance(result, dict) and "error" in result:
        code = result.get("code")
        detail = result.get("detail") or result.get("reason") or result.get("error")
        remediation = result.get("remediation")
        bits = [str(code)] if code else []
        bits.append(_truncate(detail, 48))
        if remediation:
            bits.append(f"→ {remediation}")
        return "err: " + " ".join(bits), True

    if not isinstance(result, dict):
        if isinstance(result, list):
            return f"[{len(result)} items]", False
        return _truncate(result, 70), False

    if name == "search_programmes":
        return f"{result.get('count', '?')} programmes", False
    if name == "get_programme":
        cur = result.get("currency", "")
        fee = result.get("tuition_per_year", "?")
        return f"{_truncate(result.get('name', '?'), 34)} — {cur} {fee:,.0f}" if isinstance(fee, (int, float)) else _truncate(result.get("name", "?"), 50), False
    if name == "check_requirements":
        verdict = result.get("verdict", "?")
        conf = result.get("confidence", "?")
        hinge = result.get("hinge_requirement_id")
        tail = f", hinge={hinge}" if hinge else ""
        return f"{verdict}, conf={conf}{tail}", False
    if name == "build_shortlist":
        entries = result.get("entries") or []
        # Surface the undecided count: a shortlist of 3 settled matches and
        # one of 3 pending-a-transcript are very different traces, and the
        # aggregate confidence alone doesn't separate them.
        unknown = sum(1 for e in entries if e.get("verdict") == "indeterminate")
        tail = f", {unknown} indeterminate" if unknown else ""
        return (
            f"{len(entries)} entries @ "
            f"{result.get('overall_confidence', '?')}{tail}"
        ), False
    if name == "escalate":
        who = result.get("counsellor_id")
        return (
            f"{result.get('escalation_id', 'ok')} "
            + (f"→ {who}" if who else "→ unassigned queue")
        ), False
    if name == "book_slot":
        return f"{result.get('slot_id', 'ok')} with {result.get('counsellor_id', '?')}", False
    if name == "schedule_followup":
        return (
            f"{result.get('followup_id', 'ok')} {result.get('kind', '')} "
            f"due {str(result.get('due_at', ''))[:10]}"
        ), False
    if name == "update_lead_facts":
        return f"ok {result.get('key', '')}={_truncate(result.get('value', ''), 24)}", False
    if name in {"list_leads", "get_unassigned_queue"}:
        return f"{result.get('count', '?')} leads", False
    if name in {"research_visa_question", "find_unverified_programmes"}:
        # `dropped_offlist` is the interesting number, not the kept count. It
        # is the allowlist visibly working: "2 sources · 8 off-list dropped"
        # shows the boundary doing its job in the same row the agent used.
        key = "sources" if name == "research_visa_question" else "candidates"
        items = result.get(key) or []
        dropped = result.get("dropped_offlist") or result.get("dropped_malformed") or 0
        hosts = ", ".join(
            dict.fromkeys(str(s.get("source_host", "?")) for s in items)
        )
        if not items:
            return f"nothing on approved sources ({dropped} dropped)", False
        # Exa reports what the call cost; Brave does not. Shown when present
        # so search spend sits next to the turn's token spend rather than
        # being invisible.
        cost = result.get("search_cost_usd")
        return (
            f"{len(items)} unverified · {hosts}"
            + (f" · {dropped} off-list dropped" if dropped else "")
            + (f" · ${cost}" if cost else "")
        ), False
    if result.get("ok"):
        return "ok", False
    return _truncate(result, 70), False


def _extract_tool_result_body(block: dict) -> Any:
    tr = block.get("toolResult") or block.get("tool_result")
    if not isinstance(tr, dict):
        return None
    body = tr.get("content")
    if isinstance(body, list) and body:
        head = body[0]
        if isinstance(head, dict):
            body = head.get("text") or head.get("json") or head
    if isinstance(body, str):
        try:
            return json.loads(body)
        except (ValueError, TypeError):
            return body
    return body


async def _run_agent_stream(
    agent: Agent, prompt: str, planner_usage: tuple[int, int] = (0, 0)
):
    """Yield SSE events for one agent turn."""
    yield {"event": "user_message", "data": json.dumps({"content": prompt})}

    # Token counters accumulate for the LIFE of the Agent, and main.py caches
    # one Agent per lead across requests. Snapshot before and subtract after,
    # or turn 5 reports five turns' worth. See agent/pricing.py::snapshot.
    usage_before = pricing.snapshot(agent)

    # `system_prompt` is emitted AFTER the stream begins so the AgentSkills
    # plugin (which injects its catalog via a BeforeInvocation hook) has had
    # a chance to update `agent.system_prompt` first.
    system_prompt_emitted = False
    pending: dict[str, dict] = {}

    async for event in agent.stream_async(prompt):
        if not system_prompt_emitted:
            yield {
                "event": "system_prompt",
                "data": json.dumps({"content": agent.system_prompt or ""}),
            }
            system_prompt_emitted = True

        if not isinstance(event, dict):
            continue

        delta = event.get("data")
        if isinstance(delta, str):
            yield {"event": "text_delta", "data": json.dumps({"delta": delta})}

        msg = event.get("message")
        if not isinstance(msg, dict):
            continue
        content = msg.get("content")
        if not isinstance(content, list):
            continue
        role = msg.get("role")

        for block in content:
            if not isinstance(block, dict):
                continue
            if role == "assistant":
                tu = block.get("toolUse") or block.get("tool_use")
                if isinstance(tu, dict):
                    tu_id = tu.get("toolUseId") or tu.get("id")
                    name = tu.get("name")
                    if not tu_id or not name:
                        continue
                    args = tu.get("input") or {}
                    pending[tu_id] = {"name": name, "args": args}
                    yield {
                        "event": "tool_call",
                        "data": json.dumps(
                            {
                                "tool_use_id": tu_id,
                                "name": name,
                                "args": args,
                                "args_summary": _summarize_args(name, args),
                            }
                        ),
                    }
            elif role == "user":
                tr = block.get("toolResult") or block.get("tool_result")
                if not isinstance(tr, dict):
                    continue
                tu_id = tr.get("toolUseId") or tr.get("tool_use_id") or tr.get("id")
                slot = pending.get(tu_id)
                if not slot:
                    continue
                body = _extract_tool_result_body(block)
                summary, is_err = _summarize_result(slot["name"], body)
                yield {
                    "event": "tool_result",
                    "data": json.dumps(
                        {
                            "tool_use_id": tu_id,
                            "result": body,
                            "result_summary": summary,
                            "is_error": is_err,
                        }
                    ),
                }

    if not system_prompt_emitted:
        yield {
            "event": "system_prompt",
            "data": json.dumps({"content": agent.system_prompt or ""}),
        }

    messages = getattr(agent, "messages", []) or []
    final_reply = ""
    for m in reversed(messages):
        if not isinstance(m, dict) or m.get("role") != "assistant":
            continue
        c = m.get("content")
        if isinstance(c, str):
            final_reply = c
            break
        if isinstance(c, list):
            for blk in c:
                if isinstance(blk, dict) and blk.get("text"):
                    final_reply = blk["text"]
                    break
            if final_reply:
                break

    usage = dataclasses.replace(
        pricing.delta(usage_before, pricing.snapshot(agent)),
        planner_input_tokens=planner_usage[0],
        planner_output_tokens=planner_usage[1],
    )
    yield {
        "event": "done",
        "data": json.dumps(
            {
                "final_reply": final_reply,
                "usage": usage.as_dict(getattr(agent.model, "model_id", "") or ""),
            }
        ),
    }


# ---------------------------------------------------------------------------
# HTTP API
# ---------------------------------------------------------------------------


class RunRequest(BaseModel):
    prompt: str
    lead_id: str
    model: str | None = None
    # `skills_enabled` / `episodic_enabled` are baked at agent build time, so
    # the frontend resets the session before sending new values.
    # `planner_enabled` is a per-request decision and can flip freely.
    skills_enabled: bool | None = None
    episodic_enabled: bool | None = None
    planner_enabled: bool | None = None


app = FastAPI(title="northbound_student", version="0.1.0")

# One response shape for the whole API. `install` adds the request id and the
# error handlers; the route class wraps successful returns in `data`.
# See envelope.py for why this is not a body-rewriting middleware.
app.router.route_class = EnvelopeRoute
envelope.install(app)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):51(7[0-9]|8[0-9])",
    allow_credentials=False,
    # PATCH is needed by /api/tenant, PUT by the countries and availability
    # endpoints. A method missing here is refused by the browser before the
    # request is sent, which looks like the endpoint is down — and curl,
    # which sends no preflight, will not reproduce it.
    allow_methods=["GET", "POST", "PUT", "PATCH", "OPTIONS"],
    # Authorization is required now that console calls carry a Clerk token.
    # A browser silently drops a header the server does not allow, so an
    # omission here looks like "the token is being ignored".
    allow_headers=["Content-Type", "Authorization"],
    # Without this the browser hides the header entirely, so a failure the
    # user reports cannot be matched to a line in the server log.
    expose_headers=["X-Request-Id"],
)

# Routes live in api/. Each router is built by api.new_router so it carries
# EnvelopeRoute — include_router does NOT inherit the app's route class.
app.include_router(users_routes.router)
app.include_router(tenant_routes.router)


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "agent": "northbound_student",
        "agent_id": PROFILE.agent_id,
        "role": PROFILE.role,
        "workspace": PROFILE.workspace,
    }


@app.get("/api/leads")
def list_leads(
    principal: Principal = Depends(require_permission("leads.read.owned")),
) -> dict[str, Any]:
    """The lead book, for the UI's lead picker. Includes what is known and
    what is still missing per lead — the missing list is what makes the
    "ask, never infer" behaviour visible before you even send a message."""
    CLIENT._reload_cache()
    out = []
    for lead in CLIENT.all_leads().values():
        out.append(
            {
                "lead_id": lead.lead_id,
                "name": lead.name,
                "email": lead.email,
                "country_of_residence": lead.country_of_residence,
                "status": lead.status,
                "assigned_counsellor_id": lead.assigned_counsellor_id,
                "facts": lead.facts.known(),
                "missing": lead.facts.missing(),
            }
        )
    out.sort(key=lambda r: r["lead_id"])
    return {"leads": out, "count": len(out)}


class CreateLeadRequest(BaseModel):
    name: str
    email: str
    country_of_residence: str | None = None


@app.post("/api/leads")
def create_lead(req: CreateLeadRequest) -> dict[str, Any]:
    """First contact — a student with no prior record.

    The new lead has all seven facts NULL, which is the point: it is the only
    way to watch "ask, never infer" from a genuinely cold start, rather than
    from a seed lead that already knows three things.

    `country_of_residence` is deliberately NOT a fact. It is where the student
    lives; `target_country` is where they want to study, and only they can
    state that. Writing one from the other is exactly the inference this lab
    exists to prevent.

    `create_lead` de-duplicates by email and returns the EXISTING lead on a
    match, so a repeated email quietly hands back a lead that already has
    facts on it. That is correct for a real widget (a student returning with
    the same address is the same student) and a trap for a demo, so the
    response says which happened via `created`.
    """
    email = req.email.strip()
    name = req.name.strip()
    if not email:
        raise ApiError(422, "VALIDATION_FAILED", "The provided input contains errors.",
            details=[{"field": "email", "issue": "An email address is required."}])
    if "@" not in email:
        raise ApiError(422, "VALIDATION_FAILED", "The provided input contains errors.",
            details=[{"field": "email", "issue": "Must be a valid email address."}])
    if not name:
        raise ApiError(422, "VALIDATION_FAILED", "The provided input contains errors.",
            details=[{"field": "name", "issue": "A name is required."}])

    CLIENT._reload_cache()
    existed = any(
        lead.email == email for lead in CLIENT.all_leads().values()
    )
    lead = CLIENT.create_lead(
        email=email,
        name=name,
        country_of_residence=(req.country_of_residence or "").strip() or None,
    )
    return {
        "lead_id": lead.lead_id,
        "name": lead.name,
        "email": lead.email,
        "country_of_residence": lead.country_of_residence,
        "status": lead.status,
        "assigned_counsellor_id": lead.assigned_counsellor_id,
        "facts": lead.facts.known(),
        "missing": lead.facts.missing(),
        "created": not existed,
    }


@app.get("/api/tools")
def tools_catalog(
    skills_enabled: bool | None = None,
    episodic_enabled: bool | None = None,
) -> dict[str, Any]:
    """The agent's live tool surface (MCP specs + local fact/notes tools +
    the AgentSkills loader) for the current toggle state."""
    effective_skills = (
        skills_enabled if skills_enabled is not None else bool(PROFILE.skills_dir)
    )
    effective_episodic = (
        episodic_enabled
        if episodic_enabled is not None
        else PROFILE.memory.episodic.enabled
    )
    agent = _get_catalog_agent(effective_skills, effective_episodic)
    return {"tools": agent.tool_registry.get_all_tool_specs()}


@app.get("/api/notes")
def get_notes(
    lead_id: str,
    principal: Principal = Depends(require_permission("leads.read.owned")),
) -> dict[str, Any]:
    """A lead's episodic notes. Unconditional so the UI can distinguish
    "empty" from "missing"."""
    content = CLIENT.load_note(lead_id)
    return {"lead_id": lead_id, "exists": bool(content.strip()), "content": content}


@app.get("/api/briefing")
def get_briefing(
    lead_id: str,
    principal: Principal = Depends(require_permission("leads.read.owned")),
) -> dict[str, Any]:
    """Facts, escalations and pending follow-ups for one lead — the same
    digest the counsellor agent's `get_lead_briefing` tool returns. Handy
    for watching the agent's writes land while you demo."""
    CLIENT._reload_cache()
    lead = CLIENT.get_lead(lead_id)
    if lead is None:
        return {"error": "not_found", "lead_id": lead_id}
    return {
        "lead_id": lead.lead_id,
        "name": lead.name,
        "status": lead.status,
        "assigned_counsellor_id": lead.assigned_counsellor_id,
        "facts": lead.facts.known(),
        "missing": lead.facts.missing(),
        "escalations": [e.model_dump() for e in CLIENT.get_escalations(lead_id)],
        "followups": [f.model_dump() for f in CLIENT.get_followups(lead_id)],
        "slots": [s.model_dump() for s in CLIENT.get_slots(lead_id)],
        "tool_calls": [t.model_dump() for t in CLIENT.get_tool_calls(lead_id)],
    }


@app.post("/api/run")
async def run(req: RunRequest):
    effective_profile = apply_overrides(
        PROFILE,
        skills_enabled=req.skills_enabled,
        episodic_enabled=req.episodic_enabled,
        planner_enabled=req.planner_enabled,
    )
    agent = get_agent(req.lead_id, effective_profile)
    agent.model = OpenAIModel(model_id=req.model or PROFILE.model)

    # Persist the student's turn BEFORE the agent runs. `update_lead_facts`
    # checks every source_quote against this lead's recorded messages, so
    # without this the anti-inference guard rejects true statements the
    # student just made. See the module docstring.
    CLIENT.append_message(req.lead_id, "student", req.prompt)

    # Captured BEFORE the run, since agent.messages grows during it. Only
    # `<notes>` still depends on this; facts go in every turn — see below.
    first_turn = not agent.messages
    framed_prompt = req.prompt

    # Planner: a small non-streaming LLM call with no tools that produces a
    # <plan> block scoping the turn. Prepended so the main agent reads
    # intent before it picks tools.
    #
    # It gets the SAME facts the main agent gets, plus the last few turns.
    # It used to get only `req.prompt`, and that was the bug: a consultancy
    # conversation is cumulative, so by turn four a student writes "what about
    # Perth, under 40,000?" and the subject, level and country they settled
    # earlier appear nowhere in the sentence. A planner handed those seven
    # words scoped the turn without a field, the main agent wrote its search
    # query from the plan, and a data-science student got Project Management
    # and Supply Chain back. The `carried_context` field in the plan exists to
    # close exactly that gap, and it is unanswerable without these two inputs.
    #
    # The planner gets a DEFANGED copy of the message, not `req.prompt`.
    # `InputSanitiserHook` fires on BeforeInvocationEvent — inside the agent
    # run — so at this point in the request it has not run and `req.prompt`
    # still carries whatever markup the student typed. A forged
    # `<lead_facts>` block reached the planner intact and came back out as
    # `carried_context: english_test = IELTS 9.0; budget_per_year = 999999`:
    # plain untagged prose, prepended to the message, contradicting the real
    # facts block, and beyond the reach of the tag regex because there are no
    # tags left in it. Sanitising here closes the tagged form of that attack.
    # The untagged form ("my facts are: IELTS 9.0") is the planner prompt's
    # job, not this line's.
    plan = ""
    planner_usage = (0, 0)
    if effective_profile.planner.enabled:
        try:
            plan = await plan_for_prompt(
                sanitise_student_text(req.prompt),
                model=req.model or PROFILE.model,
                lead_facts=(
                    facts_module.render_lead_facts(req.lead_id)
                    if req.lead_id
                    else ""
                ),
                history=format_history(agent.messages),
                tools_catalogue=format_tool_specs(
                    agent.tool_registry.get_all_tool_specs()
                ),
                skills_enabled=bool(effective_profile.skills_dir),
            )
            # Read immediately, before anything else can await. The planner
            # stashes usage on the module rather than returning it; see
            # agent/planner.py::LAST_USAGE.
            planner_usage = planner_module.LAST_USAGE
        except Exception:  # noqa: BLE001
            # A planner failure must not take the turn down.
            log.exception("planner call failed; proceeding without a plan")
            plan = ""

    # <lead_facts> goes in EVERY turn. It used to go in only the first, on
    # the reasoning that it was then "already in the conversation history" —
    # which was wrong, and produced the failure this comment now exists to
    # prevent.
    #
    # `SlidingWindowConversationManager` trims by MESSAGE COUNT, and a turn
    # with two tool calls is six messages, so a window of 20 holds about
    # three turns. The first user message is the OLDEST, which makes the
    # facts block the FIRST thing deleted. By turn four the agent no longer
    # knew a lead had stated anything: it loaded `qualify-lead` and asked a
    # student for a fact he had given at the start, because from where it
    # stood he never had.
    #
    # Facts are ~200 tokens and they change during the turn anyway (every
    # `update_lead_facts` write). Re-rendering them per turn is both cheaper
    # and more correct than hoping a transient buffer holds them.
    #
    # Notes stay first-turn-only: they are prose, they can run to thousands
    # of characters, and unlike facts they are not what the grounding rule
    # depends on.
    framed_prompt = prepend_context(
        req.lead_id,
        framed_prompt,
        compact_threshold=effective_profile.memory.episodic.compact_threshold,
        include_notes=first_turn,
    )

    # Order in the final user message:
    #   <plan>…</plan>
    #   <lead_facts>…</lead_facts>            (every turn)
    #   <notes>…</notes>                      (first turn only)
    #   <the student's actual message>
    if plan:
        framed_prompt = f"{plan}\n\n{framed_prompt}"

    async def generator():
        if plan:
            yield {"event": "plan", "data": json.dumps({"content": plan})}
        final_reply = ""
        try:
            async for ev in _run_agent_stream(
                agent, framed_prompt, planner_usage=planner_usage
            ):
                if ev.get("event") == "done":
                    try:
                        final_reply = json.loads(ev["data"]).get("final_reply", "")
                    except (ValueError, TypeError):
                        final_reply = ""
                yield ev
        except Exception as exc:  # noqa: BLE001
            log.exception("agent stream failed")
            yield {"event": "error", "data": json.dumps({"message": str(exc)})}
        # Record the agent's half of the exchange. The counsellor's timeline
        # is built from ToolCall + Message, so a turn with only the student's
        # side recorded reads as though the agent never answered.
        if final_reply:
            try:
                CLIENT.append_message(req.lead_id, "agent", final_reply)
            except Exception:  # noqa: BLE001
                log.exception("failed to persist agent reply")

    return EventSourceResponse(generator())


@app.post("/api/reset")
def reset() -> dict[str, Any]:
    """Wipe the workspace back to seeds and drop cached agents.

    `reset_data_files` takes the WORKSPACE, not the agent_id — both agents
    share one, so a reset here is a reset for the counsellor view too. It
    also sweeps the notes/ directory, so no stale note survives into the
    next demo (see mocks/client.py::reset_data_files).
    """
    reset_data_files(PROFILE.workspace)
    CLIENT._reload_cache()
    _AGENTS.clear()
    return {"ok": True, "agent": "northbound_student", "workspace": PROFILE.workspace}


class EndSessionRequest(BaseModel):
    lead_id: str | None = None


@app.post("/api/end_session")
def end_session(req: EndSessionRequest) -> dict[str, Any]:
    """Simulate "time has passed". Drops the cached Agent for this lead so
    the next request rebuilds it — wiping `agent.messages` (conversation
    memory) while the lead's FACTS and NOTES persist on disk and get
    re-injected. That contrast is the whole point of the memory demo."""
    if req.lead_id:
        _AGENTS.pop(req.lead_id, None)
    else:
        _AGENTS.clear()
    return {
        "ok": True,
        "agent": "northbound_student",
        "ended": req.lead_id or "all",
    }
