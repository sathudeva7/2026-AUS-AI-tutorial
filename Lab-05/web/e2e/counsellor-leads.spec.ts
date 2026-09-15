/** The leads panel on a counsellor's record.
 *
 * The branching is the subject. "This person has no leads" and "no lead can be
 * matched to any person on the roster" look identical if you only count rows,
 * and only one of them is a statement about a counsellor's workload. Today
 * every real run hits the second one — `GET /api/leads` answers from the demo
 * lead book, where assignments are ids like `c_001` rather than `users.id` —
 * so the branch that says so is the one most likely to be seen and the one
 * easiest to "tidy up" into a lie later.
 */
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";

import {
  lead,
  mockLeads,
  mockMe,
  mockRoster,
  stubEverythingElse,
  user,
} from "./support/roster";
import { mockAvailability } from "./support/availability";

test.beforeEach(async ({ page }) => {
  await setupClerkTestingToken({ page });
  await stubEverythingElse(page);
  await mockMe(page);
  await mockAvailability(page, []);
});

test("shows the leads assigned to this counsellor, and not anyone else's", async ({
  page,
}) => {
  const anita = user({ name: "Anita Silva", countries: ["LK"] });
  const priya = user({ name: "Priya Fernando", countries: ["GB"] });
  await mockRoster(page, [anita, priya]);
  await mockLeads(page, [
    lead({
      name: "Ravi Menon",
      status: "escalated",
      assigned_counsellor_id: anita.id,
      country_of_residence: "India",
      facts: { target_country: "UK" },
    }),
    lead({ name: "Aisha Khan", assigned_counsellor_id: anita.id }),
    lead({ name: "Someone Else", assigned_counsellor_id: priya.id }),
  ]);

  await page.goto("/counsellors");
  await page.getByRole("button", { name: /Anita Silva/ }).click();

  const leads = page.getByRole("list", { name: "Assigned leads" });
  await expect(leads.getByText("Ravi Menon")).toBeVisible();
  await expect(leads.getByText("Aisha Khan")).toBeVisible();
  await expect(leads.getByText("Someone Else")).toHaveCount(0);

  // Where they live and where they want to study are different facts, and the
  // panel shows the journey rather than collapsing it to one country.
  await expect(leads.getByText("India → UK")).toBeVisible();
  // Escalated first: it is the one that means somebody must ring the student.
  await expect(leads.getByText("Escalated")).toBeVisible();
  await expect(page.getByText("2 total · 2 open")).toBeVisible();
});

test("a counsellor with none of the assigned leads is told just that", async ({
  page,
}) => {
  const anita = user({ name: "Anita Silva" });
  const priya = user({ name: "Priya Fernando" });
  await mockRoster(page, [anita, priya]);
  // Assignments DO name roster users, so an empty result for Anita is a true
  // statement about Anita.
  await mockLeads(page, [
    lead({ name: "Ravi Menon", assigned_counsellor_id: priya.id }),
  ]);

  await page.goto("/counsellors");
  await page.getByRole("button", { name: /Anita Silva/ }).click();

  await expect(page.getByText("No leads assigned")).toBeVisible();
  await expect(page.getByText(/Nothing is routed to Anita Silva/)).toBeVisible();
});

test("an empty lead book says so without blaming the counsellor", async ({
  page,
}) => {
  await mockRoster(page, [user({ name: "Anita Silva" })]);
  await mockLeads(page, []);

  await page.goto("/counsellors");

  await expect(page.getByText("No leads yet")).toBeVisible();
  await expect(page.getByText(/once students start reaching the agent/)).toBeVisible();
});

test("assignments in a different id space are reported, NOT shown as an empty caseload", async ({
  page,
}) => {
  // This is what a real run hits today. Every lead names "c_001", which is a
  // counsellor in the demo lead book and nobody in the users table. Drawing
  // that as "no leads assigned" would be a false claim about every counsellor
  // in the agency, on a screen whose whole argument is that it only shows
  // things that are true.
  await mockRoster(page, [user({ name: "Anita Silva" })]);
  await mockLeads(page, [
    lead({ name: "Ravi Menon", assigned_counsellor_id: "c_001" }),
    lead({ name: "Aisha Khan", assigned_counsellor_id: "c_002" }),
  ]);

  await page.goto("/counsellors");

  await expect(
    page.getByText("Leads cannot be matched to the roster yet"),
  ).toBeVisible();
  await expect(page.getByText(/All 2 assigned leads name/)).toBeVisible();
  await expect(page.getByText("No leads assigned")).toHaveCount(0);
});

test("one stale assignment does not hide everybody's real leads", async ({
  page,
}) => {
  // A lead still pointing at a departed colleague is ordinary. Only ALL of
  // them pointing somewhere unknown means the two id spaces do not line up,
  // and treating the first as the second would blank a working panel.
  const anita = user({ name: "Anita Silva" });
  await mockRoster(page, [anita]);
  await mockLeads(page, [
    lead({ name: "Ravi Menon", assigned_counsellor_id: anita.id }),
    lead({ name: "Old Assignment", assigned_counsellor_id: "c_001" }),
  ]);

  await page.goto("/counsellors");

  await expect(
    page.getByRole("list", { name: "Assigned leads" }).getByText("Ravi Menon"),
  ).toBeVisible();
  await expect(
    page.getByText("Leads cannot be matched to the roster yet"),
  ).toHaveCount(0);
});

test("a dead lead book fails loudly rather than reading as an empty caseload", async ({
  page,
}) => {
  await mockRoster(page, [user({ name: "Anita Silva" })]);
  await page.route("**/api/leads*", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        success: false,
        error: { code: "INTERNAL_ERROR", message: "Something went wrong on our end." },
      }),
    }),
  );

  await page.goto("/counsellors");

  await expect(page.getByText("No leads yet")).toHaveCount(0);
  await expect(page.getByText(/Something went wrong on our end/)).toBeVisible();
});
