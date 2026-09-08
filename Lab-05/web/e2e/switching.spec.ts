/** Switching from one person to another.
 *
 * Every other spec here uses a roster of one, which is why this went unnoticed:
 * you cannot switch person when there is only one person. Both the contact form
 * and the availability grid seed useState from props, and a useState
 * initialiser runs once on mount — React keeps the component in the same
 * position and swaps the props, so the state describes whoever was on screen
 * when it mounted.
 *
 * Before the keys were added, this was not a cosmetic glitch: the form stayed
 * open on the new person holding the old person's half-finished edit, and Save
 * wrote it to them.
 */
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";

import {
  mockMe,
  mockPatchUser,
  mockRoster,
  stubEverythingElse,
  user,
} from "./support/roster";
import { mockAvailability, mockSaveAvailability } from "./support/availability";

test.beforeEach(async ({ page }) => {
  await setupClerkTestingToken({ page });
  await stubEverythingElse(page);
  await mockMe(page);
});

test("an unsaved edit does not follow you to the next person", async ({ page }) => {
  const priya = user({ name: "Priya Fernando", email: "priya@a.test" });
  const anita = user({ name: "Anita Silva", email: "anita@a.test" });
  await mockRoster(page, [priya, anita]);
  await mockAvailability(page, []);
  const sent = await mockPatchUser(page, (body) => ({ ...anita, ...body }));

  await page.goto("/counsellors");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name").fill("PRIYA EDITED");

  await page.getByRole("button", { name: /Anita Silva/ }).click();

  // The form is gone: a different person is a different form, not the same one
  // with new labels.
  await expect(page.getByRole("heading", { name: "Anita Silva" })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveCount(0);
  expect(sent).toHaveLength(0);
});

test("opening the next person's form shows THEIR details", async ({ page }) => {
  const priya = user({
    name: "Priya Fernando",
    email: "priya@a.test",
    work_phone: "+94771234567",
  });
  const anita = user({
    name: "Anita Silva",
    email: "anita@a.test",
    work_phone: null,
  });
  await mockRoster(page, [priya, anita]);
  await mockAvailability(page, []);

  await page.goto("/counsellors");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name").fill("PRIYA EDITED");

  await page.getByRole("button", { name: /Anita Silva/ }).click();
  await page.getByRole("button", { name: "Edit" }).click();

  await expect(page.getByLabel("Name")).toHaveValue("Anita Silva");
  // Priya's number must not be sitting in Anita's box waiting to be saved.
  await expect(page.getByLabel("Work phone")).toHaveValue("");
});

test("one person's hours are not carried onto another", async ({ page }) => {
  // The worse half of the same bug. A wrong name is obvious on screen; a wrong
  // week is not, and it decides when students can book somebody.
  const priya = user({ name: "Priya Fernando", email: "priya@a.test" });
  const anita = user({ name: "Anita Silva", email: "anita@a.test" });
  await mockRoster(page, [priya, anita]);
  await mockAvailability(page, []);
  const sent = await mockSaveAvailability(page);

  await page.goto("/counsellors");
  await page.getByRole("button", { name: "Mon 09:00, not available" }).click();
  await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();

  await page.getByRole("button", { name: /Anita Silva/ }).click();

  // Anita's grid starts from Anita's saved week — empty — not from the cells
  // painted on Priya's.
  await expect(page.getByRole("button", { name: "Mon 09:00, not available" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(sent).toHaveLength(0);
});
