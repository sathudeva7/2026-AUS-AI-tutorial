/** Inviting someone to the agency.
 *
 * The form this replaced was a prototype: ten fields, one of which the API
 * took. So the assertions here are mostly about what is NOT collected and
 * what is NOT sent — a caseload cap or a specialisation reappearing in this
 * body means somebody has rebuilt a screen the database cannot honour.
 */
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";

import {
  mockAvailability,
} from "./support/availability";
import {
  mockInvite,
  mockInviteRefused,
  mockMe,
  mockRoster,
  stubEverythingElse,
  user,
} from "./support/roster";

const anita = user({ name: "Anita Silva" });

test.beforeEach(async ({ page }) => {
  await setupClerkTestingToken({ page });
  await stubEverythingElse(page);
  await mockAvailability(page, []);
});

async function openDialog(page: import("@playwright/test").Page) {
  await page.goto("/counsellors");
  await page.getByRole("button", { name: "Invite a counsellor" }).click();
  await expect(
    page.getByRole("heading", { name: "Invite a counsellor" }),
  ).toBeVisible();
}

test("sends an address and a role, and nothing else", async ({ page }) => {
  await mockMe(page);
  await mockRoster(page, [anita]);
  const sent = await mockInvite(page, (body) =>
    user({ name: null, email: body.email, status: "invited" }),
  );

  await openDialog(page);
  await page.getByLabel("Work email").fill("newjoiner@agency.test");
  await page.getByRole("radio", { name: /Manager/ }).click();
  await page.getByRole("button", { name: "Send invitation" }).click();

  await expect.poll(() => sent).toEqual([
    { email: "newjoiner@agency.test", role: "manager" },
  ]);
});

test("asks for no name — the invite only knows an address", async ({ page }) => {
  // The name arrives from Clerk when they accept. A name box here would
  // collect something the request cannot carry and then drop it.
  await mockMe(page);
  await mockRoster(page, [anita]);

  await openDialog(page);

  await expect(page.getByLabel("Full name")).toHaveCount(0);
  // Nor the prototype's invented fields, none of which is a column.
  await expect(page.getByText("Active caseload cap")).toHaveCount(0);
  await expect(page.getByText("Specialisations")).toHaveCount(0);
});

test("offers the three roles the column actually stores", async ({ page }) => {
  await mockMe(page);
  await mockRoster(page, [anita]);

  await openDialog(page);

  const roles = page.getByRole("radiogroup", { name: "Role" });
  await expect(roles.getByRole("radio")).toHaveCount(3);
  await expect(roles.getByRole("radio", { name: /Counsellor/ })).toBeChecked();
  // "Senior counsellor", "Junior counsellor" and "Branch manager" were
  // invented; the enum is counsellor | manager | owner.
  await expect(page.getByRole("radio", { name: /Junior/ })).toHaveCount(0);
});

test("refuses an address that is not one, before sending", async ({ page }) => {
  await mockMe(page);
  await mockRoster(page, [anita]);
  const sent = await mockInvite(page, () => anita);

  await openDialog(page);
  await page.getByLabel("Work email").fill("not-an-address");

  await expect(
    page.getByText("That does not look like an email address."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send invitation" }),
  ).toBeDisabled();
  expect(sent).toHaveLength(0);
});

test("a personal address is accepted — membership defines the agency", async ({
  page,
}) => {
  // CLAUDE.md: do not gate on email domain. Small agencies run on Gmail and
  // agencies with branches run on several domains.
  await mockMe(page);
  await mockRoster(page, [anita]);
  const sent = await mockInvite(page, (body) =>
    user({ name: null, email: body.email, status: "invited" }),
  );

  await openDialog(page);
  await page.getByLabel("Work email").fill("someone@gmail.com");
  await page.getByRole("button", { name: "Send invitation" }).click();

  await expect.poll(() => sent.length).toBe(1);
});

test("confirms without closing, so a branch can be invited in one sitting", async ({
  page,
}) => {
  await mockMe(page);
  await mockRoster(page, [anita]);
  await mockInvite(page, (body) =>
    user({ name: null, email: body.email, status: "invited" }),
  );

  await openDialog(page);
  await page.getByLabel("Work email").fill("first@agency.test");
  await page.getByRole("button", { name: "Send invitation" }).click();

  await expect(page.getByText(/Invitation sent to/)).toBeVisible();
  await expect(page.getByText("first@agency.test")).toBeVisible();
  // Still open, and the box is clear for the next one.
  await expect(page.getByLabel("Work email")).toHaveValue("");
});

test("an already-invited address says their invitation still stands", async ({
  page,
}) => {
  // Sending a second one is not the fix, so the message must not read like a
  // transient failure worth retrying.
  await mockMe(page);
  await mockRoster(page, [anita]);
  await mockInviteRefused(
    page,
    409,
    "ALREADY_INVITED",
    "That person has already been invited.",
  );

  await openDialog(page);
  await page.getByLabel("Work email").fill("taken@agency.test");
  await page.getByRole("button", { name: "Send invitation" }).click();

  await expect(
    page.getByText(/already been invited. Their invitation is still valid/),
  ).toBeVisible();
  await expect(page.getByText(/Invitation sent to/)).toHaveCount(0);
});

test("a failed send says nobody was added", async ({ page }) => {
  // Clerk goes first and the roster row second, so a 502 here means no
  // invitation and no row. Saying so is the difference between "try again"
  // and "check whether that half-worked".
  await mockMe(page);
  await mockRoster(page, [anita]);
  await mockInviteRefused(
    page,
    502,
    "INVITE_NOT_SENT",
    "The invitation could not be sent. Try again in a moment.",
  );

  await openDialog(page);
  await page.getByLabel("Work email").fill("someone@agency.test");
  await page.getByRole("button", { name: "Send invitation" }).click();

  await expect(page.getByText(/Nobody has been added/)).toBeVisible();
});

test("someone without users.invite never sees the button", async ({ page }) => {
  // Owner-only, the same rule the endpoint enforces. UX, not security — but a
  // button that always answers 403 is worse than no button.
  await mockMe(page, { role: "manager", permissions: ["users.edit"] });
  await mockRoster(page, [anita]);

  await page.goto("/counsellors");

  await expect(
    page.getByRole("button", { name: "Invite a counsellor" }),
  ).toHaveCount(0);
});
