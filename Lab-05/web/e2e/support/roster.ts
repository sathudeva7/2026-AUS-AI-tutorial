/** Building rosters for tests, and serving them without a backend.
 *
 * Every response goes out in the API's envelope. Hand-writing that shape per
 * test invites a test that passes against something the backend never sends.
 */
import type { Page } from "@playwright/test";

export interface TestUser {
  id: string;
  name: string | null;
  email: string;
  role: "counsellor" | "manager" | "owner";
  status: "active" | "invited" | "deactivated";
  timezone: string;
  work_phone: string | null;
  countries: string[];
  invited_at: string | null;
  accepted_at: string | null;
  created_at: string;
}

let seq = 0;

export function user(overrides: Partial<TestUser> = {}): TestUser {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    name: "Priya Fernando",
    email: `person${seq}@agency.test`,
    role: "counsellor",
    status: "active",
    timezone: "Asia/Colombo",
    work_phone: null,
    countries: [],
    invited_at: null,
    accepted_at: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Serve a roster, and count how many times it was asked for.
 *
 * The counter is the whole point of one test: the screen this replaces
 * fetched a profile per person on top of the list, which was free against
 * fixtures and would have been 41 requests for a 40-person agency.
 */
export async function mockRoster(
  page: Page,
  users: TestUser[],
  opts: { total?: number; delayMs?: number } = {},
) {
  const calls = { count: 0 };
  await page.route("**/api/users?*", async (route) => {
    calls.count += 1;
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: users,
        meta: { limit: 25, offset: 0, total: opts.total ?? users.length },
        request_id: "req_test",
      }),
    });
  });
  return calls;
}

/** Serve a failure, in the same envelope the backend uses for one. */
export async function mockRosterFailure(
  page: Page,
  status: number,
  code = "INTERNAL_ERROR",
) {
  await page.route("**/api/users?*", async (route) => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify({
        success: false,
        error: { code, message: "Something went wrong on our end." },
        request_id: "req_test",
      }),
    });
  });
}

/** The catalogue read the roster page makes to work out which destinations
 *  have no active owner. Fixture-backed in the app today, but stubbing it
 *  keeps these tests about the roster. */
export async function stubEverythingElse(page: Page) {
  await page.route("**/api/leads*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { leads: [] } }),
    }),
  );
}
