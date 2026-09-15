/** Profile photos.
 *
 * The photo belongs to Clerk — `db/SCHEMA.md` keeps avatars out of this
 * database because a copy of something Clerk owns drifts from it. The API
 * resolves one per request and sends null when there is none.
 *
 * Initials are the other correct answer, not a failure state, so the cases
 * worth testing are the ones where a photo is absent or unusable: an invited
 * person with no Clerk account, and an image that will not load.
 */
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";

import { mockMe, mockRoster, stubEverythingElse, user } from "./support/roster";
import { mockAvailability } from "./support/availability";

// A 1x1 transparent gif. Inline so the test never depends on the network.
const PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

test.beforeEach(async ({ page }) => {
  await setupClerkTestingToken({ page });
  await stubEverythingElse(page);
  await mockMe(page);
  await mockAvailability(page, []);
});

test("shows the photo when there is one", async ({ page }) => {
  await mockRoster(page, [
    user({ name: "Anita Silva", image_url: PIXEL }),
  ]);

  await page.goto("/counsellors");

  // One in the roster row, one in the profile header.
  await expect(page.locator("img.console-avatar-img")).toHaveCount(2);
  await expect(page.locator("img.console-avatar-img").first()).toHaveAttribute(
    "src",
    PIXEL,
  );
});

test("draws initials when there is no photo", async ({ page }) => {
  // The normal case: nobody has uploaded one. Clerk hands back a generated
  // grey placeholder for these, and the API filters it out precisely so this
  // screen keeps its own initials rather than a row of identical grey circles.
  await mockRoster(page, [user({ name: "Anita Silva", image_url: null })]);

  await page.goto("/counsellors");

  await expect(page.locator("img.console-avatar-img")).toHaveCount(0);
  await expect(page.locator(".console-avatar").first()).toHaveText("AS");
});

test("an invited person has no photo and is not treated as broken", async ({
  page,
}) => {
  // They have no Clerk account until they accept, so there is nothing to show
  // and never will be until then. The initials come off their address.
  await mockRoster(page, [
    user({ name: null, email: "newjoiner@agency.test", status: "invited" }),
  ]);

  await page.goto("/counsellors");

  await expect(page.locator("img.console-avatar-img")).toHaveCount(0);
  await expect(page.locator(".console-avatar").first()).toHaveText("N");
});

test("a photo that will not load falls back to initials", async ({ page }) => {
  // Not hypothetical: a Clerk url can 404 after someone removes their photo,
  // and the cached answer outlives that by up to a minute. A broken-image
  // glyph in a list of forty people is the outcome this avoids.
  await mockRoster(page, [
    user({ name: "Anita Silva", image_url: "https://example.invalid/none.png" }),
  ]);

  await page.goto("/counsellors");

  await expect(page.locator(".console-avatar").first()).toHaveText("AS");
  await expect(page.locator("img.console-avatar-img")).toHaveCount(0);
});
