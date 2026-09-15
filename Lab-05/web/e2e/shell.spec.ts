/** The app shell: the rail, the top bar and the search in it.
 *
 * Two things here are easy to break and invisible when broken. The rail must
 * only offer routes that exist — a link to a screen nobody built navigates to
 * the catch-all and silently lands the user on the widget. And the search's
 * three reads are gated behind first focus; ungated they would fetch the
 * roster, the catalogue and the lead book on every route in the app to fill a
 * dropdown most visits never open.
 */
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";

import {
  lead,
  mockLeads,
  mockMe,
  mockRoster,
  stubEverythingElse,
  user,
} from "./support/roster";
import { mockAvailability } from "./support/availability";

const anita = user({ name: "Anita Silva", countries: ["LK"] });

test.beforeEach(async ({ page }) => {
  await setupClerkTestingToken({ page });
  await stubEverythingElse(page);
  await mockMe(page);
  await mockAvailability(page, []);
});

test("the rail marks the surface you are on", async ({ page }) => {
  await mockRoster(page, [anita]);
  await page.goto("/counsellors");

  const nav = page.getByRole("navigation", { name: "Northbound surfaces" });
  await expect(nav.getByRole("link", { name: "Counsellors" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(nav.getByRole("link", { name: "Catalogue" })).not.toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("every rail link goes to a route that exists", async ({ page }) => {
  // The catch-all redirects unknown paths to /widget, so a link to a screen
  // nobody built does not 404 — it quietly dumps you on the student widget.
  // That is exactly the failure this asserts away.
  await mockRoster(page, [anita]);
  await page.goto("/counsellors");

  const nav = page.getByRole("navigation", { name: "Northbound surfaces" });
  // Locator.getAttribute rather than evaluateAll: the e2e tsconfig has no DOM
  // lib, so a browser-side callback would have to be typed `any` to compile.
  const links = await nav.getByRole("link").all();
  const hrefs = await Promise.all(links.map((l) => l.getAttribute("href")));

  expect(hrefs).toEqual([
    "/leads",
    "/counsellors",
    "/widget",
    "/assistant",
    "/catalogue",
    "/setup",
  ]);
});

test("the student widget gets no console chrome", async ({ page }) => {
  // It renders on the agency's own website, where the visitor is a
  // prospective student. Showing them the agency's navigation would be a
  // straightforward leak.
  await page.goto("/widget");

  await expect(page.getByLabel("Search the console")).toHaveCount(0);
});

test("search reaches counsellors, programmes and leads, and opens them", async ({
  page,
}) => {
  await mockRoster(page, [anita]);
  await mockLeads(page, [
    lead({ name: "Ravi Menon", assigned_counsellor_id: anita.id }),
  ]);
  await page.goto("/catalogue");

  const box = page.getByLabel("Search the console");

  await box.fill("Anita");
  await expect(page.getByRole("option", { name: /Anita Silva/ })).toBeVisible();

  await box.fill("Ravi");
  await expect(page.getByRole("option", { name: /Ravi Menon/ })).toBeVisible();

  // The catalogue is fixture-backed, so this name is real seed data.
  await box.fill("Cybersecurity");
  const programme = page.getByRole("option", { name: /Master of Cybersecurity/ });
  await expect(programme).toBeVisible();

  await programme.click();
  await expect(page).toHaveURL(/\/catalogue\/.+/);
});

test("search says so when nothing matches", async ({ page }) => {
  await mockRoster(page, [anita]);
  await mockLeads(page, []);
  await page.goto("/catalogue");

  await page.getByLabel("Search the console").fill("zzzzzz");

  await expect(page.getByText(/Nothing matches/)).toBeVisible();
});

test("search fetches NOTHING until the box is focused", async ({ page }) => {
  // Mounted in the shell, these three reads run on every route in the app.
  // The gate is what keeps opening the catalogue from also pulling the whole
  // roster and the whole lead book.
  const calls = await mockRoster(page, [anita]);
  await mockLeads(page, []);

  await page.goto("/catalogue");
  await expect(page.getByRole("heading", { name: "Catalogue" })).toBeVisible();
  expect(calls.count).toBe(0);

  await page.getByLabel("Search the console").focus();
  await expect.poll(() => calls.count).toBe(1);
});
