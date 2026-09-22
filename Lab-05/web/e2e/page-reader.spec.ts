/** The read road: paste a course page, and the form fills from it.
 *
 * The file `programme-editor.spec.ts` says has its own place. That one takes
 * the manual fork every time; this one takes the other.
 *
 * What is worth asserting here is not that boxes get filled. It is that
 * NOTHING arrives without the line it came from, and that the two things the
 * reader is not allowed to decide stay undecided: an intake whose year the
 * page never gave, and an entry requirement, which reaches the screen as
 * prose a person has to act on rather than a rule that quietly joins the set.
 */
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";

import {
  extraction,
  mockPageRead,
  mockPageReadFailure,
  sourced,
} from "./support/catalogue";
import { mockMe, stubEverythingElse } from "./support/roster";

test.beforeEach(async ({ page }) => {
  await setupClerkTestingToken({ page });
  await stubEverythingElse(page);
  await mockMe(page);
});

async function readPage(page: import("@playwright/test").Page) {
  await page.goto("/catalogue/new");
  await page
    .getByLabel("Course page address")
    .fill("https://www.bristol.ac.uk/study/postgraduate/taught/msc-data-science/");
  await page.getByRole("button", { name: "Read page" }).click();
}

// ---------------------------------------------------------------------------
// What lands in the form
// ---------------------------------------------------------------------------

test("a read page fills the form with what the server converted", async ({
  page,
}) => {
  await mockPageRead(page, extraction());
  await readPage(page);

  await expect(page.getByLabel("Programme name")).toHaveValue(
    "MSc Data Science",
  );
  // "masters" and "GB", not "MSc" and "United Kingdom". The server converts;
  // a client that did it again would be a second opinion nobody can see.
  await expect(page.getByLabel("Institution")).toHaveValue(
    "University of Bristol",
  );
  await expect(page.getByLabel(/^Tuition/)).toHaveValue("37900");
});

test("the line each value came from is on screen", async ({ page }) => {
  await mockPageRead(page, extraction());
  await readPage(page);

  // Without this the counsellor is confirming a model's word for a fee, and
  // the whole review step is theatre.
  await expect(page.getByText("Overseas: £37,900 per year").first()).toBeVisible();
});

test("a field the page did not state is left empty", async ({ page }) => {
  // City is `absent` in the fixture: the page named a campus, not a city.
  // Filling it from anywhere else is the invention this design refuses.
  await mockPageRead(page, extraction());
  await readPage(page);

  await expect(page.getByLabel("City")).toHaveValue("");
});

// ---------------------------------------------------------------------------
// The two things the reader may not decide
// ---------------------------------------------------------------------------

test("an intake with no year cannot be added", async ({ page }) => {
  await mockPageRead(
    page,
    extraction({
      intakes: [
        {
          month: "September",
          year: null,
          application_deadline: null,
          intake: null,
          deadline_date: null,
          evidence: "unclear",
          quote: "Start date: September",
          section: null,
        },
      ],
    }),
  );
  await readPage(page);

  await expect(page.getByText(/gave no year/i)).toBeVisible();
  // The column is a month. Picking one for the counsellor would put a
  // deadline on screen that nobody published.
  await expect(page.getByRole("button", { name: "Add" })).toBeDisabled();
});

test("an intake the page dated can be added", async ({ page }) => {
  await mockPageRead(
    page,
    extraction({
      intakes: [
        {
          month: "September",
          year: "2027",
          application_deadline: "12 August 2027",
          intake: "2027-09",
          deadline_date: "2027-08-12",
          evidence: "quoted",
          quote: "Start date: September 2027",
          section: null,
        },
      ],
    }),
  );
  await readPage(page);

  await expect(page.getByRole("button", { name: "Add" })).toBeEnabled();
});

test("entry requirements arrive as notes, and say they are not saved", async ({
  page,
}) => {
  await mockPageRead(
    page,
    extraction({
      requirements: [
        {
          text: "A 2:1 honours degree in a numerate subject",
          quote: "You will typically need a 2:1 honours degree",
          section: "Entry requirements",
          evidence: "quoted",
        },
        // No threshold form at all, and exactly why these stay prose.
        {
          text: "A portfolio of prior work",
          quote: "A portfolio of prior work",
          section: "Entry requirements",
          evidence: "quoted",
        },
      ],
    }),
  );
  await readPage(page);

  await expect(
    page.getByText("A 2:1 honours degree in a numerate subject"),
  ).toBeVisible();
  await expect(page.getByText("A portfolio of prior work")).toBeVisible();

  // The sentence that stops somebody saving and wondering where they went.
  await expect(page.getByText(/not saved/i)).toBeVisible();

  // And no way to accept one: they carry no fact_key and no rule, so there
  // is nothing to put in the grid and nowhere in the table for them to go.
  await expect(page.getByRole("button", { name: "Add" })).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// When the read fails
// ---------------------------------------------------------------------------

test("a page that cannot be read is blamed on the link", async ({ page }) => {
  await mockPageReadFailure(page, {
    status: 422,
    code: "VALIDATION_FAILED",
    message: "The provided input contains errors.",
    issue: "could not read that page: CRAWL_NOT_FOUND (page returned 404)",
  });
  await readPage(page);

  // The server's own sentence, not one this component invented — it knows
  // what went wrong and the client does not.
  await expect(page.getByText(/CRAWL_NOT_FOUND/)).toBeVisible();
  await expect(page.getByLabel("Course page address")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
});

test("an outage is not blamed on the link", async ({ page }) => {
  await mockPageReadFailure(page);
  await readPage(page);

  // The server's sentence for a 502, not one invented here. The offer is
  // "try again", which is a different offer from "fix your link".
  await expect(
    page.getByText("Could not reach the page reader. Try again in a moment."),
  ).toBeVisible();
  // A perfectly good url must not be marked wrong because our reader is down.
  await expect(page.getByLabel("Course page address")).not.toHaveAttribute(
    "aria-invalid",
    "true",
  );
});

test("a refusal says what the server refused, not that it is down", async ({
  page,
}) => {
  // The bug this test exists for: a 403 carries `details`, so the HTTP layer
  // read it as a validation error about a field no form has, and the screen
  // fell through to the outage wording. The reader was never down, and the
  // retry that wording invites could not have worked.
  await mockPageReadFailure(page, {
    status: 403,
    code: "MISSING_PERMISSION",
    message: "You do not have permission to do that.",
    issue: "catalogue.write",
    field: "permission",
  });
  await readPage(page);

  await expect(
    page.getByText("You do not have permission to do that."),
  ).toBeVisible();
  await expect(page.getByText(/unavailable|could not reach/i)).toHaveCount(0);
  // The link was fine. Only what the account may do was not.
  await expect(page.getByLabel("Course page address")).not.toHaveAttribute(
    "aria-invalid",
    "true",
  );
});

test("a failed read leaves the manual road open", async ({ page }) => {
  await mockPageReadFailure(page);
  await readPage(page);

  await page.getByRole("button", { name: "Fill it in by hand" }).click();
  await expect(page.getByLabel("Programme name")).toBeVisible();
});

test("nothing is read until the button is pressed", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/programmes/read", (route) => {
    calls += 1;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: extraction(),
        request_id: "req_test",
      }),
    });
  });

  // Each read costs the agency two paid calls. Typing must not start one.
  await page.goto("/catalogue/new");
  await page.getByLabel("Course page address").fill("https://example.ac.uk/x");
  await expect(page.getByRole("button", { name: "Read page" })).toBeEnabled();
  expect(calls).toBe(0);
});

test("a value the server could not convert keeps its quote", async ({
  page,
}) => {
  // "Tuition: please contact us" is not a fee. The box empties, the evidence
  // drops to unclear, and the sentence stays — the counsellor decides.
  await mockPageRead(
    page,
    extraction({
      fields: {
        ...extraction().fields,
        tuition_per_year: sourced(
          null,
          "unclear",
          "Tuition: please contact the admissions office",
        ),
      },
    }),
  );
  await readPage(page);

  await expect(page.getByLabel(/^Tuition/)).toHaveValue("");
  await expect(
    page.getByText("Tuition: please contact the admissions office"),
  ).toBeVisible();
});


// ---------------------------------------------------------------------------
// The fallback, for pages that block direct reading
// ---------------------------------------------------------------------------

test("a researched page says it was not quoted", async ({ page }) => {
  // The screen must distinguish these. A researched reading has the same
  // boxes and the same confirm ticks as a quoted one and is a weaker claim:
  // nothing was checked against the page, because the page refused to be
  // fetched. A counsellor confirming it has to know which they are doing.
  await mockPageRead(
    page,
    extraction({
      researched: true,
      fields: {
        ...extraction().fields,
        duration_months: {
          value: "12",
          evidence: "unclear",
          // The observed case: a Kingston url whose duration came off a
          // third-party listings site.
          quote: "Researched from prospects.ac.uk",
          section: "⚠ prospects.ac.uk, not bristol.ac.uk",
        },
      },
    }),
  );
  await readPage(page);

  await expect(page.getByText(/blocks direct reading/i)).toBeVisible();
  await expect(page.getByText(/researched rather than quoted/i)).toBeVisible();
  // And the field that came from elsewhere says where, in the place the
  // form already shows a quote's origin.
  await expect(page.getByText(/prospects\.ac\.uk, not bristol\.ac\.uk/)).toBeVisible();
});

test("an ordinary read shows no such warning", async ({ page }) => {
  await mockPageRead(page, extraction());
  await readPage(page);

  await expect(page.getByText(/blocks direct reading/i)).toHaveCount(0);
});
