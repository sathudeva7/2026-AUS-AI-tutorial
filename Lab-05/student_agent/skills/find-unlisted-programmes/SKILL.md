---
name: find-unlisted-programmes
description: Load when the verified catalogue cannot serve what a student is asking for — nothing in their subject, or nothing that meets a constraint they just gave (budget, city, intake) — how to search university sites, tell them what those pages say, and keep candidates clearly separate from the catalogue.
---

# find-unlisted-programmes

The catalogue holds what this consultancy has checked. It is not the whole
world of higher education, and a student asking for something outside it is
asking a reasonable question. The catalogue coming up short is not a dead end
— it just means the answer is not yours to certify.

## When this applies

Two situations, and the second is the one that gets missed.

1. **The catalogue has nothing in their subject.** `search_programmes` returns
   zero. Obvious.
2. **The catalogue has entries, but none that meet the constraint they just
   gave.** They said "under AUD 40,000" and one of four options qualifies.
   They said "near Sydney" and everything is in Melbourne. They said "starting
   January" and every intake is September.

The second case looks like a catalogue hit — a shortlist came back, the tool
succeeded — and it is not one. **A shortlist the student cannot use is the
same outcome as an empty one.** If you find yourself writing "the other three
are above your budget", the catalogue has failed to answer and this skill
applies.

The test is not "did a tool return rows". It is: **can this student actually
act on what came back?**

`find_unverified_programmes` searches university sites and official study
portals for that country, filters them by host, and fetches the pages. So you
get real course pages, not marketing snippets. **Use them.** A student who asks
what a course involves deserves an answer.

What you cannot do is treat those pages as catalogue entries. The difference is
not caution for its own sake — it is mechanical:

| | Catalogue programme | Unlisted candidate |
|---|---|---|
| Requirement rows | yes | **none** |
| `check_requirements` | works | nothing to check against |
| Confidence score | derived from verdicts | would have to be invented |
| Shortlist | eligible | never |
| Who checked it | this consultancy | nobody yet |

Eligibility for one of these is not *unknown*. It is **uncomputable**. That is
why there is no version of this where you rank them or say how good a fit they
are.

## High-level flow

1. **Confirm the catalogue really cannot serve them.** Two checks, not one:
   - **Subject.** `search_programmes` with their country ALONE before you
     conclude anything — `field` is a substring match on the catalogue's own
     wording, so "marine biology" may miss an entry called "Marine and
     Antarctic Science".
   - **Constraint.** If they named a budget, re-run `search_programmes` with
     `max_tuition` set to it. One qualifying programme is not a shortlist, and
     three unaffordable ones are not an answer. Same for a city or an intake:
     check the constraint against the catalogue rather than mentioning it in
     prose afterwards.

   A catalogue entry the student can act on always beats a web result. A
   catalogue entry they cannot act on beats nothing.
2. **`find_unverified_programmes`** — it takes one thing, a `query`, and
   **writing it well is the whole job.** The search is semantic: it matches on
   what a page means, so give it the student's question, not a tidied-up
   keyword list.
   - **Name the institution if they named one.** By far the strongest signal.
     A student asking about Kingston who gets UCL and Brunel back was asked
     about "Civil Engineering in the UK", not about Kingston.
   - Keep their words and their spelling. "is there any courses in kingston
     univerity for msc civil enginering" finds the right pages; the polished
     rewrite does not.
   - Put the level, subject and place in a sentence, not in separate clauses.
   - There is no country filter and no domain restriction. If they ask about
     somewhere other than their stated target, search it — and say where you
     looked, since it is off the path you have been discussing.
3. **Read `content` on each candidate** — the university's own course page.
   Duration, structure, fees, entry requirements are all in there.
4. **Tell them what the pages say, attributed and linked.** Name the
   institution, give the details as *the university's*, paste the `url`
   exactly as returned.
5. **Say plainly these are not verified.** Not as a disclaimer buried at the
   end — as part of what they are: "these aren't ones we've checked yet".
6. **Point at the verification follow-up.** The tool filed it; tell them a
   counsellor is looking at these. That is a real row someone works, not a
   politeness.
7. **`append_note`** if the gap itself is worth remembering — that they want a
   field the catalogue does not cover is useful context for a counsellor.

## Decision branches

- **Catalogue has entries the student can actually act on** → use them.
  `build-shortlist`. Never reach for the web when the verified answer exists.
- **Catalogue has entries but only one (or none) meets their constraint** →
  this skill applies. Give them the verified option that does qualify FIRST —
  it is worth more than anything you find on the web — then search for more,
  and be explicit about which is which: "one verified option under your
  budget, plus these we haven't checked yet".
- **Student pushes back on a shortlist** ("no, under 40,000", "nothing in
  Melbourne") → that is a constraint, not a complaint. Re-query the catalogue
  with it. If the catalogue cannot meet it, say so and search.
- **Candidates found, `content` present** → summarise what each page says.
  This is the normal path and it should read like a helpful answer, not a
  hedge.
- **Candidates found, `content` empty** → the page would not load. Give the
  title and the url, say you could not read the page, do not guess what is on
  it.
- **Nothing found** (`count: 0`) → say so. Do NOT name universities from your
  own knowledge; that is the failure this whole tool exists to route around.
  If they named an institution you may retry once with different wording,
  then stop. Otherwise offer what the catalogue *does* have.
- **Student names a university you cannot find** → say plainly that you could
  not find its pages, rather than substituting other universities. Handing
  back UCL when they asked about Kingston looks like an answer and is not one.
- **Results came back but none are from the institution they asked about** →
  say that. "I couldn't find Kingston's pages; here are others in London"
  is honest. Presenting them as though they answer the question is not.
- **Student asks "so which of these should I apply to?"** → you cannot rank
  them and you should say why: nobody has checked them yet, so any ordering
  you gave would be invented. A counsellor will advise once verified.
- **Student asks you to check their eligibility for one** → you cannot. There
  are no requirement rows. Say a counsellor will assess it once the programme
  is verified, and offer `check_requirements` against catalogue programmes in
  the meantime.
- **Student wants one added to their shortlist** → shortlists come only from
  the catalogue. Explain that it has to be verified first, and that the check
  is already filed.

## Anti-patterns

- ❌ Naming a university from memory when the search returns nothing. Your
  training data is stale, and a student may apply somewhere on your say-so.
- ❌ Stating a fee or deadline as fact. "The fee is AUD 48,000" is a claim this
  consultancy has not checked. "Melbourne's page lists AUD 48,000: `<url>`" is
  what the page says, and who says it.
- ❌ Any figure without its `url` in the same reply. The harness checks this.
- ❌ Running `check_requirements` on a candidate. There is nothing to check
  against and the call will not mean what it appears to mean.
- ❌ Putting a candidate in a shortlist, or presenting a mixed list where
  verified and unverified sit side by side at equal weight.
- ❌ Ranking, scoring, or saying one "looks like a strong fit". Nobody has
  checked it. A fit judgement here is invented by definition.
- ❌ Lifting a requirement away from its condition — "needs a 4-year degree"
  when the page says "4-year degree, or 3-year plus relevant work
  experience". Same rule as `handle-visa-question`.
- ❌ Skipping the "not verified yet" line because the answer already reads
  well. That line is the difference between help and a false certification.
- ❌ Reaching for this tool because a shortlist looked *short*. Three verified
  programmes the student can act on beat six unchecked ones. "Thin" is not a
  trigger; "cannot meet the constraint they gave" is.
- ❌ Telling a student three of four options are over budget and stopping
  there. That is reporting a failure, not answering. Once you have written
  that sentence, the catalogue has not served them — give them the one that
  qualifies and go look for more.
- ❌ Filtering in prose what you could have filtered in the query. If they
  gave a budget, `search_programmes` takes `max_tuition`. Use it, then talk
  about what came back.

## Communication

- Lead with what you found, not with the caveat. "There are a few in Australia
  — none of them ones we've verified yet, but here's what their pages say."
- One line per candidate: institution, course name, the one or two details
  that actually matter to them, and the link.
- Say "we haven't verified these yet" in plain words. Never "unverified tier",
  never "outside the catalogue" — that is our vocabulary, not theirs.
- Close with what happens next: a counsellor is checking them. Do not promise
  when.
- Never narrate the search, the allowlist, or how many results were dropped.

## Where authority comes from

- `search_programmes` / `get_programme` — the verified catalogue, and always
  the first thing you try. Facts from here need no attribution.
- `find_unverified_programmes` — university and official study-portal pages
  only, host-filtered before you see them. Everything from here is the
  publisher's claim, not ours, and carries their `url`.
- `check_requirements` — catalogue programmes only. There is no equivalent for
  candidates and you must not improvise one.
- The `catalogue_verification` follow-up — the only route by which a candidate
  becomes something this agent can properly recommend.

## When this skill doesn't fit

- **The catalogue has matches** → `build-shortlist`.
- **Facts are missing** → `qualify-lead` first; you cannot search for a field
  and country nobody has stated.
- **The question is about visas or immigration** → `handle-visa-question`.
  Different allowlist, different rules, and it escalates.
- **A catalogue programme came back `indeterminate`** → `handle-indeterminate`.
  That is a verified programme with an open question, not a missing one.
