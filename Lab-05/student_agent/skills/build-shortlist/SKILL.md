---
name: build-shortlist
description: Load when a student is ready to be shown programmes — how to check you have the gating facts first, call build_shortlist, present each entry by its hinge, and tell a settled match apart from an undecided one.
---

# build-shortlist

Turning a qualified lead into three to five programmes they can actually get into. **`build_shortlist` is the ONLY way programmes reach a student.** You never assemble a list from `search_programmes` results yourself — the 3–5 rule and the confidence floor are enforced inside the tool, and a hand-built list bypasses both.

The single most common failure here is calling the tool too early. `build_shortlist` refuses for two completely different reasons and reports them almost identically; step 1 exists so you never have to tell them apart.

## High-level flow

1. **Check the gating facts BEFORE you call anything.** Read `<lead_facts>`. You need all five: `target_country`, `field_of_study`, `qualification`, `grades`, `english_test`. Any missing → stop, load `qualify-lead`, come back. Calling the tool with gaps produces a refusal that *looks* like low confidence and is not.
2. **`build_shortlist`** with an empty `lead_id` — it defaults `country` and `field` to the student's stated facts. Pass them explicitly only when the student asked to explore somewhere else ("what about Australia instead?").
3. **Read each entry's `verdict`, not just its `confidence`.** An entry is `pass` (this match is settled) or `indeterminate` (this match turns on something we haven't seen). Both are legitimately on the list. They are not the same news.
4. **`get_programme` for each shortlisted id** if you're about to mention a fee, a deadline, an intake or a duration. The shortlist entry carries only `programme_id`, `confidence`, `hinge`, `verdict` and `resolving_document` — every other number must come from a catalogue call.
5. **Schedule what has a date.** Any `application_deadline` you surfaced → `schedule_followup(kind="intake_cutoff")`. Any `resolving_document` on an indeterminate entry → `schedule_followup(kind="document_chase")`. Follow-ups are scheduled, never remembered.
6. **Present, led by the hinge.** Three to five short lines, each naming the programme like a person would and then the one thing the match turns on.
7. **`append_note`** if the shortlist revealed something about the person — that they flinched at the fees, that a parent is steering the country choice. Never write programme facts into notes.

## Decision branches

- **Entry `verdict` is `pass`, confidence 1.0** → hinge reads "all requirements met". Say so plainly. This is the strongest thing you can tell a student and it needs no qualification.
- **Entry `verdict` is `pass`, confidence below 1.0** → an *optional* requirement wasn't met. The match holds; the hinge names the soft spot. Present it as a match with a caveat, not as a doubt.
- **Entry `verdict` is `indeterminate` with a `resolving_document`** → the hinge needs paperwork. Name the document in the same breath as the programme, and `schedule_followup` to chase it. **Do not present the confidence number to the student** — 0.8 on an undecided match reads as "80% likely to get in", which is not what it means. Say what's decided and what isn't.
- **Entry `verdict` is `indeterminate` with only `missing_facts`** → nothing is wrong with the match; you just never asked. **Ask for those facts and re-run `build_shortlist` before presenting anything.** Handing a student five "undecided" programmes when one question would settle all five is the worst outcome on this page — it reads as bad news and it isn't.
- **Every entry shares the same `missing_facts`** → that is one question, not five problems. Ask it once.
- **`shortlist_unavailable` (422) and the detail names a missing fact** ("the student has not stated a target country") → this is a `qualify-lead` problem, not an escalation. Ask for the fact.
- **`shortlist_unavailable` (422) and the detail says programmes don't clear the floor** ("only 1 programme(s) in Canada clear the 0.6 confidence floor") *with all five gating facts present* → this is the real low-confidence case. `escalate` with the `trigger` the error handed you. Do not retry with a wider `country`, a blanked `field`, or a longer list.
- **Student asks about a country you haven't shortlisted** → call `build_shortlist` again with that `country`. A second shortlist is fine; a hand-assembled one is not.
- **Student asks about a specific programme not on their shortlist** → `get_programme`. Answer from what it returns. If it's `not_found`, that programme isn't one this consultancy represents — say that, don't describe it from memory.
- **Fewer than three would clear the bar** → you will never see this as a short list. The tool refuses instead. If you are ever tempted to present two, that is the sign you built the list yourself.
- **`search_programmes` returns nothing at all for their country and field** → the catalogue genuinely has no entry. Load `find-unlisted-programmes`; it owns that path. Candidates found there are never shortlist material — no requirement rows means no `check_requirements`, no confidence, no ranking.
- **A shortlist comes back but most of it fails a constraint the student gave** — over their budget, wrong city, wrong intake → **this is not a successful shortlist.** Budget is an OPTIONAL requirement, so an unaffordable programme still scores as a `pass` with slightly lower confidence and still appears here. Re-query with the constraint (`search_programmes` takes `max_tuition`), and if the catalogue cannot fill three, load `find-unlisted-programmes`. Telling a student "the other three are above your budget" is reporting a failure, not answering the question.

## Anti-patterns

- ❌ Calling `build_shortlist` before the five gating facts are in. The refusal is indistinguishable from genuine low confidence, and escalating on it burns a counsellor's time on a question you could have asked.
- ❌ Assembling a list from `search_programmes` results. Search tells you what exists; only `build_shortlist` decides what a student is shown.
- ❌ Retrying a refusal with looser criteria — dropping the field, widening the country, raising the limit. The floor is a safety gate, and working around it is the failure it exists to prevent.
- ❌ Reading `confidence` as a probability of admission. It is the ratio of requirements that came back `pass`. Never quote the number to a student.
- ❌ Presenting an `indeterminate` entry as a match. "You're a good fit for the MSc at Camden Met" when the verdict is undecided is exactly the guess the grounding rule forbids.
- ❌ Quoting a fee, deadline, duration or intake that came from the shortlist entry. It isn't there. `get_programme` first.
- ❌ Mentioning a deadline without scheduling against it.
- ❌ Listing all five entries at equal weight when one is a clean `pass` and four are undecided. Lead with what's settled.

## Communication

- Name programmes the way a person would: "the MSc Data Science at Camden Met", never a bare `p_uk_001`.
- One line per entry. The hinge is the payload — the student wants to know *what this turns on*, not a description of the course.
- For an indeterminate entry, the shape is: programme, then "this one depends on X, which we'd need your Y to settle". Concrete document, no hedging language around it.
- Do not narrate the tool calls, the confidence floor, verdicts, or the fact that a shortlist was "built". The student sees options, not a pipeline.
- End with one question or one next step, not both.

## Where authority comes from

No policy documents in this lab — the tools are the authority:

- `build_shortlist` — the only sanctioned source of a list. Owns the 3–5 rule and the confidence floor.
- `get_programme` / `search_programmes` — the only source of fees, deadlines, intakes, durations and requirement text.
- `check_requirements` — the only source of an eligibility verdict. `build_shortlist` runs it for you; call it directly only when a student asks about one specific programme.
- `schedule_followup` — the only place a date is durably kept.

## When this skill doesn't fit

- **Gating facts missing** → `qualify-lead`.
- **An entry came back `indeterminate` and the student pushes for their odds anyway** → `handle-indeterminate`. It owns the pushback.
- **The tool refused on confidence with complete facts** → `escalate`, then `handle-escalation` for what to say next.
- **Any escalation trigger surfaced while presenting** — a prior refusal, a fee dispute, dependants or a sponsor, a visa question, a request for a person → the trigger outranks the shortlist. Let it fire; pick the programmes back up afterwards.
