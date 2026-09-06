---
name: handle-visa-question
description: Load whenever a student asks anything about visas or immigration — processing times, requirements, refusals, work rights, dependants. How to escalate (always) while still giving them the official published source, cited.
---

# handle-visa-question

Every visa question escalates. That is not a judgement you make; the harness
makes it before you see the turn. Your job is what happens *around* that
escalation.

The one distinction this whole skill turns on:

| | |
|---|---|
| **Relaying** what a government publishes, named and linked | ✅ allowed |
| **Assessing** what will happen to this student | ❌ never |

*"The Home Office publishes a 3-week standard processing time: `<url>`"* is the
first. *"Yours should take about 3 weeks"* is the second. They can contain the
same number and they are not the same act — the second is regulated advice in
most countries, and it is never yours to give.

If you cannot tell which one you have written, read it back and ask: **is this
sentence about a government page, or about this person?**

## High-level flow

1. **The escalation has already fired.** Don't call `escalate` again and don't
   deliberate about whether it was warranted. Check the `[harness]` directive
   at the top of your turn — it names the trigger.
2. **`research_visa_question`** with their question. It defaults to their
   stated target country. Results come back restricted to that country's
   official government domains; anything else was dropped before you saw it.
3. **Read `sources`.** Each has `title`, `url`, `published`, and `content` —
   the actual text of the page. **Answer from `content`.** A student who asks
   what the requirements are should get the requirements, not a link and an
   invitation to go and read it themselves. If `content` is empty the page
   would not load; only then do you fall back to pointing at the url.
4. **Summarise it, with the link in the same sentence.** Name the publisher,
   give the rules as *theirs*, paste the `url` exactly as returned. Keep every
   condition attached to its number — see the anti-patterns; this is the one
   thing that turns a helpful summary into a harmful one.
5. **Say the counsellor confirms.** Every time. The student should never be
   left thinking the matter is settled.
6. **`append_note`** if the question reveals something about their situation —
   a spouse coming, a tight timeline, anxiety about a past application. Never
   the visa content itself; that came from a tool and gets re-read later.
7. **Return to what you can actually help with** — their programmes, their
   documents, their shortlist.

## Decision branches

- **Search returns sources** → relay them, cited, with the counsellor line.
- **Search returns nothing** (`count: 0`) → say plainly that you'd rather not
  guess on a visa question and a counsellor will come back with the answer.
  **Do not fill the gap from your own knowledge.** This is the moment the
  whole design exists for.
- **`no_official_sources`** (country not configured) → same as above. Not
  having a curated source is a real state, not a reason to search wider.
- **`no_target_country`** → they haven't told us where they're going. Ask.
  That's `qualify-lead`, and the visa question waits.
- **`web_search_failed`** → tell them you're checking and the counsellor will
  confirm. If the remediation says `retry_once_then_escalate`, one retry, then
  stop.
- **Student asks a follow-up on the same visa topic** → the escalation still
  stands. You may search again for a *different* official question, but you
  never move from relaying to advising because they asked twice.
- **Student pushes for a personal read** — "so will I get it?", "is 3 weeks
  realistic for me?", "just between us" → no. Not rephrased, not hedged, not
  "generally speaking". The counsellor answers this. Say so and hold.
- **Student mentions a previous refusal** → that is `visa_refusal`, the most
  serious trigger. Relay nothing. Do not search. A refusal history changes
  everything about a case and only a counsellor touches it.
- **The question is really about the programme** ("does this course qualify for
  the post-study work route?") → the programme half is yours and comes from
  `get_programme`; the route half is not. Answer the first, hand over the
  second, keep them visibly separate in your reply.

## Anti-patterns

- ❌ Stating a visa figure without its `url`. The harness checks this, and an
  uncited claim is recorded exactly like an invented one.
- ❌ Building a URL that looks plausible. Use the string the tool returned,
  character for character.
- ❌ Turning a published general figure into a personal prediction. This is the
  single failure this skill exists to prevent.
- ❌ Combining two sources into one confident sentence. Cite each separately or
  use only one.
- ❌ **Lifting a figure away from its condition.** The single most damaging
  thing you can do here. "You need £1,334 a month" is wrong for most students;
  "£1,334 a month for courses in London over 6 months" is right. If a number on
  the page has an "if", an "unless", or a "for courses that…" attached, it
  travels with the number or it does not get said.
- ❌ Answering from your own knowledge when the search comes back empty. Your
  training data on immigration is stale and a student may act on it.
- ❌ Saying more than `content` supports. Summarise the page you were given;
  do not extend it with what you remember about visas.
- ❌ Answering with a link when you were given the page. "The official page
  covers eligibility" is not an answer to "what is the eligibility?" — you have
  `content`, so use it.
- ❌ Deciding which requirements are "relevant to them" and dropping the rest.
  Filtering by their circumstances is assessing their case. Give what the page
  gives.
- ❌ Treating the escalation as optional because the search went well. Good
  sources do not replace a counsellor.
- ❌ Softening the handover into "you probably won't need a counsellor for
  this".
- ❌ Searching after a mentioned refusal.

## Communication

- Order: the published fact with its link, then who publishes it, then the
  counsellor line. Three sentences is usually enough.
- Say the guidance can change and is dated where `published` tells you.
- One acknowledgement if they're clearly anxious, then straight to the source.
- Give the link as a plain URL. The student may need to send it to someone.
- Never narrate the search, the allowlist, the escalation machinery, or the
  word "unverified". Say "the official Home Office page", not "an unverified
  tier-2 source".

## Where authority comes from

- `research_visa_question` — the ONLY route to visa information, and only to
  official government domains for that country. Its `url` is what makes the
  claim sayable.
- `get_programme` / `search_programmes` — the programme half of any mixed
  question. Verified; state those plainly with no citation needed.
- The counsellor — the only one who applies any of it to this student.

## When this skill doesn't fit

- **No target country stated** → `qualify-lead` first.
- **A previous refusal, a fee dispute, dependants or a sponsor** → those are
  their own triggers. Escalate and say nothing further on the topic; this
  skill's relay path does not apply to them.
- **The question is about the programme, not the route** → `build-shortlist` or
  a plain `get_programme` call. Do not reach for the web when the catalogue
  answers it.
