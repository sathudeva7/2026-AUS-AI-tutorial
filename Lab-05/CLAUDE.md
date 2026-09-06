# Northbound

B2B SaaS for overseas-education consultancies. An AI agent owns the first response to every inbound student inquiry: it qualifies the student, matches them against the agency's own programme catalogue, and hands the lead to a human counsellor when the rules say so.

Multi-tenant. Each agency loads its own catalogue, requirement rules, counsellor roster and country ownership. Demo tenant is Serendib Education; all fees and deadlines in seed data are placeholder.

**Read** `AGENTS.md` **before touching agent code.** It holds the agent loop, the tool contracts and the non-negotiable rules. This file is orientation and conventions only.

## The problem

Agencies run on WhatsApp and spreadsheets. Inquiries arrive around the clock; counsellors answer during office hours. Counsellor capacity is the constraint on agency growth, and it gets spent on repeat eligibility questions from students who will never convert while deposit-ready leads wait. Northbound removes the unqualified volume from the calendar and closes the after-hours gap.

## Stack

- Python 3.12 + FastAPI
- Postgres (SQLAlchemy + Alembic)
- Anthropic API (Claude, tool use for every lookup)
- Background worker for follow-ups (RQ)
- Clerk for identity and tenancy — a Clerk **Organization is the tenant**
- Single web frontend: embeddable chat widget + counsellor/admin app



## Layout

```
app/
  agent/        loop, system prompt, tool implementations
  api/          FastAPI routers
  models/       SQLAlchemy models
  services/     catalogue matching, requirement evaluation, routing
  worker/       follow-up jobs
web/            widget + dashboard
tests/          scenario tests (see AGENTS.md)
```



## Core entities

`Tenant`, `Counsellor`, `Programme`, `Lead`, `Message`, `ToolCall`, `Followup`. Field lists are in `AGENTS.md`.

## Surfaces

1. **Student widget** — embeddable chat panel on the agency's site. Shows the agent's tool calls as they run.
2. **Counsellor dashboard** — lead list, lead detail with timeline, AI briefing (what the agent did and why it escalated).
3. **Catalogue admin** — programme create/edit with a requirements builder; verification queue for unverified entries.
4. **Counsellor admin** — invite counsellor, set owned countries.

Out of scope for v1: analytics, WhatsApp/email ingestion, multi-language, payments.

## Rules that constrain implementation

These are product guarantees, not preferences. Do not soften them for convenience.

- **Tools are the only source of facts.** The agent may never state a fee, deadline, requirement, ranking or visa rule that did not come back from a tool call. Enforce at the tool boundary, not only in the prompt.
- `indeterminate` **is a first-class result.** `check_requirements` returns `pass | fail | indeterminate` plus the document that would settle it. Never collapse indeterminate into a boolean anywhere in the stack.
- **Facts are quoted, not inferred.** `update_lead_facts` requires a `source_quote` and rejects the write if those words are not in the student's messages. Keep the rejection — it is the guardrail.
- **Escalation is rule-driven.** Triggers: prior visa refusal, fee/payment dispute, dependants or third-party sponsorship, shortlist confidence below the floor, student asks for a person. Triggers fire on the topic appearing, not on confirmation. No visa or immigration advice, ever.
- **Routing is explicit.** Assign by `Counsellor.countries`. No owner for the country means the lead joins the unassigned queue. Never round-robin silently to fill a gap.
- **Everything is reconstructable.** Every agent decision must be replayable from `ToolCall` + `Message` alone. If a code path makes a decision without writing a row, that path is wrong.
- **Tenant scoping.** Every query filters on `tenant_id`. No cross-tenant read is ever correct. `tenant_id` is the Clerk `org_id`, and it comes from the verified session token — never from a request body, query string or header the client controls. A tenant id the caller can set is not a scope, it is a suggestion.
- **Membership, not domain, defines the agency.** Access comes from Clerk organization membership. Do not gate on email domain: small agencies run on Gmail, agencies with branches run on several domains, and anyone able to guess an address on the domain would be inside. Invitations are minted per address and only the recipient can accept.



## Conventions

- Money in minor units with currency stored alongside.
- Times stored UTC, rendered in the **viewer's** timezone, not the tenant's — an agency with branches in two countries has no single correct clock, and the student has their own. Any time two parties must both attend (a booked consultation) carries its zone; a bare "10:30" across zones is a missed call. See `web/src/lib/format.ts`.
- Tool inputs and outputs are Pydantic models; the JSON schema is generated from them, never hand-written.
- Confidence floor is tenant config, not a constant.
- Prompt lives in one versioned file. Changing it requires re-running the scenario tests.
- Scenario tests in `AGENTS.md` are the acceptance suite. A change that breaks one is a regression, including "the agent was more helpful".



## Design

The frontend follows the **Organic** design system — cream and sand ground, terracotta accent with sage second accent, Caprasimo headings over Figtree, 16px radii growing to pills. All colour, type, spacing and radius values come from the design system's CSS variables; never hard-code a hex or a px value the tokens carry. Photographs go through the `.washed` wrapper. Left-aligned, asymmetric, generous whitespace.

## When working on this

- Prefer failing loudly over degrading gracefully. A tool that errors should surface and escalate, never fall back to model knowledge.
- Do not add fields, screens or config the current scope needs. v1 is deliberately small.
- If a requirement here conflicts with `AGENTS.md`, `AGENTS.md` wins for agent behaviour; ask before resolving anything else.

