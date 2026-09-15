/** Narrowing the roster, and editing who owns what.
 *
 * The search box, the chips and the sort are client-side passes over one
 * already-fetched list, so what is worth asserting is not that a request went
 * out — none does — but that the population each control acts on is the right
 * one. The chip counts in particular are taken BEFORE the search, and that is
 * a deliberate choice rather than an accident of ordering.
 */
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";

import {
  mockMe,
  mockRoster,
  mockSetCountries,
  stubEverythingElse,
  user,
} from "./support/roster";
import { mockAvailability } from "./support/availability";

test.beforeEach(async ({ page }) => {
  await setupClerkTestingToken({ page });
  await stubEverythingElse(page);
  await mockMe(page);
  await mockAvailability(page, []);
});

const ROSTER = [
  user({ name: "Anita Silva", email: "anita@agency.test", countries: ["LK"] }),
  user({ name: "Priya Fernando", email: "priya@agency.test", countries: [] }),
  user({ name: null, email: "newjoiner@agency.test", status: "invited" }),
];

test("the chips count the whole roster, and each one narrows it", async ({
  page,
}) => {
  await mockRoster(page, ROSTER);
  await page.goto("/counsellors");

  await expect(page.getByRole("button", { name: "All (3)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Active (2)" })).toBeVisible();
  // Owning no country: Priya, and the person who has not accepted yet.
  await expect(
    page.getByRole("button", { name: "Unassigned (2)" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Active (2)" }).click();
  await expect(page.getByRole("button", { name: /Anita Silva/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /newjoiner@agency.test/ }),
  ).toHaveCount(0);
});

test("searching finds people by name, email and country code", async ({
  page,
}) => {
  await mockRoster(page, ROSTER);
  await page.goto("/counsellors");

  const box = page.getByLabel("Search counsellors");

  await box.fill("anita");
  await expect(page.getByRole("button", { name: /Anita Silva/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Priya Fernando/ }),
  ).toHaveCount(0);

  // An invited person has no name, so the address is the only thing to type.
  await box.fill("newjoiner");
  await expect(
    page.getByRole("button", { name: /newjoiner@agency.test/ }),
  ).toBeVisible();

  // Country codes are how this screen is read.
  await box.fill("LK");
  await expect(page.getByRole("button", { name: /Anita Silva/ })).toBeVisible();
});

test("a search that matches nobody says so, and does not empty the counts", async ({
  page,
}) => {
  await mockRoster(page, ROSTER);
  await page.goto("/counsellors");

  await page.getByLabel("Search counsellors").fill("zzzz");

  await expect(page.getByText(/Nobody matches/)).toBeVisible();
  // The chips count the roster, not the search. A chip that reads "Active (0)"
  // because of something typed in an unrelated box reads as people vanishing.
  await expect(page.getByRole("button", { name: "Active (2)" })).toBeVisible();
});

test("adding a country sends the WHOLE set, not just the new one", async ({
  page,
}) => {
  // The endpoint replaces rather than merges, so a screen that posts only the
  // addition deletes everything else the person owned.
  const anita = ROSTER[0];
  await mockRoster(page, [anita]);
  const sent = await mockSetCountries(page, (countries) => ({
    ...anita,
    countries,
  }));

  await page.goto("/counsellors");
  await page.getByRole("button", { name: "Add country" }).click();
  await page.getByLabel("Country to add").click();
  await page.getByRole("option", { name: /Australia/ }).click();

  await expect.poll(() => sent).toEqual([["LK", "AU"]]);
});

test("removing a country sends what is left", async ({ page }) => {
  const anita = user({
    name: "Anita Silva",
    email: "anita@agency.test",
    countries: ["LK", "AU"],
  });
  await mockRoster(page, [anita]);
  const sent = await mockSetCountries(page, (countries) => ({
    ...anita,
    countries,
  }));

  await page.goto("/counsellors");
  await page.getByRole("button", { name: "Remove Australia" }).click();

  await expect.poll(() => sent).toEqual([["LK"]]);
});

test("someone without users.countries.manage gets no country controls", async ({
  page,
}) => {
  // Ownership is a routing decision for the agency, not a personal setting.
  // Hiding the control is UX; the endpoint is what actually refuses.
  await mockMe(page, { role: "counsellor", permissions: ["users.edit"] });
  await mockRoster(page, [ROSTER[0]]);

  await page.goto("/counsellors");

  await expect(page.getByRole("button", { name: "Add country" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);
});
