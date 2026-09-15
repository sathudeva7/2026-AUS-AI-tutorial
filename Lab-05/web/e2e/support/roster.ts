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
  /** Clerk's, resolved per request by the API. Null is the common case. */
  image_url?: string | null;
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
    image_url: null,
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

/** `GET /api/me` — who the viewer is and what they may do.
 *
 * Mocked so a test can state the permission it is about. Left to the real
 * backend, "can this person see the Edit button" would depend on which Clerk
 * account signed in and what the database says about them today — a test that
 * passes or fails for reasons nothing to do with the code under test.
 */
export async function mockMe(
  page: Page,
  me: { user_id?: string; role?: string; permissions?: string[] } = {},
) {
  await page.route("**/api/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          tenant_id: "tst_A",
          user_id: me.user_id ?? "00000000-0000-4000-8000-999999999999",
          role: me.role ?? "owner",
          permissions: me.permissions ?? [
            "users.edit",
            "users.invite",
            "users.countries.manage",
            "users.deactivate",
          ],
        },
        request_id: "req_test",
      }),
    }),
  );
}

/** Serve `PATCH /api/users/{id}` and capture what the form actually sent.
 *
 * The body is the point: "only the fields that changed" is the endpoint's
 * contract and is completely invisible from the screen. A form that helpfully
 * sends all three fields every time looks identical to a correct one until
 * two people edit the same person.
 */
export async function mockPatchUser(
  page: Page,
  respondWith: (body: any) => TestUser,
) {
  const sent: any[] = [];
  await page.route("**/api/users/*", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    const body = route.request().postDataJSON();
    sent.push(body);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: respondWith(body),
        request_id: "req_test",
      }),
    });
  });
  return sent;
}

/** Refuse a PATCH the way the backend refuses one, naming the field. */
export async function mockPatchUserFieldError(
  page: Page,
  field: string,
  issue: string,
) {
  await page.route("**/api/users/*", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({
        success: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "The provided input contains errors.",
          details: [{ field, issue }],
        },
        request_id: "req_test",
      }),
    });
  });
}

/** `PUT /api/users/{id}/countries`, capturing the body.
 *
 * The body is the point. The endpoint takes the COMPLETE set a person owns,
 * not a diff, so adding one country means sending the other four back with
 * it — and a screen that sends only the new one silently deletes the rest.
 * Nothing on screen distinguishes the two until the roster reloads.
 */
export async function mockSetCountries(
  page: Page,
  respondWith: (countries: string[]) => TestUser,
) {
  const sent: string[][] = [];
  await page.route("**/api/users/*/countries", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    const body = route.request().postDataJSON();
    sent.push(body.countries);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: respondWith(body.countries),
        request_id: "req_test",
      }),
    });
  });
  return sent;
}

/** `POST /api/users/invite`, capturing what was sent.
 *
 * The body is the contract: an address and a role, and nothing else. The form
 * this replaced collected ten fields and posted one of them, so "what did the
 * submit actually send" is the assertion worth having.
 */
export async function mockInvite(
  page: Page,
  respondWith: (body: { email: string; role: string }) => TestUser,
) {
  const sent: { email: string; role: string }[] = [];
  await page.route("**/api/users/invite", async (route) => {
    const body = route.request().postDataJSON();
    sent.push(body);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: respondWith(body),
        request_id: "req_test",
      }),
    });
  });
  return sent;
}

/** Refuse an invitation the way the backend refuses one. */
export async function mockInviteRefused(
  page: Page,
  status: number,
  code: string,
  message: string,
) {
  await page.route("**/api/users/invite", (route) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify({
        success: false,
        error: { code, message },
        request_id: "req_test",
      }),
    }),
  );
}

export interface TestLead {
  lead_id: string;
  name: string | null;
  email: string;
  country_of_residence: string | null;
  status: "active" | "parked" | "escalated" | "withdrawn" | "converted";
  assigned_counsellor_id: string | null;
  facts: Record<string, string | number>;
  missing: string[];
}

export function lead(overrides: Partial<TestLead> = {}): TestLead {
  seq += 1;
  return {
    lead_id: `lead_${String(seq).padStart(3, "0")}`,
    name: "Ravi Menon",
    email: `student${seq}@example.com`,
    country_of_residence: "India",
    status: "active",
    assigned_counsellor_id: null,
    facts: {},
    missing: [],
    ...overrides,
  };
}

/** `GET /api/leads` — the lead book.
 *
 * Registered before `stubEverythingElse`'s catch-all, and Playwright tries
 * the most recently registered route first, so call this AFTER it to win.
 */
export async function mockLeads(page: Page, leads: TestLead[]) {
  await page.route("**/api/leads*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { leads, count: leads.length },
        request_id: "req_test",
      }),
    }),
  );
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
