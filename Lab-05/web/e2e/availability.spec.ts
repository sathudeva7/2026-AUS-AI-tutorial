/** The availability grid.
 *
 * Most of these assert what the grid SENDS, not what it draws. The endpoint
 * refuses overlapping windows and anything crossing midnight, and it stores a
 * repeating week with no dates in it — none of which is visible on screen. A
 * grid that painted correctly and sent 48 half-hour rules instead of one would
 * look perfect and be wrong.
 */
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";

import { mockMe, mockRoster, stubEverythingElse, user } from "./support/roster";
import { mockAvailability, mockSaveAvailability } from "./support/availability";

const ME = "00000000-0000-4000-8000-999999999999";

test.beforeEach(async ({ page }) => {
  await setupClerkTestingToken({ page });
  await stubEverythingElse(page);
});

test("saved hours are painted on the grid", async ({ page }) => {
  await mockMe(page);
  await mockRoster(page, [user({ name: "Anita Silva", timezone: "Asia/Colombo" })]);
  await mockAvailability(page, [
    { day_of_week: 1, start_time: "09:00", end_time: "11:00" },
  ]);

  await page.goto("/counsellors");

  await expect(page.getByRole("button", { name: "Mon 09:00, available" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mon 10:30, available" })).toBeVisible();
  // 11:00 is the exclusive end — the window stops before it.
  await expect(
    page.getByRole("button", { name: "Mon 11:00, not available" }),
  ).toBeVisible();
});

test("adjacent cells are saved as ONE window, not one per cell", async ({ page }) => {
  // The endpoint refuses overlaps, and 48 half-hour rows for a working day
  // would be legal but useless — every read, every routing decision and every
  // future calendar view would carry them.
  await mockMe(page);
  await mockRoster(page, [user({ name: "Anita Silva" })]);
  await mockAvailability(page, []);
  const sent = await mockSaveAvailability(page);

  await page.goto("/counsellors");
  await page.getByRole("button", { name: "Tue 09:00, not available" }).click();
  await page.getByRole("button", { name: "Tue 09:30, not available" }).click();
  await page.getByRole("button", { name: "Tue 10:00, not available" }).click();
  await page.getByRole("button", { name: "Save" }).click();

  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].rules).toEqual([
    { day_of_week: 2, start_time: "09:00", end_time: "10:30" },
  ]);
});

test("a gap in the day becomes two windows", async ({ page }) => {
  // A split shift. The two must not be merged across the gap, and must not
  // overlap, or the save is refused.
  await mockMe(page);
  await mockRoster(page, [user({ name: "Anita Silva" })]);
  await mockAvailability(page, []);
  const sent = await mockSaveAvailability(page);

  await page.goto("/counsellors");
  await page.getByRole("button", { name: "Wed 09:00, not available" }).click();
  await page.getByRole("button", { name: "Wed 11:00, not available" }).click();
  await page.getByRole("button", { name: "Save" }).click();

  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].rules).toEqual([
    { day_of_week: 3, start_time: "09:00", end_time: "09:30" },
    { day_of_week: 3, start_time: "11:00", end_time: "11:30" },
  ]);
});

test("a window running to midnight ends at 24:00", async ({ page }) => {
  // Postgres `time` includes 24:00:00 and it is the only way to say "until
  // midnight" while the end_time > start_time CHECK still holds. A grid that
  // wrapped to 00:00 would be refused as crossing midnight.
  await mockMe(page);
  await mockRoster(page, [user({ name: "Anita Silva" })]);
  await mockAvailability(page, [
    { day_of_week: 4, start_time: "23:00", end_time: "24:00" },
  ]);
  const sent = await mockSaveAvailability(page);

  await page.goto("/counsellors");
  await page.getByRole("button", { name: "Thu 22:30, not available" }).click();
  await page.getByRole("button", { name: "Save" }).click();

  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].rules).toEqual([
    { day_of_week: 4, start_time: "22:30", end_time: "24:00" },
  ]);
});

test("Sunday saves as day 0, not day 7", async ({ page }) => {
  // The column order is Monday-first; the stored number is not. Getting this
  // wrong puts every shift one day out and looks entirely plausible.
  await mockMe(page);
  await mockRoster(page, [user({ name: "Anita Silva" })]);
  await mockAvailability(page, []);
  const sent = await mockSaveAvailability(page);

  await page.goto("/counsellors");
  await page.getByRole("button", { name: "Sun 10:00, not available" }).click();
  await page.getByRole("button", { name: "Save" }).click();

  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].rules[0].day_of_week).toBe(0);
});

test("clicking a painted cell clears it", async ({ page }) => {
  await mockMe(page);
  await mockRoster(page, [user({ name: "Anita Silva" })]);
  await mockAvailability(page, [
    { day_of_week: 1, start_time: "09:00", end_time: "10:00" },
  ]);
  const sent = await mockSaveAvailability(page);

  await page.goto("/counsellors");
  await page.getByRole("button", { name: "Mon 09:00, available" }).click();
  await page.getByRole("button", { name: "Save" }).click();

  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].rules).toEqual([
    { day_of_week: 1, start_time: "09:30", end_time: "10:00" },
  ]);
});

test("clearing the last cell saves an empty week", async ({ page }) => {
  // Not "nothing to send". An empty week is a legitimate state and the way
  // somebody stops being bookable.
  await mockMe(page);
  await mockRoster(page, [user({ name: "Anita Silva" })]);
  await mockAvailability(page, [
    { day_of_week: 1, start_time: "09:00", end_time: "09:30" },
  ]);
  const sent = await mockSaveAvailability(page);

  await page.goto("/counsellors");
  await page.getByRole("button", { name: "Mon 09:00, available" }).click();
  await page.getByRole("button", { name: "Save" }).click();

  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].rules).toEqual([]);
});

test("Save does nothing until something changes", async ({ page }) => {
  // PUT replaces the whole week, so an idle Save is a full rewrite for no
  // reason — and two of them in flight together race.
  await mockMe(page);
  await mockRoster(page, [user({ name: "Anita Silva" })]);
  await mockAvailability(page, [
    { day_of_week: 1, start_time: "09:00", end_time: "17:00" },
  ]);

  await page.goto("/counsellors");

  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
  await page.getByRole("button", { name: "Mon 09:00, available" }).click();
  await expect(page.getByRole("button", { name: "Save" })).toBeEnabled();
});

test("Discard puts the saved week back", async ({ page }) => {
  await mockMe(page);
  await mockRoster(page, [user({ name: "Anita Silva" })]);
  await mockAvailability(page, [
    { day_of_week: 1, start_time: "09:00", end_time: "10:00" },
  ]);
  const sent = await mockSaveAvailability(page);

  await page.goto("/counsellors");
  await page.getByRole("button", { name: "Mon 09:00, available" }).click();
  await page.getByRole("button", { name: "Discard" }).click();

  await expect(page.getByRole("button", { name: "Mon 09:00, available" })).toBeVisible();
  expect(sent).toHaveLength(0);
});

test("the grid says the hours repeat, and whose clock they are in", async ({
  page,
}) => {
  // The two things a dated grid does not say by itself, and both are costly to
  // get wrong: editing Tuesday edits every Tuesday, and 09:00 means 09:00
  // where THEY are.
  await mockMe(page);
  await mockRoster(page, [
    user({ name: "Anita Silva", timezone: "Europe/London" }),
  ]);
  await mockAvailability(page, []);

  await page.goto("/counsellors");

  await expect(page.getByText(/changing Tuesday changes every Tuesday/)).toBeVisible();
  // One assertion, not two: the zone also appears in the Contact card above,
  // so a bare /Europe\/London/ matches both and Playwright refuses it.
  await expect(
    page.getByText(/Times are Europe\/London .* Anita's own timezone/),
  ).toBeVisible();
});

test("a counsellor may set their own week", async ({ page }) => {
  await mockMe(page, {
    user_id: ME,
    role: "counsellor",
    permissions: ["leads.read.owned"],
  });
  await mockRoster(page, [user({ id: ME, name: "Zoe Perera" })]);
  await mockAvailability(page, []);

  await page.goto("/counsellors");

  await expect(page.getByRole("button", { name: "Mon 09:00, not available" })).toBeEnabled();
});

test("someone with no permission gets a read-only grid", async ({ page }) => {
  await mockMe(page, { role: "counsellor", permissions: ["leads.read.owned"] });
  await mockRoster(page, [user({ name: "Anita Silva" })]);
  await mockAvailability(page, [
    { day_of_week: 1, start_time: "09:00", end_time: "17:00" },
  ]);

  await page.goto("/counsellors");

  await expect(page.getByRole("button", { name: "Mon 09:00, available" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0);
});

test("hours off the half-hour are kept, not rounded away", async ({ page }) => {
  // A 30-minute grid cannot draw 09:15-17:45. Rounding it would change
  // somebody's stated hours without asking, and dropping it would delete them
  // as a side effect of opening a screen.
  await mockMe(page);
  await mockRoster(page, [user({ name: "Anita Silva" })]);
  await mockAvailability(page, [
    { day_of_week: 1, start_time: "09:15", end_time: "17:45" },
    { day_of_week: 2, start_time: "09:00", end_time: "10:00" },
  ]);
  const sent = await mockSaveAvailability(page);

  await page.goto("/counsellors");
  await expect(page.getByText(/not on the half-hour/)).toBeVisible();
  await expect(page.getByText(/Mon 09:15–17:45/)).toBeVisible();

  await page.getByRole("button", { name: "Tue 09:00, available" }).click();
  await page.getByRole("button", { name: "Save" }).click();

  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].rules).toContainEqual({
    day_of_week: 1,
    start_time: "09:15",
    end_time: "17:45",
  });
});

test("a refused week says why and stays editable", async ({ page }) => {
  await mockMe(page);
  await mockRoster(page, [user({ name: "Anita Silva" })]);
  await mockAvailability(page, []);
  await mockSaveAvailability(page, {
    status: 422,
    field: "rules",
    issue: "Two windows overlap on day 1.",
  });

  await page.goto("/counsellors");
  await page.getByRole("button", { name: "Mon 09:00, not available" }).click();
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("Two windows overlap on day 1.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Mon 09:00, available" })).toBeVisible();
});

test("the window widens to show hours outside working time", async ({ page }) => {
  // A Colombo counsellor covering Australian evenings. A grid that defaulted
  // to 07:00-22:00 and silently hid the rest would show them as free.
  await mockMe(page);
  await mockRoster(page, [user({ name: "Anita Silva" })]);
  await mockAvailability(page, [
    { day_of_week: 2, start_time: "05:00", end_time: "06:00" },
  ]);

  await page.goto("/counsellors");

  await expect(page.getByRole("button", { name: "Tue 05:00, available" })).toBeVisible();
});

test("a split shift already saved does not arrive looking edited", async ({
  page,
}) => {
  // The API stores a split shift as two windows. The grid paints them as one
  // contiguous run, which merges back to a single window — so comparing the
  // draft against the raw saved list says "changed" when nothing was touched,
  // Save lights up on load, and pressing it rewrites a week nobody edited.
  await mockMe(page);
  await mockRoster(page, [user({ name: "Anita Silva" })]);
  await mockAvailability(page, [
    { day_of_week: 1, start_time: "09:00", end_time: "12:00" },
    { day_of_week: 1, start_time: "12:00", end_time: "17:00" },
  ]);

  await page.goto("/counsellors");

  await expect(page.getByRole("button", { name: "Mon 09:00, available" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
});
