# Northbound — Accelerator Application Working Document

**Status legend**
- ✅ **Verified** — implemented in the codebase. Checked 2026-09-14. Safe to submit as-is.
- 🎨 **Designed** — fully specified in the product prototype, not yet built. Real work product, but say "designed" not "we have".
- ⚠️ **You must fill this in** — commercial, market and team facts are not in the repo. Do not submit the placeholder text.
- 🔸 **Draft for your confirmation** — a position I drafted from the product design; you own the decision.

> Reviewers verify claims in diligence. Everything marked ⚠️ is deliberately blank rather than estimated. Keep the ✅/🎨 distinction when you write the final copy — "built and tested" and "designed in detail" are both strong, but conflating them is the one thing that breaks trust.

---

## 1. One-line description ✅

Northbound is an AI agent platform for overseas-education consultancies. A student-facing agent qualifies every inbound inquiry and shortlists programmes from the agency's own verified catalogue; a counsellor-facing agent hands the human a complete, sourced briefing the moment a lead reaches them.

## 2. Elevator pitch (≈120 words) ✅

Education agencies run on WhatsApp and spreadsheets. Inquiries arrive around the clock; counsellors work office hours. Counsellor capacity — not demand — is the ceiling on agency growth, and most of it is spent re-answering eligibility questions for students who will never convert, while deposit-ready leads wait days.

Northbound works both sides of that conversation. The student agent qualifies inbound leads, shortlists programmes from the agency's verified catalogue, and escalates on the agency's own rules. The counsellor agent turns what it collected into a briefing a human can act on in ninety seconds — what was established, what is still unresolved, and exactly why the lead was escalated.

It is built so neither agent can state a fact that did not come from a verified source.

🔸 If the form gives you only one sentence, lead with the two-sided framing. "An AI that answers students" is a crowded claim; "an AI that answers students **and** prepares the counsellor who takes over" is not.

---

## 3. The problem ✅

**Who has it:** Overseas-education consultancies — agencies placing students from South and Southeast Asia, Africa and the Middle East into universities abroad.

1. **Inquiries are 24/7; counsellors are 9–5.** Students research and message at night. A deposit-ready lead waiting until Monday has often already signed with a competitor.
2. **Counsellor capacity is the growth ceiling.** Revenue cannot grow without linearly hiring counsellors, because counsellor hours *are* the product.
3. **That capacity is spent on the wrong students.** Repeat eligibility questions from students who will never convert crowd out high-intent leads.
4. **Handover is lossy.** Even when a lead does reach a counsellor, the counsellor starts cold — re-reading a chat log, re-asking questions the student already answered. This is the half of the problem nobody is solving.
5. **The tooling is WhatsApp and spreadsheets.** No lead record, no audit trail, no routing rule. Nothing measurable, nothing reviewable.

**Why it matters:** The cost of a wrong answer is not a poor experience — it is a student's money and a year of their life. A misquoted fee, an intake deadline missed by a week, or informal visa advice can cost a family thousands and force a twelve-month wait. That is why generic chatbots have not taken this market: the failure mode is unacceptable, not merely annoying.

⚠️ **Add one real anecdote.** A named or anonymised agency describing a lead lost to slow response, or a student given a wrong answer. Worth more than all five points above.

---

## 4. Why now ✅ / ⚠️

✅ Tool-use LLMs became reliable enough to run a constrained, auditable workflow rather than open-ended chat. The unlock is not that models got smarter — it is that a model can now be held to a tool boundary strictly enough that it cannot answer from its own knowledge.

⚠️ **Add market timing:** outbound mobility trends in your corridors, recent visa-policy shifts pushing agencies toward new destinations, agency-side cost pressure. Cite each.

---

## 5. Our unique approach — the student side ✅

*(This section is your own copy, lightly edited. It is the strongest writing in the application — keep the voice.)*

**Only verified data reaches students.** Each agency loads its own programme catalogue. Entries stay invisible to students until a staff member marks them verified. There is no override.

**"I don't know yet" is a real answer.** When a student's qualification cannot be mapped to a programme's requirement — a three-year degree against a four-year rule, an unfamiliar examination board — the agent returns `indeterminate`, tells the student exactly which document would settle it, and schedules a follow-up. It does not estimate their chances. Most competing systems collapse this case into a yes or a no, which is where students get misled.

**Escalation is rule-driven, not left to the model's judgement.** A prior visa refusal, a fee dispute, dependants travelling, third-party sponsorship, a low-confidence match, or a student simply asking for a person — any of these hands the lead to a counsellor immediately. The agent gives no visa or immigration advice under any circumstance.

**Every decision is reconstructable.** Each lookup the agent performs is logged against the lead. A counsellor picking up a conversation sees what was established, what was recommended, and why it was escalated. Nothing the agent did is a black box to the agency that is legally responsible for it.

**The result is a product an agency can put its own name on.** That is the actual product requirement in this market, and it is a harder engineering problem than the chat interface.

### How each guarantee is enforced ✅

Reviewers with a technical background will ask whether these are prompt instructions or architecture. They are architecture:

| Guarantee | Enforcement |
|---|---|
| Only verified data reaches students | Catalogue entries are invisible to the agent until marked verified. The agent may never state a fee, deadline, requirement, ranking or visa rule that did not come from a tool call — enforced at the tool boundary, not only in the prompt. |
| Facts are quoted, never inferred | `update_lead_facts` requires a `source_quote` and **rejects the write** if those exact words are not in the student's messages. The agent cannot invent a budget or a target country from context. |
| `indeterminate` survives the whole stack | `check_requirements` returns `pass \| fail \| indeterminate` plus the document that would settle it. Never collapsed to a boolean anywhere — database, API or UI. |
| Verified vs unverified tiers | Anything from a web source must appear with its source URL in the same reply, attributed by name. No link, no claim. A verified catalogue entry always outranks a website. |
| Rule-driven escalation | Triggers fire on the **topic appearing**, not on the model judging it relevant. No visa or immigration advice, ever. |
| Full reconstructability | Every decision is replayable from `ToolCall` + `Message` rows alone. A code path that decides without writing a row is treated as a bug. |
| Hard tenant isolation | Every query filters on `tenant_id`, taken from the **verified session token** — never from a request body, query string or header the client controls. |
| Role-gated tool surface | A student session's agent subprocess does not merely hide counsellor tools — they are never defined in that process. Prompt injection cannot reach a tool that does not exist. |

🔸 **Framing:** "Our moat is not the model — anyone can call the same API. It is the constraint layer around it, which encodes how this industry actually works and cannot be reproduced by prompt engineering."

---

## 6. Our unique approach — the agency side

**This is the half that makes it a product rather than a widget.** Qualifying a student is only valuable if the human who takes over is better off than if they had answered the phone themselves.

### 6a. The counsellor agent — briefing, not transcript ✅ built / 🎨 surfaced

A counsellor opening a lead does not get a chat log to read. They get a structured briefing assembled from what the agent actually established:

- **Every fact carries its provenance** — `Confirmed by student`, `Inferred`, `Pending`, `Missing`. A counsellor can see at a glance which facts are safe to act on and which are assumptions.
- **Corrections are visible, not overwritten.** Where a student corrected the record, the briefing shows it: *"PTE Overall 58 — corrected from CV value 65."* The old value is not silently replaced, because which value the agent was working from explains every decision it made afterwards.
- **The briefing names what is *not* known.** On an escalated lead it states plainly what was never reached: *"Qualification, English score and destination collected. Budget, funding and career goals were never reached."* A counsellor who knows where the conversation stopped does not re-ask the first five questions.
- **"Why this is with you."** Every escalated lead carries its trigger and the moment it fired — *"Screening stopped at 10:39 PM · callback accepted for Wednesday morning · profile 54% complete."*
- **A suggested opening line**, so the counsellor starts the call already oriented.
- **The full timeline is still there**, with every tool call inline, timestamped, and showing its latency and data tier — including the ones that returned nothing. A counsellor can replay the conversation step by step.

✅ The four read-only counsellor tools — `list_leads`, `get_lead_briefing`, `get_lead_timeline`, `get_unassigned_queue` — are implemented in the agent's tool server today. 🎨 The counsellor agent as its own service, and the briefing UI, are designed and prototyped.

### 6b. Ask — natural language over the agency's own book of leads 🎨

A counsellor or agency owner can ask questions across every lead, answered from **stored evaluations** rather than re-reasoning, and strictly tenant-scoped:

- *"Which leads have English unresolved?"* → three leads, each with the specific blocker: an IELTS sitting booked for 6 September; PTE overall supplied but band scores missing; a medium-of-instruction waiver claimed but not evidenced.
- *"Why was Queen Mary not a strong match for Nimali?"* → one requirement failed, the rest passed — English PTE 58 against a 65 minimum, a shortfall of 7 points — read back from the stored evaluation, not recomputed.
- *"What did the overnight leads look like?"* → five conversations between 6 PM and 7 AM, one booked consultation, one escalation on a declared refusal, median conversation 11 minutes and 4 tool calls.

Two things make this defensible: every answer is traceable to a stored evaluation, and **the assistant refuses to improvise.** A question outside what it can source returns "not connected" rather than a plausible answer — because an assistant that invents a detail about a real student's file is worse than one that admits it is offline.

🔸 This is the feature most likely to sell the agency *owner* rather than the counsellor. Overnight-activity reporting is the thing an owner currently cannot get at all.

### 6c. Routing and the counsellor roster ✅ built / 🎨 extended

Routing is explicit and recorded — never a silent round-robin. ✅ Built today: country ownership per counsellor, weekly availability, invitations, deactivation with lead reassignment, and a role-plus-grants permission model resolved in exactly one place in code.

🎨 Designed, and the part agencies will recognise as *their* operation:

- **Capacity is a routing input.** *"Six slots left this cycle — the agent stops routing to her at 24."* *"Near capacity: three more leads and the agent will route past her."* Each counsellor has a named overflow target.
- **Leave holds leads; it does not reassign them.** *"Assignment paused. Four open leads are held for his return on 24 August."* And while someone is on leave, the widget offers students no slots with them — so the calendar cannot promise what the roster cannot deliver.
- **Seniority is a routing rule.** Junior counsellors are capped, supervised by a named senior, and **never receive escalations** — a declared visa refusal always routes to a senior counsellor.
- **Administrative accounts are excluded from the routing pool entirely**, so a branch manager with full catalogue access never silently receives a student.
- **Availability is what the widget may offer.** Bookings outside those hours require a counsellor to accept manually.
- **Invitations are domain-restricted, and no lead is routed until the invitation is accepted and availability is set.** An invited-but-inactive counsellor cannot become a lead's dead end.
- **Transcript access is always on and cannot be revoked** — a counsellor cannot advise on a conversation they are not allowed to read.
- **The unassigned queue is visible to everyone.** An escalated lead nobody can see is the exact failure escalation exists to prevent.

### 6d. Catalogue administration and verification 🎨

This is where "only verified data reaches students" is actually operated:

- **Draft entries are invisible to the agent.** *"Nothing here is visible to the agent until it is saved and marked verified."*
- **Edits are revisions, not overwrites.** *"Editing writes revision 7. The previous revision is retained and any shortlist built on it stays intact."* A shortlist a student already received never silently changes underneath them.
- **Freshness is shown everywhere**, on the student's shortlist as well as in admin: *"Catalogue verified 12 days ago"*, *"61 days ago · stale"*.
- **A requirements builder that can express uncertainty**, which is the whole point: a programme can declare *"INDETERMINATE when band scores are not supplied"* rather than being forced into a pass/fail rule that would mislead.
- **Guardrails against the dangerous save.** Saving a programme with no entry requirements warns that it will match every student who reaches the catalogue. Saving without a source URL warns that the entry is excluded from the refresh job and its figures will go stale silently.
- **A refresh queue with human approval.** An overnight job proposes changes; staff accept or reject each one, and a rejection keeps the stored value. Automation proposes; a person verifies. That is what lets the agency keep its name on the output.

### 6e. What the student sees, and why it helps the agency ✅

Shortlists are banded rather than ranked — *strong match*, *requires action*, *stretch* — and each entry names the single requirement the match turns on, with each requirement marked MET, NOT MET or INDETERMINATE. A *stretch* entry says exactly why: *"£2,000 above your stated tuition ceiling. Worth raising with your counsellor only if the budget can move."*

That phrasing is the product. It hands the student a reason to talk to a human, on a specific question, instead of quietly dropping out.

---

## 7. Product surfaces ✅ / 🎨

| Surface | Audience | Status |
|---|---|---|
| Student widget — embeddable chat, shows tool calls live as they run | Student | ✅ Built |
| Counsellor roster & routing console, with weekly availability grid | Agency | ✅ Built |
| Lead inbox — states from New → In conversation → Shortlisted → Escalated → Booked, each with a suggested next action | Counsellor | 🎨 Designed, partly scaffolded |
| Counsellor briefing & replayable timeline | Counsellor | ✅ Tools built · 🎨 UI designed |
| Ask — natural language across the agency's leads | Counsellor / owner | 🎨 Designed |
| Catalogue admin with requirements builder, revisions and verification | Agency admin | 🎨 Designed, routes scaffolded |
| Refresh queue — approve or reject proposed catalogue changes | Agency admin | 🎨 Designed |

**Agent capability set — 13 tools, role-gated** ✅
- *Student:* `search_programmes`, `get_programme`, `check_requirements`, `build_shortlist`, `escalate`, `book_slot`, `schedule_followup`, `update_lead_facts`
- *Counsellor (read-only):* `list_leads`, `get_lead_briefing`, `get_lead_timeline`, `get_unassigned_queue`
- *Web, unverified tier, independently key-gated:* `research_visa_question`, `find_unverified_programmes`

**Deliberately out of scope for v1:** analytics, WhatsApp/email ingestion, multi-language, payments.

---

## 8. Traction

### 8a. Product & engineering traction ✅ — verified, submit as-is

| Metric | Value |
|---|---|
| Production application code | **~23,800 lines** (9,577 Python · 13,217 TypeScript/TSX · 980 SQL) |
| Automated test suite | **198 tests, 100% passing** — API and database-constraint tests against real Postgres |
| End-to-end tests | 4 Playwright specs against a **live Clerk instance**, not mocks |
| Database schema | 4 versioned migrations, each documented with its design rationale |
| Code quality gates | ESLint + knip dead-code detection wired in |
| Design prototype | Full interactive prototype covering every agency-side surface in §6 |
| Core build sprint | 21 commits, 6–8 September 2026 |

**Shipped and working:** Clerk authentication with automatic agency provisioning · the role-plus-grants permission model · complete counsellor roster API (invite, country ownership, availability, deactivation, profile editing) · the counsellors operator console with weekly availability grid · leads and meetings schemas · the full student agent loop with its complete tool surface, 5 auto-loaded agent skills, episodic memory and a pre-turn planner · the four read-only counsellor tools.

🔸 **Framing:** "This is not a prototype. It is a tested, multi-tenant, auth-secured application with a documented schema and a passing 198-test suite — plus a complete interactive design prototype for the surfaces still ahead."

### 8b. Commercial traction ⚠️ — YOU MUST FILL THIS IN

State whatever is true. Zero is a fine answer; pre-revenue with real design partners is fundable, and a straight answer beats a vague one.

- **Design partners / pilot agencies:** _[How many? Named with permission? Stage — LOI, testing, paying?]_
- **Customer discovery:** _[How many agency interviews? What changed in the product because of them? If pre-revenue this is your strongest asset — "we built the briefing because 12 of 15 agencies said handover was their real cost" is very compelling.]_
- **Letters of intent / waitlist:** _[Count]_
- **Revenue:** _[Or "Pre-revenue"]_
- **Live usage:** _[Leads processed, conversations handled — if any real usage exists]_
- **Pipeline:** _[Agencies in conversation, and at what stage]_

---

## 9. Business model 🔸 — confirm or replace

**Recommended: per-seat SaaS subscription.**

Price against the constraint you remove. The binding cost is counsellor headcount, so the pitch is "Northbound absorbs the qualification load of roughly N counsellors for a fraction of one salary." Per-counsellor-seat pricing is legible to agency owners and matches how they already think about capacity.

| Tier | Fit | Price |
|---|---|---|
| Starter | 1–3 counsellors | _[fill]_ |
| Growth | 4–15 counsellors, multiple destinations | _[fill]_ |
| Enterprise | Multi-branch, multi-country | _[fill]_ |

⚠️ **Supply:** price points, target ACV, CAC, gross margin (LLM inference is your main variable cost — know your cost per conversation; the prototype's median of 11 minutes and 4 tool calls per conversation is a good basis), payback period.

**Models to explicitly reject, and why** (reviewers will ask):
- **Per-lead pricing** — punishes the agency exactly when marketing works, and creates an incentive to throttle the product.
- **Commission on placements** — puts you in the revenue-share chain, stretches cash collection to the university payment cycle (6–12 months), and creates a conflict of interest over which programmes get shortlisted. Given §5's verified-catalogue promise, this one actively undermines the product.

---

## 10. Market opportunity ⚠️ — YOU MUST FILL THIS IN

Do not submit an unsourced TAM. Build bottom-up and cite everything.

- **TAM** — overseas-education agencies globally. Sources: ICEF Monitor, British Council, HolonIQ, UNESCO Institute for Statistics.
- **SAM** — agencies in your beachhead corridors. Count them, multiply by realistic ACV.
- **SOM** — what you can credibly win in 24 months, reasoning shown.

**Beachhead** ⚠️: _[Name the corridor and why you win there first. The prototype is built around a Sri Lankan agency — Serendib Education, with counsellors covering UK, Ireland, Australia/NZ, and languages English/Sinhala/Tamil. If Sri Lanka → UK/Australia is the wedge, say so explicitly and explain the local advantage.]_

**Competition** ⚠️: _[Name real alternatives — incumbent agency CRMs, generic chatbot vendors, status-quo WhatsApp. One line each on why you win. §5 is your answer to generic chatbots; §6 is your answer to legacy CRMs, which have no agent and no briefing.]_

---

## 11. Team ⚠️ — YOU MUST FILL THIS IN

Weighted heavily by most programmes. The question is always **"why this team, for this problem?"**

Per founder: name, role, time commitment (be honest — they will ask), background with specifics and numbers.

- **Founder–market fit** is the single most important line. Experience in education consultancy, study-abroad, or destination-country admissions outweighs any credential. If anyone on the team has worked in or near an agency, lead with it.
- **Technical credibility** is evidenced by the codebase: a tested multi-tenant SaaS with a production auth model and documented schema, built by a small team, is direct proof of shipping ability.
- **Domain depth is already visible in the work** — the routing rules in §6c (junior supervision, leave holds, overflow targets, domain-restricted invitations) are not things you invent at a desk. If they came from talking to agencies, say so; it is evidence of customer discovery.

⚠️ **Address gaps head-on:** no education-industry insider? Name an advisor who is. Solo founder? Say how sales and distribution are covered.

---

## 12. Roadmap 🔸 — confirm

**Now:** booking API on the completed meetings schema · move the agent onto Postgres · catalogue admin and verification queue · counsellor dashboard on live data.

**Next:** the counsellor agent as its own service, powering briefings and Ask · the follow-up worker for automated deadline chasing · **WhatsApp ingestion** — this is where these agencies actually live and is the highest-leverage item on the list · overnight catalogue refresh with the approval queue.

**Later:** analytics for owners · multi-language (the roster already models Sinhala and Tamil) · payments · university-side integrations.

⚠️ Attach dates and tie them to the raise: this milestone, by this date, needs this much.

---

## 13. The ask ⚠️ — YOU MUST FILL THIS IN

- Amount, and on what instrument
- Use of funds: engineering / sales / runway months
- What you want from **this** programme specifically — named customer introductions, distribution in a particular market, technical mentorship. "Funding and mentorship" is a weak answer.

---

## Appendix A — Technical architecture ✅

**Stack:** Python 3.12 + FastAPI · PostgreSQL (Supabase) with SQLAlchemy · React + Vite + TanStack Query · Clerk for identity and tenancy · MCP (Model Context Protocol) for the agent tool surface · LLM tool-use loop via the Strands agent framework.

**Design decisions, all documented in-repo:**
- **The agent is fully declarative.** Identity, model, system prompt, tool servers, memory configuration and confidence floor live in one versioned `agent-profile.yaml`; the Python harness is only a loader. Changing agent behaviour is a config change under version control.
- **A Clerk Organization *is* the tenant.** No mapping table, no second identifier to keep in step. A new agency costs 2 database rows.
- **Access is a role plus additive grants**, resolved in exactly one place in code, restated as a database CHECK constraint, with a test asserting the two have not drifted.
- **Lead facts are a log of claims, not a row of answers.** "What is this student's GPA?" is answered by a rule over the log, never by reading a column — which is what lets every value on screen trace back to the words it came from, and what makes the briefing's provenance labels possible.
- **Double-booking is unrepresentable, not unlikely.** A Postgres `EXCLUDE USING gist` constraint rejects two students booking the same slot in the same second, rather than losing the race in application code.
- **No empty slots.** Free time is derived from availability rules minus booked meetings, never stored — so editing a weekly pattern never becomes a reconciliation problem.
- **Money in minor units with currency alongside**, never floats. Times stored UTC, rendered in the *viewer's* timezone — an agency with branches in two countries has no single correct clock.

---

## Appendix B — Pre-submission checklist

- [ ] Every ⚠️ section filled with real data
- [ ] Every 🔸 position confirmed or rewritten
- [ ] **Every 🎨 claim written as "designed", never as "we have"** — this is the one that matters in diligence
- [ ] Every market figure carries a named source
- [ ] One concrete customer anecdote added to §3
- [ ] Founder–market fit stated explicitly in §11
- [ ] Demo ready: the prototype covers the agency surfaces the running code does not
- [ ] No placeholder or bracketed text remains
- [ ] Trimmed to the form's word limits — cut §5, §6 and §8a last, they are your strongest sections
