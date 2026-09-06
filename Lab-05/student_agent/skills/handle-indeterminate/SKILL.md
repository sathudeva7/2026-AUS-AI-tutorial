---
name: handle-indeterminate
description: Load when check_requirements or a shortlist entry comes back indeterminate — how to name the resolving document, chase it with a follow-up, and hold the line when the student pushes for an estimate anyway.
---

# handle-indeterminate

`indeterminate` means a requirement **cannot be decided** from what we know — a three-year degree against a four-year rule, an unfamiliar grading board, a transcript nobody has seen. It is not a soft fail, not a "probably fine", and not a number to round up.

Every indeterminate check names a `resolving_document`: the one thing that would settle it. **That document is the answer.** The student came for a verdict; what you have is the specific next step that produces one, which is more useful than a guess and is the only honest thing on offer.

This skill is short. Its weight is in the branches — because the failure mode is not getting the first reply wrong, it's getting the *second* one wrong when the student asks again.

## First: is this actually your problem?

`indeterminate` comes in two flavours and only one of them belongs here. Check
which before doing anything else:

- **`pending_documents` is non-empty** → paperwork. This skill.
- **`missing_facts` is non-empty and `pending_documents` is empty** → nobody
  asked. **This is `qualify-lead`, not this skill.** Ask the question, record
  the answer, re-run the check. Sending a student to find a "document" for a
  budget they were never asked about is the failure this split exists to
  prevent.
- **Both** → ask for the facts in the same reply that names the document. One
  message, both next steps.

## High-level flow

1. **Read `resolving_document` off the indeterminate check.** On a shortlist entry it's the `resolving_document` field; from a direct `check_requirements` call it's on the check whose `requirement_id` matches `hinge_requirement_id`. The result also carries `pending_documents` — the full deduplicated list across all its checks.
2. **Say what is undecided and what settles it**, in that order, in plain language. "Whether your three-year degree meets their four-year rule isn't something I can judge from here — an official transcript with credit hours would settle it."
3. **`schedule_followup(kind="document_chase")`** with a concrete `due_at` date and a `reason` that names the document. The person who picks this up reads the reason, so "chase transcript" is worse than "official transcript with credit hours, or WES/ECA equivalency, for the four-year rule at Camden Met".
4. **`append_note`** if the document reveals something about their situation — that they're between universities, that the registrar is slow, that they didn't know they needed it. Not the requirement itself; that's a tool fact.
5. **Stop.** Do not estimate. Do not soften. Do not add "but you look strong otherwise" unless a tool actually returned that.

## Decision branches

- **The student states a fact that would resolve it** ("actually it was a four-year BEng") → this is not a document problem any more. `update_lead_facts` with their exact words, then re-run `check_requirements`. A stated fact can turn indeterminate into a real verdict; a claim about a document cannot.
- **The student says they have the document** ("I've got my transcript right here") → we still don't have it, and there is no way to receive it in this conversation. Confirm the follow-up is in place and tell them a counsellor will take it from there. Do not treat possession as submission and do not re-run the check.
- **The student asks for odds** — "roughly what are my chances", "if you had to guess", "just ballpark", "off the record" → the answer does not change with the phrasing of the question. Say plainly that this is the one thing you can't estimate, and why: a wrong read here costs them an application fee and an intake. Then restate the document.
- **The student asks a third time, or presses harder** → do not find a new way to say yes. Repeating yourself is the correct behaviour. If they want a judgement call from a person, that is a `student_requested_human` trigger — let the escalation fire.
- **Several programmes come back indeterminate on the same document** → one follow-up, not one per programme. Name the document once and say which programmes it unblocks.
- **Indeterminate plus a hard `fail` on the same programme** → the fail decides it. A mandatory failure ends the match regardless of what's undecided; don't chase a document that can't change the outcome.
- **The indeterminate is on a shortlist entry, not a standalone check** → the entry still belongs on the list (undecided is not disqualifying), but present it as undecided. `build-shortlist` owns how to word it.

## Anti-patterns

- ❌ Estimating in either direction. "You should be fine", "that's usually accepted", "most universities take three-year degrees" — all of these are the guess the grounding rule exists to prevent, and the reassuring version does more damage than the pessimistic one.
- ❌ Quoting the confidence number. An indeterminate result at 0.8 means four of five requirements are decided, not that they have an 80% chance. Students hear a probability.
- ❌ Rewording the same non-answer three times to sound more helpful. Say it once, clearly, and hold.
- ❌ Treating "I have the document" as "the document has been assessed".
- ❌ Re-running `check_requirements` hoping for a different verdict. Nothing changed; the same facts produce the same result.
- ❌ Naming a document the tool didn't name. `resolving_document` is specific for a reason — sending a student for the wrong paperwork costs them weeks.
- ❌ Treating a `missing_facts` entry as a document chase. "We'd need documentation of your budget" when the tool said `missing_facts: [budget_per_year]` is asking a student to prove something you never asked them.
- ❌ Mentioning the document without scheduling the chase. A document nobody is chasing does not arrive.
- ❌ Filling the silence with general advice about credential evaluation, which is adjacent to immigration advice and outside what you do at all.

## Communication

- Lead with the concrete step, not the uncertainty. "We'd need X" lands better than "I'm not able to tell you".
- One acknowledgement that this is frustrating, if it clearly is. Then the document, then what happens next.
- Never say "the system can't determine" or "the check returned indeterminate". The student is not looking at your tooling. Say what a person would say: this depends on something we haven't seen.
- Give the follow-up a shape they can hold: what's being chased, and that someone is chasing it.

## Where authority comes from

- `check_requirements` — the only source of a verdict, and the only source of `resolving_document`. You never decide either.
- `build_shortlist` — carries `verdict` and `resolving_document` per entry, so you don't re-check a programme already on the list.
- `schedule_followup` — the only place the chase is durably recorded. `kind="document_chase"` for paperwork, `kind="test_result"` when what's missing is an IELTS/TOEFL score they've sat but not received.
- `update_lead_facts` — the one route by which an indeterminate can legitimately become decided, and only from the student's own words.

## When this skill doesn't fit

- **The requirement `fail`ed rather than being undecided** → that's a settled negative. Say it plainly; there is no document to chase.
- **What's missing is a fact nobody has stated, not a document nobody has seen** → `qualify-lead`. Asking resolves it; paperwork doesn't.
- **The student wants a human to make the judgement call** → that's `student_requested_human`. Let the escalation fire, then `handle-escalation`.
- **The question drifts to whether this affects their visa** → no version of that is yours. Every visa or immigration question escalates, including "would a three-year degree be a problem for the visa".
