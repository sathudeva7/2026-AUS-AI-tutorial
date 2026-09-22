/** Serving a catalogue without a backend.
 *
 * The mock PAGES AND FILTERS for real. A stub that returned every row
 * regardless of the query string would make "Showing 11–15 of 15" pass
 * against a screen that never sent an offset — and server-side paging is
 * exactly what changed here, so it is the thing worth testing.
 */
import type { Page } from "@playwright/test";

export interface TestProgramme {
  id: string;
  name: string;
  institution: string | null;
  institution_id: string | null;
  level: string | null;
  field: string | null;
  country: string | null;
  city: string | null;
  tuition_per_year_minor: number | null;
  currency: string | null;
  duration_months: number | null;
  status: "draft" | "published" | "archived";
  verified_at: string | null;
  edited_since_verified: boolean;
  next_intake: string | null;
  next_deadline: string | null;
  created_at: string;
  updated_at: string;
}

let seq = 0;

export function programme(overrides: Partial<TestProgramme> = {}): TestProgramme {
  seq += 1;
  return {
    id: `00000000-0000-4000-9000-${String(seq).padStart(12, "0")}`,
    name: `MSc Programme ${seq}`,
    institution: "Camden Metropolitan University",
    institution_id: "00000000-0000-4000-a000-000000000001",
    level: "masters",
    field: "data science",
    country: "GB",
    city: "London",
    tuition_per_year_minor: 2450000,
    currency: "GBP",
    duration_months: 12,
    status: "published",
    // Yesterday, so the default rows read as Active rather than stale.
    verified_at: new Date(Date.now() - 86_400_000).toISOString(),
    edited_since_verified: false,
    next_intake: "2027-09",
    next_deadline: "2027-06-30",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const STALE_AFTER_DAYS = 30;

function isStale(p: TestProgramme): boolean {
  if (!p.verified_at) return true;
  const days = (Date.now() - new Date(p.verified_at).getTime()) / 86_400_000;
  return days > STALE_AFTER_DAYS;
}

/** Serve `GET /api/programmes`, applying the query the screen actually sent.
 *
 * Returns the captured requests so a test can assert that a filter reached the
 * server rather than being applied in the browser — the difference between a
 * catalogue of fifteen and a catalogue of fifteen thousand.
 */
export async function mockProgrammes(page: Page, rows: TestProgramme[]) {
  const requests: URLSearchParams[] = [];

  await page.route("**/api/programmes?*", async (route) => {
    const url = new URL(route.request().url());
    const q = url.searchParams;
    requests.push(q);

    const search = (q.get("search") ?? "").toLowerCase();
    const country = q.get("country") ?? "";
    const status = q.get("status") ?? "";
    const limit = Number(q.get("limit") ?? 25);
    const offset = Number(q.get("offset") ?? 0);

    const visible = rows.filter((p) => {
      if (status === "archived") return p.status === "archived";
      if (p.status === "archived") return false;
      if (status === "draft") return p.status === "draft";
      if (status === "stale") return p.status === "published" && isStale(p);
      if (status === "active") return p.status === "published" && !isStale(p);
      return true;
    });

    const matched = visible.filter((p) => {
      if (country && p.country !== country) return false;
      if (!search) return true;
      return [p.name, p.institution].some((f) =>
        (f ?? "").toLowerCase().includes(search),
      );
    });

    const live = rows.filter((p) => p.status !== "archived");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: matched.slice(offset, offset + limit),
        meta: {
          limit,
          offset,
          total: matched.length,
          counts: {
            all: live.length,
            active: live.filter((p) => p.status === "published" && !isStale(p))
              .length,
            stale: live.filter((p) => p.status === "published" && isStale(p))
              .length,
            draft: live.filter((p) => p.status === "draft").length,
            archived: rows.filter((p) => p.status === "archived").length,
            institutions: new Set(live.map((p) => p.institution)).size,
            countries: new Set(live.map((p) => p.country)).size,
          },
          countries: [...new Set(live.map((p) => p.country))]
            .filter(Boolean)
            .sort() as string[],
          stale_after_days: STALE_AFTER_DAYS,
        },
        request_id: "req_test",
      }),
    });
  });

  return requests;
}

/** Serve a failure in the envelope the backend uses for one. */
export async function mockProgrammesFailure(page: Page, status = 500) {
  await page.route("**/api/programmes?*", (route) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify({
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Something went wrong on our end.",
        },
        request_id: "req_test",
      }),
    }),
  );
}

/** `POST /api/programmes/{id}/archive` and `/duplicate`, capturing the calls. */
export async function mockProgrammeActions(
  page: Page,
  respondWith: (id: string, action: string) => TestProgramme,
) {
  const calls: { id: string; action: string }[] = [];
  await page.route("**/api/programmes/*/{archive,duplicate}", async (route) => {
    const parts = new URL(route.request().url()).pathname.split("/");
    const action = parts.pop() ?? "";
    const id = parts.pop() ?? "";
    calls.push({ id, action });
    await route.fulfill({
      status: action === "duplicate" ? 201 : 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: respondWith(id, action),
        request_id: "req_test",
      }),
    });
  });
  return calls;
}

export interface TestIntake {
  intake: string;
  application_deadline: string | null;
  is_open: boolean;
}

export interface TestRequirement {
  id?: string;
  fact_key: string;
  rule: string;
  description: string;
  mandatory: boolean;
}

export interface TestProgrammeDetail extends TestProgramme {
  intakes: TestIntake[];
  requirements: TestRequirement[];
}

export function programmeDetail(
  overrides: Partial<TestProgrammeDetail> = {},
): TestProgrammeDetail {
  const { intakes, requirements, ...row } = overrides;
  return {
    ...programme(row),
    intakes: intakes ?? [
      { intake: "2027-09", application_deadline: "2027-06-30", is_open: true },
    ],
    requirements: requirements ?? [
      {
        id: "00000000-0000-4000-b000-000000000001",
        fact_key: "grades",
        rule: "percentage>=65",
        description: "A UK 2:1 or international equivalent (65% and above).",
        mandatory: true,
      },
    ],
  };
}

/** Serve `GET /api/programmes/{id}` — what the editor opens over.
 *
 * Registered on the bare id path so it does not swallow `/archive`,
 * `/verify`, `/intakes` or `/requirements`, which are their own routes.
 */
export async function mockProgrammeDetail(
  page: Page,
  detail: TestProgrammeDetail,
) {
  await page.route(
    (url) => /\/api\/programmes\/[^/?]+$/.test(url.pathname),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: detail,
          request_id: "req_test",
        }),
      });
    },
  );
}

/** Refuse the detail read, in the envelope the backend uses for one. */
export async function mockProgrammeDetailFailure(page: Page, status = 500) {
  await page.route(
    (url) => /\/api\/programmes\/[^/?]+$/.test(url.pathname),
    (route) =>
      route.request().method() === "GET"
        ? route.fulfill({
            status,
            contentType: "application/json",
            body: JSON.stringify({
              success: false,
              error: {
                code: "INTERNAL_ERROR",
                message: "Something went wrong on our end.",
              },
              request_id: "req_test",
            }),
          })
        : route.fallback(),
  );
}

export interface CapturedWrite {
  method: string;
  path: string;
  body: unknown;
}

/** Capture what the editor's save actually sends.
 *
 * All three calls, in order: the row, then the whole intake set, then the
 * whole requirement set. The ORDER and the BODIES are the point — a save that
 * PATCHes the row and silently drops a removed intake looks identical on
 * screen.
 */
export async function mockProgrammeWrites(
  page: Page,
  detail: TestProgrammeDetail,
) {
  const writes: CapturedWrite[] = [];
  await page.route(
    (url) => /\/api\/programmes(\/[^/?]+(\/intakes|\/requirements)?)?$/
      .test(url.pathname),
    async (route) => {
      const request = route.request();
      const method = request.method();
      if (method === "GET") return route.fallback();
      writes.push({
        method,
        path: new URL(request.url()).pathname,
        body: request.postDataJSON() as unknown,
      });
      await route.fulfill({
        status: method === "POST" ? 201 : 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: detail,
          request_id: "req_test",
        }),
      });
    },
  );
  return writes;
}
