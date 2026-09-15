/** Creating and editing a programme.
 *
 * A catalogue row is what the agent is permitted to assert about someone's
 * future, so the editor argues before it publishes a vague one. The footer is
 * the piece worth testing: it never just says "invalid", it names what is
 * still missing, and it says out loud what saving with no entry requirements
 * would mean.
 */
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";

import { mockMe, stubEverythingElse } from "./support/roster";

test.beforeEach(async ({ page }) => {
  await setupClerkTestingToken({ page });
  await stubEverythingElse(page);
  await mockMe(page);
});

test("a new programme names what is still missing, and cannot be saved", async ({
  page,
}) => {
  await page.goto("/catalogue/new");

  await expect(
    page.getByText(
      "Still needs a programme name, an institution, a country, a tuition figure, at least one intake.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Save · publish/ }),
  ).toBeDisabled();
});

test("filling the gaps enables saving, one at a time", async ({ page }) => {
  await page.goto("/catalogue/new");

  await page.getByLabel("Programme name").fill("MSc Marine Biology");
  await expect(page.getByText(/Still needs an institution/)).toBeVisible();

  await page.getByLabel("Institution", { exact: true }).fill("Coastal University");
  await page.getByLabel("Country").click();
  await page.getByRole("option", { name: /Australia/ }).click();
  await page.getByLabel("Tuition · international, per year").fill("38000");
  await page.getByRole("checkbox", { name: "September 2027" }).click();

  // Nothing missing — but it still says what an empty requirement list means,
  // because that is a decision rather than an omission.
  await expect(
    page.getByText(/this programme will match every student/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Save · publish/ }),
  ).toBeEnabled();
});

test("country is a list, not a free-text box", async ({ page }) => {
  // The string is matched against counsellors' owned countries to decide
  // routing and against the catalogue coverage banner. A typed "Aus" is a
  // destination nobody owns, forever.
  await page.goto("/catalogue/new");

  await page.getByLabel("Country").click();
  await page.getByRole("option", { name: /Sri Lanka/ }).click();
  await expect(page.getByLabel("Country")).toContainText("Sri Lanka");
});

test("an existing programme keeps a country spelling the ISO list lacks", async ({
  page,
}) => {
  // The seed catalogue writes "UK". Dropping it from the options would blank
  // the field on open, and a later edit to the fee would save a country
  // nobody touched.
  await page.goto("/catalogue");
  await page.getByRole("button", { name: "Page 2" }).click();
  await page.getByText("MSc Business Analytics").click();

  await expect(page.getByLabel("Country")).toContainText("UK");
});

test("requirement templates add rows, and rows can be removed", async ({
  page,
}) => {
  await page.goto("/catalogue/new");

  await expect(page.getByText("No entry requirements")).toBeVisible();

  await page.getByRole("button", { name: "Grades" }).click();
  await expect(page.getByText("percentage>=65")).toBeVisible();
  await expect(page.getByText("1 requirement", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Remove grades requirement/ }).click();
  await expect(page.getByText("No entry requirements")).toBeVisible();
});

test("a programme with no source URL is warned it will go stale silently", async ({
  page,
}) => {
  await page.goto("/catalogue/new");

  await expect(
    page.getByText(/excluded from the overnight refresh job/),
  ).toBeVisible();

  await page
    .getByLabel("Official source URL")
    .fill("https://example.edu/course");
  await expect(
    page.getByText(/raises a review item when a figure drifts/),
  ).toBeVisible();
});

test("saving a new programme puts it in the table", async ({ page }) => {
  await page.goto("/catalogue/new");

  await page.getByLabel("Programme name").fill("MSc Marine Biology");
  await page.getByLabel("Institution", { exact: true }).fill("Coastal University");
  await page.getByLabel("Country").click();
  await page.getByRole("option", { name: /Australia/ }).click();
  await page.getByLabel("Tuition · international, per year").fill("38000");
  await page.getByRole("checkbox", { name: "September 2027" }).click();
  await page.getByRole("button", { name: /Save · publish/ }).click();

  await expect(page).toHaveURL(/\/catalogue$/);
  await expect(page.getByText("MSc Marine Biology")).toBeVisible();
});
