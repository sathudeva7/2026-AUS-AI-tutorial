/** The six users endpoints.
 *
 * Thin on purpose: one function per endpoint, no caching or retry logic. That
 * belongs in `queries.ts`, so these stay callable from anywhere — a script, a
 * test, a component that has good reason not to use a hook.
 */
import { get, getWithMeta, patch, post, postWithMeta, put } from "@/api/client";
import type { AvailabilityRule, Role, User, UserListResult } from "./types";

/** `GET /api/users` — the roster. Readable by any member: routing is by owned
 *  country, so a counsellor who cannot see who owns Australia cannot hand a
 *  lead to them.
 *
 *  `limit` is bounded at 100 by the backend and REFUSED above that rather than
 *  clamped, so asking for 5000 is an error rather than a wrong answer. */
export async function listUsers(
  params: {
    status?: "active" | "invited" | "deactivated" | "all";
    limit?: number;
    offset?: number;
  } = {},
): Promise<UserListResult> {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  query.set("limit", String(params.limit ?? 25));
  query.set("offset", String(params.offset ?? 0));

  const { data, meta } = await getWithMeta<User[]>(`/api/users?${query}`);
  return {
    users: data,
    total: Number(meta?.total ?? data.length),
    limit: Number(meta?.limit ?? 25),
    offset: Number(meta?.offset ?? 0),
  };
}

/** `POST /api/users/invite` — owner-only.
 *
 *  409 ALREADY_INVITED means someone else invited this address first; their
 *  invitation stands. A deactivated person is revived by the same call, on the
 *  same row, so their leads and facts survive. */
export async function inviteUser(input: {
  email: string;
  role: Role;
}): Promise<User> {
  return post<User>("/api/users/invite", input);
}

/** `PATCH /api/users/{id}` — name, work phone, timezone.
 *
 *  Only the keys passed are written. Sending a field as `null` clears it;
 *  omitting it leaves it alone. Those are different, so build the body from
 *  what the form actually changed rather than from its whole state. */
export async function patchUser(
  userId: string,
  fields: {
    name?: string | null;
    work_phone?: string | null;
    timezone?: string;
  },
): Promise<User> {
  return patch<User>(`/api/users/${userId}`, fields);
}

/** `PUT /api/users/{id}/countries` — the COMPLETE set this person owns.
 *
 *  A replace, not a diff: the screen is a multi-select, so send the whole set.
 *  Owner and manager. */
export async function setUserCountries(
  userId: string,
  countries: string[],
): Promise<User> {
  return put<User>(`/api/users/${userId}/countries`, { countries });
}

/** `GET /api/users/{id}/availability` — their week. Any member may read it:
 *  knowing when a colleague is at their desk is what makes handing a lead
 *  over possible. */
export async function getUserAvailability(
  userId: string,
): Promise<AvailabilityRule[]> {
  return get<AvailabilityRule[]>(`/api/users/${userId}/availability`);
}

/** `PUT /api/users/{id}/availability` — the complete week.
 *
 *  Self, or `users.edit` for someone else. The backend refuses overlapping
 *  windows and any shift written as crossing midnight; the grid should stop
 *  both before sending, but the server is the one that decides. */
export async function setUserAvailability(
  userId: string,
  rules: AvailabilityRule[],
): Promise<AvailabilityRule[]> {
  return put<AvailabilityRule[]>(`/api/users/${userId}/availability`, {
    rules,
  });
}

/** `POST /api/users/{id}/deactivate` — owner-only.
 *
 *  Returns the updated row AND how many of their open leads moved to the
 *  unassigned queue, which the caller should show: "Switched off Zoe. 12 leads
 *  moved to the queue." Guessing that number is not an option, which is why
 *  this one is never optimistic. */
export async function deactivateUser(
  userId: string,
): Promise<{ user: User; leadsUnassigned: number }> {
  const { data, meta } = await postWithMeta<User>(
    `/api/users/${userId}/deactivate`,
  );
  return { user: data, leadsUnassigned: Number(meta?.leads_unassigned ?? 0) };
}
