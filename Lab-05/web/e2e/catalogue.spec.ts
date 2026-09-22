/** The programme catalogue table, against a mocked `GET /api/programmes`.
 *
 * The table used to hold the whole fixture in memory and filter it in the
 * browser. It now sends the query to the server and renders a page, so what
 * is worth asserting has changed: not only what appears, but that the FILTER
 * REACHED THE SERVER. A screen that narrows fifteen rows locally looks
 * identical to one that asks properly, right up until the catalogue has
 * fifteen thousand.
 */
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";

import {
  mockProgrammeActions,
  mockProgrammes,
  mockProgrammesFailure,
  programme,
} from "./support/catalogue";
import { mockMe, stubEverythingElse } from "./support/roster";

/** Fifteen rows, so paging at ten has a second page. */
function catalogue() {
  return [
    programme({ name: "Master of Cybersecurity", country: "AU",
                institution: "Swan River University", currency: "AUD",
                tuition_per_year_minor: 4120000 }),
    programme({ name: "MSc Data Science" }),
    ...Array.from({ length: 13 }, (_, i) =>
      programme({ name: `MSc Filler ${i + 1}` }),
    ),
  ];
}

test.beforeEach(async ({ page }) => {
  await setupClerkTestingToken({ page });
  await stubEverythingElse(page);
  await mockMe(page);
});

async function open(page: import("@playwright/test").Page) {
  await page.goto("/catalogue");
  await page.getByRole("heading", { name: "Programme catalogue" }).waitFor();
}

test("the tiles count the whole catalogue, not the page on screen", async ({
  page,
}) => {
  // Counted by the server. Read off the rows in the table they would say ten,
  // and a tile that changed as you paged would be answering a different
  // question from the one its label asks.
  await mockProgrammes(page, catalogue());
  await open(page);

  await expect(page.getByText("Total programmes")).toBeVisible();
  await expect(page.getByText("15", { exact: true })).toBeVisible();
  await expect(page.getByText("Institutions")).toBeVisible();
  await expect(page.getByText("Needs verification")).toBeVisible();
});

test("paging asks the server for the next page", async ({ page }) => {
  const requests = await mockProgrammes(page, catalogue());
  await open(page);

  await expect(page.getByText("Showing 1–10 of 15 programmes")).toBeVisible();
  await page.getByRole("button", { name: "Page 2" }).click();
  await expect(page.getByText("Showing 11–15 of 15 programmes")).toBeVisible();

  // The assertion that matters: an offset went out. Slicing in the browser
  // would produce the same sentence.
  expect(requests.some((q) => q.get("offset") === "10")).toBe(true);
});

test("searching is sent to the server, not applied in the browser", async ({
  page,
}) => {
  const requests = await mockProgrammes(page, catalogue());
  await open(page);

  await page.getByLabel("Search programmes").fill("cybersecurity");
  await expect(page.getByText("Master of Cybersecurity")).toBeVisible();
  await expect(page.getByText("MSc Data Science")).toHaveCount(0);
  expect(requests.some((q) => q.get("search") === "cybersecurity")).toBe(true);
});

test("typing does not fire a request per keystroke", async ({ page }) => {
  // Debounced. Without it every letter is a round trip and the answers can
  // arrive out of order, so the table settles on whichever was slowest.
  const requests = await mockProgrammes(page, catalogue());
  await open(page);

  const before = requests.length;
  await page.getByLabel("Search programmes").pressSequentially("cyber", {
    delay: 30,
  });
  await expect(page.getByText("Master of Cybersecurity")).toBeVisible();
  expect(requests.length - before).toBeLessThan(5);
});

test("the country filter offers the whole catalogue's destinations", async ({
  page,
}) => {
  // Built from the rows on screen this could not offer Australia at all: the
  // only Australian programme is on page two.
  await mockProgrammes(page, catalogue());
  await open(page);

  await page.getByLabel("Filter by country").click();
  await expect(page.getByRole("option", { name: /Australia/ })).toBeVisible();
});

test("a filter that empties the table explains itself", async ({ page }) => {
  await mockProgrammes(page, catalogue());
  await open(page);

  await page.getByLabel("Search programmes").fill("nothing matches this");
  await expect(page.getByText("No programmes match these filters.")).toBeVisible();
});

test("a broken read fails loudly rather than reading as an empty catalogue", async ({
  page,
}) => {
  // CLAUDE.md: prefer failing loudly over degrading gracefully. "No programmes
  // yet" is a different claim from "we could not ask", and the first one sends
  // somebody off to add programmes that already exist.
  await mockProgrammesFailure(page, 500);
  await open(page);

  await expect(page.getByText(/Something went wrong on our end/)).toBeVisible();
  await expect(page.getByText("No programmes yet.")).toHaveCount(0);
});

test("the level slug is rendered as a readable label", async ({ page }) => {
  await mockProgrammes(page, [programme({ name: "MSc Data Science" })]);
  await open(page);

  await expect(page.getByText("Master's degree").first()).toBeVisible();
});

test("a country is shown by name, not by code", async ({ page }) => {
  // Nobody reads "GB" and thinks United Kingdom on the first pass, and a
  // catalogue is read far more often than it is edited.
  await mockProgrammes(page, [programme({ country: "LK" })]);
  await open(page);

  await expect(page.getByText("Sri Lanka")).toBeVisible();
});

test("a fee in a currency with no minor unit is not divided by a hundred", async ({
  page,
}) => {
  // ¥1,200,000 stored correctly and divided by 100 on the way to the screen
  // reads as ¥12,000 — wrong by two orders of magnitude, and wrong in the
  // direction a student would happily believe.
  await mockProgrammes(page, [
    programme({ currency: "JPY", tuition_per_year_minor: 1200000 }),
  ]);
  await open(page);

  await expect(page.getByText(/1,200,000/)).toBeVisible();
});

test("a programme with no open intake says so instead of showing a past date", async ({
  page,
}) => {
  await mockProgrammes(page, [
    programme({ next_intake: null, next_deadline: null }),
  ]);
  await open(page);

  await expect(page.getByText("No open intake")).toBeVisible();
});

test("a stale entry is marked, not just quietly old", async ({ page }) => {
  await mockProgrammes(page, [
    programme({
      name: "MSc Ageing Entry",
      verified_at: new Date(Date.now() - 60 * 86_400_000).toISOString(),
    }),
  ]);
  await open(page);

  await expect(page.getByText("Needs check")).toBeVisible();
});

test("a programme edited since it was verified says so", async ({ page }) => {
  // The row stays live — clearing the stamp would have taken it away from
  // students — so this line is how the table admits a figure moved after the
  // last check.
  await mockProgrammes(page, [
    programme({ name: "MSc Changed", edited_since_verified: true }),
  ]);
  await open(page);

  await expect(page.getByText("edited since")).toBeVisible();
});

test("a draft has never been verified, and does not pretend otherwise", async ({
  page,
}) => {
  await mockProgrammes(page, [
    programme({ name: "MSc Draft", status: "draft", verified_at: null }),
  ]);
  await open(page);

  await expect(page.getByText("Never")).toBeVisible();
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();
});

test("archived programmes are hidden, but can be asked for", async ({ page }) => {
  // Hidden is not gone. Without a way to look, an archived programme is one
  // nobody can ever restore.
  await mockProgrammes(page, [
    programme({ name: "MSc Live" }),
    programme({ name: "MSc Withdrawn", status: "archived" }),
  ]);
  await open(page);

  await expect(page.getByText("MSc Withdrawn")).toHaveCount(0);
  await page.getByLabel("Filter by status").click();
  await page.getByRole("option", { name: "Archived" }).click();
  await expect(page.getByText("MSc Withdrawn")).toBeVisible();
});

test("archiving says plainly that nothing is deleted", async ({ page }) => {
  // The button used to say Delete. Somebody who believes the row is gone will
  // not go looking for it.
  await mockProgrammes(page, [programme({ name: "MSc Data Science" })]);
  await open(page);

  await page.getByRole("button", { name: /Actions for MSc Data Science/ }).click();
  await page.getByRole("menuitem", { name: "Archive" }).click();

  await expect(page.getByText(/Nothing is deleted/)).toBeVisible();
  await expect(page.getByText(/Past shortlists name this programme/)).toBeVisible();
});

test("archiving posts to the endpoint", async ({ page }) => {
  await mockProgrammes(page, [programme({ name: "MSc Data Science" })]);
  const calls = await mockProgrammeActions(page, () =>
    programme({ status: "archived" }),
  );
  await open(page);

  await page.getByRole("button", { name: /Actions for MSc Data Science/ }).click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();

  await expect.poll(() => calls.map((c) => c.action)).toContain("archive");
});

test("a duplicate is made by the server and opened", async ({ page }) => {
  // The copy starts unverified, and the server decides that rather than the
  // client asking for it.
  const copy = programme({ name: "MSc Data Science (copy)", status: "draft" });
  await mockProgrammes(page, [programme({ name: "MSc Data Science" })]);
  const calls = await mockProgrammeActions(page, () => copy);
  await open(page);

  await page.getByRole("button", { name: /Actions for MSc Data Science/ }).click();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();

  await expect.poll(() => calls.map((c) => c.action)).toContain("duplicate");
  await expect(page).toHaveURL(new RegExp(`/catalogue/${copy.id}$`));
});

test("the row menu closes on Escape", async ({ page }) => {
  await mockProgrammes(page, [programme({ name: "MSc Data Science" })]);
  await open(page);

  await page.getByRole("button", { name: /Actions for MSc Data Science/ }).click();
  await expect(page.getByRole("menuitem", { name: "Edit" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: "Edit" })).toHaveCount(0);
});
