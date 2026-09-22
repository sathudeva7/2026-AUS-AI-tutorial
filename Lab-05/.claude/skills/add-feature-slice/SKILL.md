---
name: add-feature-slice
description: Load before putting a Lab-05 endpoint on screen — the features/<x>/ file split, the HTTP client and error classes, TanStack Query keys and invalidation, forms seeded from server data, and the Playwright tests that go with it. Frontend only; the endpoint itself is add-api-endpoint.
metadata:
  version: "1.0.0"
  scope: Lab-05 frontend (web/)
  related-skills: add-api-endpoint
---

# add-feature-slice

The frontend half of a Northbound slice: `features/<x>/` → a route → an e2e
test.

Like its backend twin, this is a **sequence and a set of pointers**. Read
`features/users/` alongside it — that is the reference slice, and it is the
copy that cannot drift from the code.

## When to use this skill

- Putting an existing endpoint on screen for the first time
- Changing what a screen reads or writes
- Moving a surface off fixture data onto the API

**Not** for: the endpoint itself (`add-api-endpoint`), pure visual work with
no data change, or the student widget's SSE stream, which is not an envelope
and does not go through the query client.

## Before you start

- **Does the endpoint exist and work?** Curl it, or check `api/<x>.py`. If it
  does not, stop — `add-api-endpoint` first. Building a form against an
  endpoint you are about to write is a rewrite.
- **Is this screen already reading a fixture?** Then the job is a REPLACEMENT,
  not an addition. Find every reader of that fixture before you start; the
  catalogue bug was exactly a half-done one of these — see
  `references/worked-example.md`.

## The file map

```
web/src/features/<x>/
  api.ts       one function per endpoint · no caching, no retry
  queries.ts   the hooks · staleTime · what to invalidate after a write
  keys.ts      the key factory
  types.ts     the wire shape, as the server sends it
  display.ts   a row → what the screen shows (labels, status, initials)
```

Routes live in `web/src/routes/`, not in the feature folder.

Nothing here calls `fetch`. Transport is `web/src/api/client.ts`, which owns
auth, the envelope and the verbs — `get`, `post`, `put`, `patch`, and the
`*WithMeta` pair for endpoints whose `meta` is part of the answer.

## References

Load one when you reach it. Do not read them up front.

| Topic | Reference | Load when |
|---|---|---|
| Tests | `references/testing.md` | Writing a Playwright test — Clerk setup, mocking the API, route ordering |
| Worked example | `references/worked-example.md` | You want a whole slice end to end, including the bug this skill exists to prevent |

## High-level flow

1. **`types.ts`** — the shape the server actually sends, named for the wire.
   Do not reuse `data/types.ts`; those are the fixture and agent shapes, and
   one type stretched across both is half true everywhere.
2. **`api.ts`** — one thin function per endpoint. Build query strings from
   only the params that are set: an empty `search=` is a filter the server
   has to decide how to ignore.
3. **`keys.ts`** — a factory, so a key with the wrong params is a type error
   rather than a cache that silently never updates.
4. **`queries.ts`** — hooks. After a write, invalidate everything the write
   could have changed, **including screens the viewer is not looking at**.
   That is where stale-UI bugs come from.
5. **The route**, registered in `App.tsx`. Handle three states explicitly:
   pending, error, and data.
6. **`display.ts`** for anything the table and the editor both render, so the
   two cannot disagree about what "Active" means.
7. **An e2e test** — `references/testing.md`.

## Settled decisions

The two existing slices disagree. Follow these.

- **Feature-owned components go in `features/<x>/components/`**, as
  `features/users/` does. `features/catalogue/` puts its UI in `routes/`;
  that is the outlier. A component used by exactly one route may stay in that
  route file.
- **Import named functions** — `import { listProgrammes } from "./api"` — not
  `import * as api`. Both exist; the named form is what tree-shaking and
  go-to-definition want.
- **`placeholderData: keepPreviousData`**, imported from the library, rather
  than the hand-written `(previous) => previous`. Same behaviour, one
  spelling.
- **Never render an empty list on failure.** `FailureCard` from
  `components/ui/States.tsx`. An empty table reads as "no leads" — a false
  statement about the business — rather than "the backend is down".

## Common pitfalls

- **Syncing form state to props in an effect.** Seed the form from fetched
  data by giving the component a `key` and letting it remount. An effect that
  copies props into state edits the PREVIOUS record for one render, and
  ESLint's `react-hooks/set-state-in-effect` will flag it anyway.
- **Sending every field on a PATCH.** Diff against what was loaded and send
  only what moved. The endpoint is "the fields the client sent" precisely so
  two people editing one record do not clobber each other.
- **Ids from the wrong world.** The API speaks uuids; the fixtures and the
  agent speak `p_uk_001`. A lookup that crosses them fails silently and falls
  through to a blank form.
- **Formatting money by dividing by 100.** `formatMinorUnits` for display,
  `minorUnitsToInput` for an editable box. JPY has no minor unit; BHD has
  three.
- **Putting a country name in a request.** The server takes ISO alpha-2. Show
  the name, send the code.
- **A hex or a px value the tokens carry.** Colour, type, spacing and radius
  come from the Organic design system's CSS variables — `styles/organic.css`
  and the `console-*` classes in `styles/console.css`.
- **Rendering a timestamp in the tenant's timezone.** UTC in, **viewer's**
  zone out. `lib/format.ts` owns this.

## Done when

- [ ] Five files, each doing only its own job; no `fetch` outside `api/client.ts`
- [ ] Pending, error and data states all handled — failure is visible, not an empty list
- [ ] Writes invalidate every list they could have changed
- [ ] Money, countries and times go through `lib/format.ts`; no hardcoded hex or px
- [ ] An e2e test covers the path a person actually takes
- [ ] `npm run check` passes (`tsc`, `eslint`, `knip`)
- [ ] **No fixture reader left behind.** If this replaced fixture data,
      every other reader of that fixture is moved or deliberately left, and
      the dead exports are deleted.
