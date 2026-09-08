/** Editing a counsellor's contact details.
 *
 * `PATCH /api/users/{id}` is mocked, and what the form SENT is most of what is
 * asserted. "Only the fields that changed" is the endpoint's contract and is
 * invisible from the screen: a form that helpfully posts every field each time
 * looks identical to a correct one, right up until two people edit the same
 * person and one silently reverts the other's work.
 */
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";

import {
  mockMe,
  mockPatchUser,
  mockPatchUserFieldError,
  mockRoster,
  stubEverythingElse,
  user,
} from "./support/roster";

const ME = "00000000-0000-4000-8000-999999999999";

test.beforeEach(async ({ page }) => {
  await setupClerkTestingToken({ page });
  await stubEverythingElse(page);
});

test("someone with users.edit gets an Edit button", async ({ page }) => {
  await mockMe(page, { permissions: ["users.edit"] });
  await mockRoster(page, [user({ name: "Anita Silva" })]);

  await page.goto("/counsellors");

  await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();
});

test("someone without users.edit gets no Edit button on a colleague", async ({
  page,
}) => {
  await mockMe(page, { role: "counsellor", permissions: ["leads.read.owned"] });
  await mockRoster(page, [user({ name: "Anita Silva" })]);

  await page.goto("/counsellors");
  await expect(
    page.getByRole("heading", { name: "Anita Silva" }),
  ).toBeVisible();

  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
});

test("a counsellor may still edit their OWN row", async ({ page }) => {
  // The reason this is self-or-permission rather than a plain permission
  // check, and the same rule the endpoint enforces.
  await mockMe(page, {
    user_id: ME,
    role: "counsellor",
    permissions: ["leads.read.owned"],
  });
  await mockRoster(page, [user({ id: ME, name: "Zoe Perera" })]);

  await page.goto("/counsellors");

  await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();
});

test("the form opens with the current values, phone split apart", async ({
  page,
}) => {
  await mockMe(page);
  await mockRoster(page, [
    user({ name: "Anita Silva", work_phone: "+94771234567" }),
  ]);

  await page.goto("/counsellors");
  await page.getByRole("button", { name: "Edit" }).click();

  await expect(page.getByLabel("Name")).toHaveValue("Anita Silva");
  // Stored as one E.164 string; shown as a country and a national number,
  // because nobody should need to know what E.164 is to edit their number.
  await expect(page.getByLabel("Work phone")).toHaveValue("771234567");
});

test("only the field that changed is sent", async ({ page }) => {
  await mockMe(page);
  const roster = [user({ name: "Anita Silva", work_phone: "+94771234567" })];
  await mockRoster(page, roster);
  const sent = await mockPatchUser(page, (body) => ({
    ...roster[0],
    ...body,
  }));

  await page.goto("/counsellors");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name").fill("Anita Silva-Perera");
  await page.getByRole("button", { name: "Save" }).click();

  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual({ name: "Anita Silva-Perera" });
  // Not merely absent-and-null: absent entirely. Sending work_phone unchanged
  // would overwrite whatever another editor had just put there.
  expect(sent[0]).not.toHaveProperty("work_phone");
});

test("clearing the number sends null, which is how it is removed", async ({
  page,
}) => {
  await mockMe(page);
  const roster = [user({ name: "Anita Silva", work_phone: "+94771234567" })];
  await mockRoster(page, roster);
  const sent = await mockPatchUser(page, (body) => ({ ...roster[0], ...body }));

  await page.goto("/counsellors");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Work phone").fill("");
  await page.getByRole("button", { name: "Save" }).click();

  await expect.poll(() => sent.length).toBe(1);
  // null, not "". An omitted field means "leave it"; null means "clear it",
  // and a counsellor who no longer wants to be rung needs the second.
  expect(sent[0]).toEqual({ work_phone: null });
});

test("saving with nothing changed does not call the API", async ({ page }) => {
  await mockMe(page);
  await mockRoster(page, [user({ name: "Anita Silva" })]);
  const sent = await mockPatchUser(page, (body) => ({ ...user(), ...body }));

  await page.goto("/counsellors");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();
  expect(sent).toHaveLength(0);
});

test("a refused number annotates the phone field, not a banner", async ({
  page,
}) => {
  // +947424059777 passes an E.164 regex and is one digit too long for Sri
  // Lanka. The backend knows the difference and says which field it refused.
  await mockMe(page);
  // Seeded with a number so the country is already chosen; this test is about
  // the backend refusing a number, not about picking a country.
  await mockRoster(page, [
    user({ name: "Anita Silva", work_phone: "+94771234567" }),
  ]);
  await mockPatchUserFieldError(
    page,
    "work_phone",
    "That number is not valid for the country selected.",
  );

  await page.goto("/counsellors");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Work phone").fill("7424059777");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(
    page.getByText("That number is not valid for the country selected."),
  ).toBeVisible();
  // Still editing, with the rejected value in place to correct.
  await expect(page.getByLabel("Work phone")).toHaveValue("7424059777");
});

test("cancel leaves without saving anything", async ({ page }) => {
  await mockMe(page);
  await mockRoster(page, [user({ name: "Anita Silva" })]);
  const sent = await mockPatchUser(page, (body) => ({ ...user(), ...body }));

  await page.goto("/counsellors");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name").fill("Something Else");
  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(
    page.getByRole("heading", { name: "Anita Silva" }),
  ).toBeVisible();
  expect(sent).toHaveLength(0);
});

test("the card shows the saved value afterwards", async ({ page }) => {
  await mockMe(page);
  const roster = [user({ name: "Anita Silva", work_phone: null })];
  await mockRoster(page, roster);
  await mockPatchUser(page, (body) => {
    // The roster mock stringifies this array per request, so writing back here
    // is what the refetch after invalidation will see — the same round trip a
    // real backend does.
    Object.assign(roster[0], body);
    return roster[0];
  });

  await page.goto("/counsellors");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name").fill("Anita Silva-Perera");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(
    page.getByRole("heading", { name: "Anita Silva-Perera" }),
  ).toBeVisible();
});

test("a number typed with no country is refused, not silently dropped", async ({
  page,
}) => {
  // composeE164 has no dial code to work with and returns null, which the API
  // reads as "clear it". Without a guard the digits would vanish and the form
  // would report success.
  await mockMe(page);
  await mockRoster(page, [user({ name: "Anita Silva", work_phone: null })]);
  const sent = await mockPatchUser(page, (body) => ({ ...user(), ...body }));

  await page.goto("/counsellors");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Work phone").fill("771234567");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(
    page.getByText("Choose the country for this number."),
  ).toBeVisible();
  expect(sent).toHaveLength(0);
});

test("letters never make it into the phone box", async ({ page }) => {
  // The box holds a number. Dropping letters as they are typed means nothing
  // appears, which is the clearest possible signal that they are not wanted.
  await mockMe(page);
  await mockRoster(page, [user({ name: "Anita Silva", work_phone: null })]);

  await page.goto("/counsellors");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Work phone").fill("asdsa");

  await expect(page.getByLabel("Work phone")).toHaveValue("");
});

test("a phone box holding no digits is refused, not treated as cleared", async ({
  page,
}) => {
  // The backstop for the case above. Text with no digits composes to null,
  // and null is what the API reads as "clear this field" — so without this
  // the form would close reporting success and the input would be gone.
  await mockMe(page);
  await mockRoster(page, [user({ name: "Anita Silva", work_phone: null })]);
  const sent = await mockPatchUser(page, (body) => ({ ...user(), ...body }));

  await page.goto("/counsellors");
  await page.getByRole("button", { name: "Edit" }).click();
  // Past the input filter, the way a paste or an autofill can be.
  // `any` because this file is typechecked by the node tsconfig, which has no
  // DOM lib — the callback runs in the browser, not here.
  await page.getByLabel("Work phone").evaluate((el: any) => {
    const w = globalThis as any;
    const setter: any = Object.getOwnPropertyDescriptor(
      w.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter.call(el, "-- --");
    el.dispatchEvent(new w.Event("input", { bubbles: true }));
  });
  await page.getByRole("button", { name: "Save" }).click();

  await expect(
    page.getByText("Enter the number in digits, for example 771234567."),
  ).toBeVisible();
  // Still on the form, not closed as if it had saved.
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
  expect(sent).toHaveLength(0);
});

test("pasting a full international number fills both controls", async ({
  page,
}) => {
  // Otherwise it lands in the national box beside a country already chosen and
  // composes +9494771234567 — wrong in a way nobody spots on screen.
  await mockMe(page);
  const roster = [user({ name: "Anita Silva", work_phone: "+94771234567" })];
  await mockRoster(page, roster);
  const sent = await mockPatchUser(page, (body) => ({ ...roster[0], ...body }));

  await page.goto("/counsellors");
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Work phone").fill("+442071838750");
  await page.getByRole("button", { name: "Save" }).click();

  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toEqual({ work_phone: "+442071838750" });
});
