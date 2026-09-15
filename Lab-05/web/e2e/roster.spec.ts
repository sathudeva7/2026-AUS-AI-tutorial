/** The counsellor roster, against a mocked `GET /api/users`.
 *
 * Mocked rather than live, because the states worth testing are the awkward
 * ones: a dead backend, an agency with nobody in it, a person who has not
 * accepted their invitation yet. Arranging those against a real database means
 * seeding and resetting rows for every case, and the thing under test — what
 * this screen renders for a given answer — never depended on the database
 * being the one to give the answer.
 *
 * The auth session is real. It is signed in once in auth.setup.ts and reused.
 */
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";

import {
  mockRoster,
  mockRosterFailure,
  stubEverythingElse,
  user,
} from "./support/roster";

test.beforeEach(async ({ page }) => {
  // Per test, not just once in global setup. The saved session cookies are
  // restored from disk, but Clerk still bot-checks the request that exchanges
  // them for a live session — and a driven browser is exactly what that check
  // is built to stop. Without this the app renders the sign-in screen and
  // every assertion fails somewhere far from the cause.
  await setupClerkTestingToken({ page });
  await stubEverythingElse(page);
});

test("shows the people the API returns", async ({ page }) => {
  await mockRoster(page, [
    user({ name: "Priya Fernando", role: "owner", countries: ["GB", "AU"] }),
    user({ name: "Anita Silva", role: "manager", countries: ["LK"] }),
  ]);

  await page.goto("/counsellors");

  await expect(
    page.getByRole("button", { name: /Priya Fernando/ }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Anita Silva/ })).toBeVisible();
});

test("draws the whole list in ONE request", async ({ page }) => {
  // The screen this replaces fetched the list, then a profile per person. That
  // was free against fixtures and would have been 41 requests for a 40-person
  // agency the moment it went live. This is the assertion that keeps it gone.
  const calls = await mockRoster(
    page,
    Array.from({ length: 12 }, (_, i) => user({ name: `Person ${i}` })),
  );

  await page.goto("/counsellors");
  await expect(page.getByRole("button", { name: /Person 0/ })).toBeVisible();

  expect(calls.count).toBe(1);
});

test("says it is loading before the roster arrives", async ({ page }) => {
  await mockRoster(page, [user({ name: "Priya Fernando" })], { delayMs: 1500 });

  await page.goto("/counsellors");

  await expect(page.getByText("Reading the roster…")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Priya Fernando/ }),
  ).toBeVisible();
});

test("an empty agency says so, rather than showing an empty list", async ({
  page,
}) => {
  await mockRoster(page, []);

  await page.goto("/counsellors");

  await expect(page.getByText(/Nobody on the roster yet/)).toBeVisible();
});

test("a broken backend fails loudly", async ({ page }) => {
  // CLAUDE.md: prefer failing loudly over degrading gracefully. An empty list
  // here would read as "this agency has no counsellors", which is a different
  // claim and a much worse one.
  await mockRosterFailure(page, 500);

  await page.goto("/counsellors");

  await expect(page.getByText(/Nobody on the roster yet/)).toHaveCount(0);
  await expect(page.getByText(/Something went wrong on our end/)).toBeVisible();
});

test("an invited person is labelled, and shows their email", async ({
  page,
}) => {
  // They have no name until they accept — the invite knew only an address.
  // Showing a dash would throw away the one identifying thing there is.
  await mockRoster(page, [
    user({ name: null, email: "newjoiner@agency.test", status: "invited" }),
  ]);

  await page.goto("/counsellors");

  await expect(
    page.getByRole("button", { name: "newjoiner@agency.test, Invited" }),
  ).toBeVisible();
});

test("the count separates active people from the total", async ({ page }) => {
  await mockRoster(page, [
    user({ name: "Priya Fernando", status: "active" }),
    user({ name: "Anita Silva", status: "active" }),
    user({ name: null, status: "invited" }),
  ]);

  await page.goto("/counsellors");

  await expect(page.getByText(/2 active of 3/)).toBeVisible();
});

test("selecting someone opens their card", async ({ page }) => {
  await mockRoster(page, [
    user({ name: "Priya Fernando", countries: ["GB", "AU"] }),
    user({
      name: "Anita Silva",
      email: "anita@agency.test",
      work_phone: "+94771234567",
      timezone: "Asia/Colombo",
      countries: ["LK"],
    }),
  ]);

  await page.goto("/counsellors");
  await page.getByRole("button", { name: /Anita Silva/ }).click();

  await expect(
    page.getByRole("heading", { name: "Anita Silva" }),
  ).toBeVisible();
  await expect(page.getByText("anita@agency.test")).toBeVisible();
  await expect(page.getByText("+94771234567")).toBeVisible();
});

test("someone owning no countries is told what that means", async ({
  page,
}) => {
  // Not an error state to tidy away: it is how the unassigned queue fills.
  await mockRoster(page, [user({ name: "Priya Fernando", countries: [] })]);

  await page.goto("/counsellors");

  // Specific to the detail card: "unassigned queue" also appears in the banner
  // about destinations nobody owns, and a locator matching both is ambiguous.
  // The empty state is a titled box now rather than one sentence, so the
  // heading and the consequence are asserted separately — the consequence is
  // the half that matters and the half that is easy to lose in a redesign.
  await expect(page.getByText("No countries assigned")).toBeVisible();
  await expect(
    page.getByText(/Leads for a destination nobody owns join the unassigned/),
  ).toBeVisible();
});

test("countries read as names, not as codes", async ({ page }) => {
  // The code is what the column stores and what the write sends; nobody reads
  // "LK" and thinks Sri Lanka on the first pass, and a roster is read far more
  // often than it is edited.
  await mockRoster(page, [
    user({ name: "Anita Silva", countries: ["LK", "AU"] }),
  ]);

  await page.goto("/counsellors");

  await expect(page.getByText("Covers Sri Lanka, Australia.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Anita Silva/ }),
  ).toContainText("Sri Lanka, Australia");
});

test("owning GB covers the catalogue's \"UK\"", async ({ page }) => {
  // The catalogue writes "UK"; users own ISO codes, where Britain is GB. That
  // is two letters, so a `/^[A-Za-z]{2}$/` shortcut used to return it
  // unchanged and skip the alias written for it — leaving the banner
  // reporting Britain as unowned however many people owned GB. The alarm this
  // screen exists to raise, stuck permanently on.
  await mockRoster(page, [user({ name: "Anita Silva", countries: ["GB"] })]);

  await page.goto("/counsellors");

  // Wait for the banner to actually render before asserting what is NOT in
  // it. The catalogue read is async, and a toHaveCount(0) that runs first
  // passes against an empty page — which is how this test passed against the
  // bug it was written for.
  const banner = page.getByText(/countries have no owner/);
  await expect(banner).toBeVisible();

  // The seed catalogue covers the UK, Australia, Canada and Germany. Owning
  // GB must leave three gaps, not four.
  await expect(page.getByText("3 countries have no owner")).toBeVisible();
  await expect(page.getByText(/^UK$/)).toHaveCount(0);
});

test("a person's own timezone is shown, not the viewer's", async ({ page }) => {
  // Availability is wall clock read against this, so it is a working fact.
  await mockRoster(page, [
    user({ name: "Priya Fernando", timezone: "Europe/London" }),
  ]);

  await page.goto("/counsellors");

  await expect(page.getByText("Europe/London")).toBeVisible();
});

test("a link straight to one person opens them", async ({ page }) => {
  // The roster used to reach this by redirecting to /counsellors/{first id} in
  // an effect on load, and nothing tested it — so replacing the redirect with
  // a plain fallback could have broken deep links silently.
  const people = [
    user({ name: "Priya Fernando" }),
    user({ name: "Anita Silva", email: "anita@agency.test" }),
  ];
  await mockRoster(page, people);

  await page.goto(`/counsellors/${people[1].id}`);

  await expect(page.getByRole("heading", { name: "Anita Silva" })).toBeVisible();
});

test("opening the roster shows the first person, and the URL stays clean", async ({
  page,
}) => {
  await mockRoster(page, [
    user({ name: "Priya Fernando" }),
    user({ name: "Anita Silva" }),
  ]);

  await page.goto("/counsellors");

  await expect(page.getByRole("heading", { name: "Priya Fernando" })).toBeVisible();
  // No redirect: the old effect rewrote history on load, which put an id in
  // the bar nobody had chosen and made Back behave oddly.
  await expect(page).toHaveURL(/\/counsellors$/);
});

test("choosing someone puts them in the URL, so a refresh keeps them", async ({
  page,
}) => {
  await mockRoster(page, [
    user({ name: "Priya Fernando" }),
    user({ name: "Anita Silva" }),
  ]);

  await page.goto("/counsellors");
  await page.getByRole("button", { name: /Anita Silva/ }).click();

  await expect(page).toHaveURL(/\/counsellors\/[0-9a-f-]+$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Anita Silva" })).toBeVisible();
});
