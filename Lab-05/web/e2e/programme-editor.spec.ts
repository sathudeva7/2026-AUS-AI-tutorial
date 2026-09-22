/** Creating and editing a programme, against a mocked catalogue API.
 *
 * The editor used to read the in-memory fixture, keyed on `p_uk_001`, while
 * the table lists database uuids — so clicking a row opened a BLANK form over
 * a programme that exists, and saving it invented a second one that no reload
 * kept. Most of what is asserted here is that: the form is filled from
 * `GET /api/programmes/{id}`, and the save reaches the write endpoints with
 * what is on screen.
 *
 * The footer is the other half. It never just says "invalid": it names what
 * is still missing before a row could be verified, and it says out loud what
 * saving with no entry requirements would mean.
 *
 * `/catalogue/new` no longer opens the form. It opens the fork — paste a
 * course page, or fill it in by hand — so every test below that wants a blank
 * form goes through `openBlank`, which takes the manual road. The read road
 * has its own file.
 */
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";

import {
  mockProgrammeDetail,
  mockProgrammeDetailFailure,
  mockProgrammeWrites,
  mockProgrammes,
  programme,
  programmeDetail,
} from "./support/catalogue";
import { mockMe, stubEverythingElse } from "./support/roster";

const ID = "00000000-0000-4000-9000-0000000000aa";

/** Open a blank editor by way of the fork.
 *
 * Asserting the form is on screen before returning, rather than trusting the
 * click: a helper that navigates and hopes turns every failure below into a
 * confusing "element not found" on a page that never got there.
 */
async function openBlank(page: import("@playwright/test").Page) {
  await page.goto("/catalogue/new");
  await page.getByRole("button", { name: "Fill it in by hand" }).click();
  await page.getByLabel("Programme name").waitFor();
}

test.beforeEach(async ({ page }) => {
  await setupClerkTestingToken({ page });
  await stubEverythingElse(page);
  await mockMe(page);
});

// ---------------------------------------------------------------------------
// Opening an existing programme
// ---------------------------------------------------------------------------

test("opening a programme fills the form from the server", async ({ page }) => {
  // The regression this file exists for. Every one of these values comes from
  // the detail endpoint; a form that renders its defaults instead is the bug.
  await mockProgrammeDetail(
    page,
    programmeDetail({
      id: ID,
      name: "MSc Marine Biology",
      institution: "Coastal University",
      country: "AU",
      city: "Perth",
      field: "marine science",
      duration_months: 18,
    }),
  );

  await page.goto(`/catalogue/${ID}`);

  await expect(page.getByLabel("Programme name")).toHaveValue(
    "MSc Marine Biology",
  );
  await expect(page.getByLabel("Institution", { exact: true })).toHaveValue(
    "Coastal University",
  );
  await expect(page.getByLabel("City")).toHaveValue("Perth");
  await expect(page.getByLabel("Field")).toHaveValue("marine science");
  await expect(page.getByLabel("Duration (months)")).toHaveValue("18");
  await expect(page.getByLabel("Country")).toContainText("Australia");
  await expect(
    page.getByRole("radio", { name: "Master's degree" }),
  ).toHaveAttribute("aria-checked", "true");
});

test("the fee is editable as a figure, not as a formatted string", async ({
  page,
}) => {
  // Stored in minor units and rendered back without a symbol or separators:
  // "£24,500" in a box that is PATCHed back is either refused as unparseable
  // or, worse, read as a different number.
  await mockProgrammeDetail(
    page,
    programmeDetail({ id: ID, tuition_per_year_minor: 2450000, currency: "GBP" }),
  );

  await page.goto(`/catalogue/${ID}`);

  await expect(
    page.getByLabel("Tuition · international, per year"),
  ).toHaveValue("24500.00");
});

test("a fee in a currency with no minor unit is not divided by a hundred", async ({
  page,
}) => {
  // ¥1,200,000 stored correctly and divided by 100 reads as ¥12,000 — wrong
  // by two orders of magnitude, and wrong in the direction a student would
  // happily believe.
  await mockProgrammeDetail(
    page,
    programmeDetail({ id: ID, tuition_per_year_minor: 1200000, currency: "JPY" }),
  );

  await page.goto(`/catalogue/${ID}`);

  await expect(
    page.getByLabel("Tuition · international, per year"),
  ).toHaveValue("1200000");
});

test("each intake keeps its own deadline", async ({ page }) => {
  // January and September close months apart. One shared date is how the
  // agent quotes the wrong one to half the students.
  await mockProgrammeDetail(
    page,
    programmeDetail({
      id: ID,
      intakes: [
        { intake: "2027-01", application_deadline: "2026-10-01", is_open: true },
        { intake: "2027-09", application_deadline: "2027-06-30", is_open: true },
      ],
    }),
  );

  await page.goto(`/catalogue/${ID}`);

  await expect(
    page.getByLabel("Application deadline", { exact: false }).first(),
  ).toHaveValue("2026-10-01");
  await expect(
    page.getByLabel("Application deadline", { exact: false }).nth(1),
  ).toHaveValue("2027-06-30");
});

test("the stored entry requirements are shown, not an empty list", async ({
  page,
}) => {
  await mockProgrammeDetail(
    page,
    programmeDetail({
      id: ID,
      requirements: [
        {
          fact_key: "english_test",
          rule: "ielts>=6.5",
          description: "IELTS 6.5 overall, or an accepted equivalent.",
          mandatory: true,
        },
      ],
    }),
  );

  await page.goto(`/catalogue/${ID}`);

  await expect(page.getByText("ielts>=6.5")).toBeVisible();
  await expect(page.getByText("1 requirement", { exact: true })).toBeVisible();
  await expect(page.getByText("No entry requirements")).toBeHidden();
});

test("a programme edited since it was verified says so in the editor", async ({
  page,
}) => {
  await mockProgrammeDetail(
    page,
    programmeDetail({ id: ID, edited_since_verified: true }),
  );

  await page.goto(`/catalogue/${ID}`);

  await expect(
    page.getByText(/changed after the last verification/),
  ).toBeVisible();
});

test("a detail read that fails says so instead of opening an empty form", async ({
  page,
}) => {
  // The failure mode being guarded: a blank editor over a real programme,
  // whose save would then overwrite live figures with nothing.
  await mockProgrammeDetailFailure(page);

  await page.goto(`/catalogue/${ID}`);

  await expect(
    page.getByText("This programme could not be opened"),
  ).toBeVisible();
  await expect(page.getByLabel("Programme name")).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

test("saving an edit patches the row and replaces both sets", async ({
  page,
}) => {
  const detail = programmeDetail({ id: ID, name: "MSc Data Science" });
  await mockProgrammeDetail(page, detail);
  const writes = await mockProgrammeWrites(page, detail);
  await mockProgrammes(page, [programme()]);

  await page.goto(`/catalogue/${ID}`);
  await page.getByLabel("Programme name").fill("MSc Applied Data Science");
  await page.getByLabel("Tuition · international, per year").fill("26000");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page).toHaveURL(/\/catalogue$/);

  // Three calls, in order. Intakes and requirements are PUT-the-whole-set,
  // which is what lets a removed one actually disappear.
  expect(writes.map((w) => `${w.method} ${w.path}`)).toEqual([
    `PATCH /api/programmes/${ID}`,
    `PUT /api/programmes/${ID}/intakes`,
    `PUT /api/programmes/${ID}/requirements`,
  ]);
  // ONLY what moved. `toEqual`, not `toMatchObject`: the absence of city,
  // country, level and the rest is the assertion. PATCH is "the fields the
  // client sent", so a form that posts all nine every time turns every save
  // into a full overwrite of a row someone else may be editing.
  //
  // The fee travels with its currency in both directions — the same figure
  // under a different currency is a different fee.
  expect(writes[0].body).toEqual({
    name: "MSc Applied Data Science",
    tuition_per_year: "26000",
    currency: "GBP",
  });
  expect(writes[1].body).toEqual([
    { intake: "2027-09", application_deadline: "2027-06-30", is_open: true },
  ]);
  expect(writes[2].body).toEqual([
    {
      fact_key: "grades",
      rule: "percentage>=65",
      description: "A UK 2:1 or international equivalent (65% and above).",
      mandatory: true,
    },
  ]);
});

test("removing an intake removes it from what is sent", async ({ page }) => {
  const detail = programmeDetail({
    id: ID,
    intakes: [
      { intake: "2027-01", application_deadline: "2026-10-01", is_open: true },
      { intake: "2027-09", application_deadline: "2027-06-30", is_open: true },
    ],
  });
  await mockProgrammeDetail(page, detail);
  const writes = await mockProgrammeWrites(page, detail);
  await mockProgrammes(page, [programme()]);

  await page.goto(`/catalogue/${ID}`);
  await page.getByRole("checkbox", { name: "January 2027" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page).toHaveURL(/\/catalogue$/);
  expect(writes[1].body).toEqual([
    { intake: "2027-09", application_deadline: "2027-06-30", is_open: true },
  ]);
});

test("a save the server refuses is shown, not swallowed", async ({ page }) => {
  await mockProgrammeDetail(page, programmeDetail({ id: ID }));
  await page.route(
    (url) => url.pathname === `/api/programmes/${ID}`,
    (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill({
            status: 422,
            contentType: "application/json",
            body: JSON.stringify({
              success: false,
              error: {
                code: "VALIDATION_FAILED",
                message: "A fee needs a currency.",
              },
              request_id: "req_test",
            }),
          })
        : route.fallback(),
  );

  await page.goto(`/catalogue/${ID}`);
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByText("This was not saved")).toBeVisible();
  await expect(page.getByText("A fee needs a currency.")).toBeVisible();
  // Still on the editor, with the work intact.
  await expect(page).toHaveURL(new RegExp(`/catalogue/${ID}$`));
});

// ---------------------------------------------------------------------------
// A new programme
// ---------------------------------------------------------------------------

test("a new programme cannot be saved without a name", async ({ page }) => {
  await openBlank(page);

  await expect(page.getByText("Still needs a programme name.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Save/ })).toBeDisabled();
});

test("a named but incomplete programme saves as a draft, and says what is missing", async ({
  page,
}) => {
  // Incomplete is allowed — that is what a draft IS. What is not allowed is a
  // row going in front of a student before somebody answers every one of
  // these, which is the server's own `_REQUIRED_TO_PUBLISH` list.
  await openBlank(page);
  await page.getByLabel("Programme name").fill("MSc Marine Biology");

  await expect(
    page.getByText(
      /Saves as a draft — still needs an institution, a field of study, a country, a tuition fee, at least one intake/,
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Save · as a draft/ })).toBeEnabled();
});

test("filling the gaps leaves only the requirement warning", async ({
  page,
}) => {
  await openBlank(page);

  await page.getByLabel("Programme name").fill("MSc Marine Biology");
  await page.getByLabel("Institution", { exact: true }).fill("Coastal University");
  await page.getByLabel("Field").fill("marine science");
  await page.getByLabel("Country").click();
  await page.getByRole("option", { name: /Australia/ }).click();
  await page.getByLabel("Tuition · international, per year").fill("38000");
  await page.getByRole("checkbox", { name: "September 2027" }).click();

  // Nothing missing — but it still says what an empty requirement list means,
  // because that is a decision rather than an omission.
  await expect(
    page.getByText(/this programme will match every student/),
  ).toBeVisible();
});

test("a new programme is created, then given its intakes and rules", async ({
  page,
}) => {
  const created = programmeDetail({ id: ID, status: "draft" });
  const writes = await mockProgrammeWrites(page, created);
  await mockProgrammes(page, [programme()]);

  await openBlank(page);
  await page.getByLabel("Programme name").fill("MSc Marine Biology");
  await page.getByLabel("Country").click();
  await page.getByRole("option", { name: /Australia/ }).click();
  await page.getByRole("checkbox", { name: "September 2027" }).click();
  await page.getByRole("button", { name: "Grades" }).click();
  await page.getByRole("button", { name: /Save · as a draft/ }).click();

  await expect(page).toHaveURL(/\/catalogue$/);
  expect(writes.map((w) => `${w.method} ${w.path}`)).toEqual([
    "POST /api/programmes",
    // The id comes from what POST answered, not from anything the client
    // invented.
    `PUT /api/programmes/${ID}/intakes`,
    `PUT /api/programmes/${ID}/requirements`,
  ]);
  // A create sends the whole form. `country` is the ISO code, not "Australia":
  // the server runs normalise_country and refuses anything that is not
  // already a code.
  expect(writes[0].body).toMatchObject({
    name: "MSc Marine Biology",
    country: "AU",
  });
  expect(writes[2].body).toEqual([
    {
      fact_key: "grades",
      rule: "percentage>=65",
      description: "A UK 2:1 or international equivalent (65% and above).",
      mandatory: true,
    },
  ]);
});

test("country is a list, not a free-text box", async ({ page }) => {
  // The code is matched against counsellors' owned countries to decide
  // routing and against the catalogue coverage banner. A typed "Aus" is a
  // destination nobody owns, forever.
  await openBlank(page);

  await page.getByLabel("Country").click();
  await page.getByRole("option", { name: /Sri Lanka/ }).click();
  await expect(page.getByLabel("Country")).toContainText("Sri Lanka");
});

test("a stored country the ISO list lacks stays selected", async ({ page }) => {
  // Dropping it from the options would blank the field on open, and a later
  // edit to the fee would save a country nobody touched.
  await mockProgrammeDetail(page, programmeDetail({ id: ID, country: "XK" }));

  await page.goto(`/catalogue/${ID}`);

  await expect(page.getByLabel("Country")).toContainText("XK");
});

test("requirement templates add rows, and rows can be removed", async ({
  page,
}) => {
  await openBlank(page);

  await expect(page.getByText("No entry requirements")).toBeVisible();

  await page.getByRole("button", { name: "Grades" }).click();
  await expect(page.getByText("percentage>=65")).toBeVisible();
  await expect(page.getByText("1 requirement", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Remove grades requirement/ }).click();
  await expect(page.getByText("No entry requirements")).toBeVisible();
});

test("the source URL box does not pretend to save", async ({ page }) => {
  // There is no source_url column: tuition is on the fees page, requirements
  // on the course page, intakes on an admissions page. A box that looked like
  // it saved would be worse than one that says it does not.
  await openBlank(page);

  await expect(page.getByText(/Not stored yet/)).toBeVisible();
  await expect(
    page.getByText(/excluded from the overnight refresh job/),
  ).toBeVisible();
});
