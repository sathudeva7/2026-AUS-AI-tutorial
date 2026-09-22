# Playwright tests for a slice

Two things must be satisfied before any console screen renders: Clerk must say
the viewer is signed in with an active organization, and the API must answer.
`playwright.config.ts` solves the first once for the whole run. **The second
is each test's job** — which is what makes states like "the backend is down"
or "an agency with 200 people" testable at all.

```bash
cd web && npx playwright test                    # everything
npx playwright test e2e/catalogue.spec.ts        # one file
npx playwright test --ui                         # watch it happen
```

Vite is started by Playwright, and an already-running dev server is reused, so
a local run does not fight the one you have open.

## The three projects

They run in order, and the dependency chain matters:

1. **`setup clerk`** — `clerkSetup()` fetches a Clerk Testing Token. Without
   it, Clerk's bot detection refuses the run and every test fails at the
   sign-in screen for reasons that have nothing to do with your code.
2. **`sign in`** — signs in once and writes the session to `e2e/.auth/user.json`.
   Needs `E2E_CLERK_USER_USERNAME` in `web/.env.test` and `CLERK_SECRET_KEY`
   from `Lab-05/.env`. The user must belong to an organization, or the console
   redirects to `/create-agency` and no test reaches the screen.
3. **`chromium`** — the tests, with that stored session.

## Every test starts the same way

```ts
test.beforeEach(async ({ page }) => {
  await setupClerkTestingToken({ page });
  await stubEverythingElse(page);
  await mockMe(page);
});
```

- `setupClerkTestingToken` — per page, on top of the per-run `clerkSetup()`
- `stubEverythingElse` — the catch-all, so an unmocked call does not hit a
  real backend
- `mockMe` — `/api/me`, which every screen reads for role and permissions.
  Pass `{ permissions: [...] }` to test what a lower role sees.

## Route order is REVERSE

Playwright tries the **most recently registered** route first. So the
catch-all goes on early and your specific mock goes on after it:

```ts
await stubEverythingElse(page);   // first
await mockProgrammes(page, rows); // wins
```

Getting this backwards is a mock that never fires, and the symptom is a test
failing against a screen that looks correct.

## Mock bodies are envelopes

The client unwraps `{success, data, meta, request_id}` before any component
sees it. A bare array fails to parse and surfaces as a failure card.

```ts
body: JSON.stringify({ success: true, data: rows, request_id: "req_test" })
```

A failure is the other shape:

```ts
body: JSON.stringify({
  success: false,
  error: { code: "INTERNAL_ERROR", message: "Something went wrong on our end." },
  request_id: "req_test",
})
```

## Make the mock do the work

A stub that returns every row regardless of the query string will make
"Showing 11–15 of 15" pass against a screen that never sent an offset. If the
server does the paging and filtering, **the mock must page and filter too** —
see `mockProgrammes` in `e2e/support/catalogue.ts`, which reads the query
string and slices accordingly, and returns the captured `URLSearchParams` so a
test can assert the filter actually reached the server.

That assertion is the point of these tests: a screen that narrows fifteen rows
in the browser looks identical to one that asks properly, right up until the
catalogue has fifteen thousand.

## One path, several methods

A URL pattern catches every verb. When `GET /api/programmes/{id}` and
`PATCH /api/programmes/{id}` need different handlers, hand the others back:

```ts
await page.route(
  (url) => /\/api\/programmes\/[^/?]+$/.test(url.pathname),
  async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ /* ... */ });
  },
);
```

Without `route.fallback()` the first matching route swallows the write and
the test hangs or asserts against nothing.

## Capture writes, assert on the body

For anything that saves, record what was sent and assert on it — including
what was **not** sent:

```ts
expect(writes[0].body).toEqual({ name: "…", tuition_per_year: "26000", currency: "GBP" });
```

`toEqual`, not `toMatchObject`: the absence of the untouched fields is the
assertion. A form that posts all nine every time turns every save into a full
overwrite, and `toMatchObject` would pass anyway.

## What to cover

- The path a person actually takes, end to end
- A failure — the surface says so rather than rendering empty
- Permissions, if the screen hides anything: `mockMe({ permissions: [...] })`
- The formatting rules that have bitten before: a currency with no minor
  unit, a country shown by name but sent as a code, a stale verification date
