/** Signs in once; every other test reuses the session from disk.
 *
 * Signing in per test would triple the suite's runtime and hammer Clerk for
 * no extra coverage — the sign-in flow is Clerk's code, and testing it here
 * would be testing their product rather than ours.
 *
 * A sign-in TICKET, not a password. Client Trust is enabled on this instance:
 * a password sign-in from an unrecognised device comes back
 * `needs_client_trust` and waits for an emailed code. Playwright is a new
 * device every single run, so password sign-in can never complete here — and
 * it fails silently, because @clerk/testing's password branch calls
 * `setActive({ session: res.createdSessionId })` without checking the status
 * first, so a null session id is applied as "signed out" and nothing throws.
 *
 * Client Trust applies only to passwords. A ticket is passwordless, so it is
 * unaffected — and it needs no dashboard change, no dedicated test account,
 * and no password stored on disk.
 */
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { test as setup, expect } from "@playwright/test";

const SESSION_FILE = "e2e/.auth/user.json";
const CLERK_API = "https://api.clerk.com/v1";

async function clerkApi<T = any>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${CLERK_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new Error(
      `Clerk ${init?.method ?? "GET"} ${path} failed (${response.status}): ` +
        `${(await response.text()).slice(0, 300)}`,
    );
  }
  return (await response.json()) as T;
}

setup("sign in", async ({ page }) => {
  const identifier = process.env.E2E_CLERK_USER_USERNAME;
  if (!identifier) {
    throw new Error(
      "Set E2E_CLERK_USER_USERNAME in web/.env.test (see .env.test.example). " +
        "It must be a Clerk user who belongs to an organization, or the " +
        "console redirects to /create-agency and no test reaches the roster.",
    );
  }
  if (!process.env.CLERK_SECRET_KEY) {
    throw new Error("CLERK_SECRET_KEY is missing; it is read from Lab-05/.env.");
  }

  // Resolve the id from the address, so .env.test holds something a person can
  // read and recognise rather than a user_ opaque string.
  const users = await clerkApi<{ id: string }[]>(
    `/users?email_address=${encodeURIComponent(identifier)}`,
  );
  const userId = users?.[0]?.id;
  if (!userId) throw new Error(`No Clerk user with email ${identifier}.`);

  // An organization is required: without one, RequireAuth sends the browser to
  // /create-agency and every roster test fails somewhere far from the cause.
  const memberships = await clerkApi<{ data: unknown[] }>(
    `/users/${userId}/organization_memberships?limit=1`,
  );
  if (!memberships?.data?.length) {
    throw new Error(
      `${identifier} belongs to no organization. Add them to one in the Clerk ` +
        "dashboard, or the console will redirect to /create-agency.",
    );
  }

  // Short-lived and single-use.
  const { token } = await clerkApi<{ token: string }>("/sign_in_tokens", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, expires_in_seconds: 300 }),
  });

  await setupClerkTestingToken({ page });

  // /widget, not /login: Clerk has to be loaded for a programmatic sign-in,
  // and both load it — but /login also mounts Clerk's own <SignIn> component,
  // which runs its own flow alongside this one.
  await page.goto("/widget");
  await clerk.loaded({ page });

  await clerk.signIn({ page, signInParams: { strategy: "ticket", ticket: token } });

  // Prove the session is real before saving it.
  //
  // Checking the URL is not enough: `goto` lands on /counsellors and the
  // client-side redirect to /login happens a frame later, so a URL assertion
  // passes against a signed-OUT browser and writes a useless session file.
  // Waiting for something only the protected page renders is the check that
  // actually tells the two apart.
  await page.goto("/counsellors");
  await expect(page.getByRole("heading", { name: "Counsellors" })).toBeVisible({
    timeout: 15_000,
  });

  await page.context().storageState({ path: SESSION_FILE });
});
