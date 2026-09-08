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
  await expect(
    page.getByText(/No countries\. Leads for a destination nobody owns/),
  ).toBeVisible();
});

test("a person's own timezone is shown, not the viewer's", async ({ page }) => {
  // Availability is wall clock read against this, so it is a working fact.
  await mockRoster(page, [
    user({ name: "Priya Fernando", timezone: "Europe/London" }),
  ]);

  await page.goto("/counsellors");

  await expect(page.getByText("Europe/London")).toBeVisible();
});
