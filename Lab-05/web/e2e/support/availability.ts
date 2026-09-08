/** Serving and capturing the availability endpoints. */
import type { Page } from "@playwright/test";

export interface Rule {
  day_of_week: number;
  start_time: string;
  end_time: string;
}

/** `GET /api/users/{id}/availability`. */
export async function mockAvailability(page: Page, rules: Rule[]) {
  await page.route("**/api/users/*/availability", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: rules, request_id: "req_test" }),
    });
  });
}

/** `PUT /api/users/{id}/availability`, capturing the body.
 *
 * The body is what most of these tests are about: merging runs into single
 * windows, 24:00 as an end, Sunday as day 0. None of it is visible on screen,
 * and all of it is what the endpoint accepts or refuses.
 *
 * Registered AFTER mockAvailability so Playwright tries this handler first;
 * it hands a GET back with `fallback()`.
 */
export async function mockSaveAvailability(
  page: Page,
  refuse?: { status: number; field: string; issue: string },
) {
  const sent: { rules: Rule[] }[] = [];
  await page.route("**/api/users/*/availability", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    const body = route.request().postDataJSON();
    sent.push(body);

    if (refuse) {
      await route.fulfill({
        status: refuse.status,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "The provided input contains errors.",
            details: [{ field: refuse.field, issue: refuse.issue }],
          },
          request_id: "req_test",
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: body.rules,
        request_id: "req_test",
      }),
    });
  });
  return sent;
}
