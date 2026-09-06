---
name: qualify-lead
description: Load when a student's <lead_facts> block is missing fields you need — how to work out which facts are actually blocking, what order to ask in, and how to record answers with update_lead_facts.
---

# qualify-lead

Getting a student from "I want to study abroad" to a file complete enough to search and check against. **This skill decides WHICH facts to chase and IN WHAT ORDER; the facts themselves come only from the student's own words.** You are never filling in a form for them — you are recording what they tell you, one statement at a time.

The seven keys, grouped by what each one unblocks. This grouping is the whole point of the skill:

| Key | Blocks |
|---|---|
| `target_country` | `search_programmes` — without it you cannot search at all |
| `field_of_study` | `search_programmes` — a country-only search returns everything |
| `qualification` | `check_requirements` — most entry rules test this |
| `grades` | `check_requirements` |
| `english_test` | `check_requirements` — usually the single most common `fail` |
| `budget_per_year` | `check_requirements`, when the programme has a budget rule |
| `intended_intake` | `check_requirements`, when the programme has an intake rule |

The last two are not optional extras. A programme that tests them and has no
answer comes back `indeterminate`, which drags its confidence down and can
push a perfectly good match below the floor. They are last in the asking
order because they don't block the *search*, not because they don't matter.

## High-level flow

1. **Read `<lead_facts>` first.** It arrives at the top of the student's first message of the session and lists what is already known. Anything absent is NOT KNOWN — but anything present is already recorded and must not be asked for again. Re-asking for a fact the block already holds is the most visible failure in this skill.
2. **Name the gap out loud to yourself, not to the student.** Which of the seven are missing, and which group are they in? You are chasing the smallest set that unblocks your next tool call — not all seven.
3. **Ask in group order.** Country and field before anything else; qualification, grades and English test next; budget and intake last, and only if the student hasn't volunteered them. Asking for budget while you still don't know the country wastes a turn on a filter you cannot yet apply.
4. **Ask one or two at a time.** Two related questions in one message is natural ("Which country are you aiming for, and what subject?"). Four is an intake form and students abandon those.
5. **Record each answer with `update_lead_facts`** — one call per fact, `source_quote` copied from what they actually typed. Normalise the `value` ("IELTS 6.5" from "i got a 6.5 overall in ielts"); never normalise the quote.
6. **Re-read what is now known** and repeat from step 2 until you have enough for the tool you're heading for — not until all seven are filled.
7. **Hand off.** Country and field present → you can `search_programmes`. All five gating facts present → load `build-shortlist`. Do not build a shortlist yourself here.

## Decision branches

- **Student states several facts in one message** ("4-year BEng in software engineering, 78%, IELTS 7.0") → one `update_lead_facts` call per fact, each with the portion of their sentence that supports it. Do not batch them into one call, and do not attribute all four to the same full-sentence quote.
- **`update_lead_facts` returns `fact_not_stated` (422)** → you misheard them, or you inferred. Ask the student to confirm in their own words, then write what they say. **Never reword the quote and retry** — see anti-patterns.
- **Student gives a fact you didn't ask for** → record it. Volunteered facts are still stated facts.
- **Student answers vaguely** ("somewhere in Europe", "decent grades", "any intake next year") → that is not a usable fact. Ask once for the specific version *before* recording it. A vague value gets stored, then fails to parse downstream and comes back as `indeterminate` on every programme — you have not saved a turn, you have hidden the question inside an eligibility result. If they genuinely don't know yet, that is a real state: record nothing, and use `schedule_followup` to come back to it rather than pressing.
- **`check_requirements` or a shortlist entry reports `missing_facts`** → those are this skill's job. Ask for them, record the answers, re-run the check. Do not escalate, and do not treat them as documents to chase.
- **Student corrects an earlier fact** ("actually it was 6.5, not 7.0") → `update_lead_facts` again with the same key and the new quote. The later write wins; the audit trail keeps both.
- **Student asks a programme question mid-qualification** → answer it with a tool first, then return to the gap. Their question outranks your checklist.
- **All facts complete on arrival** (the `<lead_facts>` block shows nothing missing) → this skill does not apply. Go straight to `build-shortlist`.

## Anti-patterns

- ❌ Asking for a fact that is already in `<lead_facts>`. Read the block before you open your mouth.
- ❌ Rewording `source_quote` until the check passes. The rejection is the system catching an invented fact; defeating it writes a wrong fact into someone's file and every later eligibility verdict inherits it.
- ❌ Inferring from context. A student writing from Berlin has not stated `target_country`. A student mentioning their father's company has not stated `budget_per_year`. Mentioning a school is not stating a `qualification`.
- ❌ Asking all seven at once. It reads as a form, and students who abandon a form don't come back.
- ❌ Chasing `budget_per_year` and `intended_intake` before the gating five. They filter results; they don't unblock tools.
- ❌ Treating "enough facts" as "all seven". If country and field are known, you can already search and show them something useful while you chase the rest.
- ❌ Calling `search_programmes` with a `field` you guessed to fill a gap. If `field_of_study` is unknown, search on country alone and read what comes back.

## Communication

- Say why you are asking, in half a sentence: "So I can check what you'd be eligible for — what were your final grades?" A bare question reads as an interrogation; a reason reads as help.
- Acknowledge what they just told you before asking the next thing. It shows the record is being kept.
- Never mention `update_lead_facts`, keys, quotes, or the facts table. The student is not looking at your data model.
- If they've given you a lot in one message, confirm the set back in one short line rather than four separate acknowledgements.

## Where authority comes from

There are no policy documents in this lab. Authority is the student's own words and the tool results:

- `update_lead_facts` — the only way a fact enters the record, and the check that it was actually stated.
- `search_programmes` — unblocked by `target_country` + `field_of_study`.
- `check_requirements` — unblocked by `qualification` + `grades` + `english_test`.
- `append_note` — for what the facts table structurally cannot hold: that a parent is driving the decision, that they're anxious about cost, that you promised to come back on something. Never programme facts.

## When this skill doesn't fit

- **Facts are complete** → `build-shortlist`.
- **A check came back `indeterminate` with `pending_documents`** → `handle-indeterminate`. That is not a missing fact; it is a fact we have that cannot be mapped, and more questions will not resolve it. (An `indeterminate` with only `missing_facts` is still this skill — ask.)
- **Any escalation trigger appears while you're qualifying** — a prior visa refusal, a fee dispute, dependants or a sponsor, a request for a person, any visa or immigration question → stop qualifying and let the escalation happen. Facts can wait; the trigger cannot.
