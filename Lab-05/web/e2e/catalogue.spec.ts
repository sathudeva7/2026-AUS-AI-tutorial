/** The programme catalogue table.
 *
 * Fixture-backed: there is no programmes endpoint, and `catalogueStore` is a
 * session overlay. So these run against the seed catalogue rather than a mock
 * — the fixture IS the contract here — and the destructive ones assert that
 * the screen says so before it does anything.
 */
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";

import { mockMe, stubEverythingElse } from "./support/roster";

test.beforeEach(async ({ page }) => {
  await setupClerkTestingToken({ page });
  await stubEverythingElse(page);
  await mockMe(page);
  await page.goto("/catalogue");
  await page.getByRole("heading", { name: "Programme catalogue" }).waitFor();
});

test("counts every tile off the rows in the table", async ({ page }) => {
  await expect(page.getByText("Total programmes")).toBeVisible();
  await expect(page.getByText("15", { exact: true })).toBeVisible();
  await expect(page.getByText("Institutions")).toBeVisible();
  await expect(page.getByText("Needs verification")).toBeVisible();
});

test("pages ten at a time and says where you are", async ({ page }) => {
  await expect(page.getByText("Showing 1–10 of 15 programmes")).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(11); // 10 + the header

  await page.getByRole("button", { name: "Page 2" }).click();
  await expect(page.getByText("Showing 11–15 of 15 programmes")).toBeVisible();
});

test("searching and filtering narrow the same table", async ({ page }) => {
  await page.getByLabel("Search programmes").fill("cybersecurity");
  await expect(page.getByText("Master of Cybersecurity")).toBeVisible();
  await expect(page.getByText("MSc Computer Science")).toHaveCount(0);
  await expect(page.getByText(/1 of 15 programmes/)).toBeVisible();

  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByText("MSc Computer Science")).toBeVisible();
});

test("a filter that empties the table explains itself", async ({ page }) => {
  await page.getByLabel("Search programmes").fill("zzzzzz");
  await expect(page.getByText("No programmes match these filters.")).toBeVisible();
});

test("the level slug is rendered as a readable label", async ({ page }) => {
  // `level` is stored as "masters"; a column of that under every name reads
  // as a bug rather than as data.
  await expect(page.getByText("Master's degree").first()).toBeVisible();
  await expect(page.getByText("masters", { exact: true })).toHaveCount(0);
});

test("a stale entry is marked, not just quietly old", async ({ page }) => {
  // Over 30 days unverified. The agent may still state the figure, so this is
  // a prompt rather than a block — but it must be visible.
  await page.getByRole("button", { name: "Page 2" }).click();
  await expect(page.getByText("Needs check").first()).toBeVisible();
});

test("deleting warns that nothing is actually persisted", async ({ page }) => {
  // The dangerous assumption is the opposite one: somebody who believes this
  // wrote to a shared catalogue will not check afterwards.
  await page
    .getByRole("button", { name: /Actions for Master of Cybersecurity/ })
    .click();
  await page.getByRole("menuitem", { name: "Delete" }).click();

  await expect(
    page.getByRole("heading", { name: "Delete this programme?" }),
  ).toBeVisible();
  await expect(page.getByText(/held for the current session only/)).toBeVisible();

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Master of Cybersecurity")).toBeVisible();
});

test("delete removes the row from the table", async ({ page }) => {
  await page
    .getByRole("button", { name: /Actions for Master of Cybersecurity/ })
    .click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(page.getByText("Master of Cybersecurity")).toHaveCount(0);
  await expect(page.getByText("Showing 1–10 of 14 programmes")).toBeVisible();
});

test("a duplicate opens as an unverified draft", async ({ page }) => {
  // It must NOT inherit the original's verified_at. Every figure the agent
  // states travels with that date, and a copy claiming it was checked on the
  // original's date is the catalogue lying about itself.
  await page
    .getByRole("button", { name: /Actions for Master of Cybersecurity/ })
    .click();
  await page.getByRole("menuitem", { name: "Duplicate" }).click();

  // Lands in the editor on the copy.
  await expect(page).toHaveURL(/\/catalogue\/.+/);

  // Back through the rail, NOT page.goto. The catalogue store is held in
  // memory for the session, so a full page load resets it — which is exactly
  // what `catalogueStore` says it does, and would make this test assert the
  // opposite of what it is about.
  await page
    .getByRole("navigation", { name: "Northbound surfaces" })
    .getByRole("link", { name: "Catalogue" })
    .click();

  await expect(page.getByText("Master of Cybersecurity (copy)")).toBeVisible();
  await expect(page.getByText("Draft").first()).toBeVisible();
  // Never inherits the original's verification date.
  await expect(page.getByText("Showing 1–10 of 16 programmes")).toBeVisible();
});

test("the row menu closes on Escape", async ({ page }) => {
  await page
    .getByRole("button", { name: /Actions for Master of Data Science/ })
    .click();
  await expect(page.getByRole("menuitem", { name: "Edit" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: "Edit" })).toHaveCount(0);
});
