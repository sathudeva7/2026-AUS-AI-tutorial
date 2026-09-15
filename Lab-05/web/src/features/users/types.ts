/** What the users endpoints return. Mirrors `UserOut` in
 *  `student_agent/api/users.py`; keep the two in step. */

export type Role = "counsellor" | "manager" | "owner";
type UserStatus = "active" | "invited" | "deactivated";

export interface User {
  id: string;
  name: string | null;
  email: string;
  role: Role;
  status: UserStatus;
  timezone: string;
  /** A product contact, not HR: the number a colleague rings about an
   *  escalation, which is why every member can see it. */
  work_phone: string | null;
  /** ISO 3166-1 alpha-2. Routing ownership, not where they live. */
  countries: string[];
  /** Their profile photo, hosted by Clerk and resolved per request — not a
   *  column, and never stored here. Null when nobody has uploaded one, or
   *  when they are invited and have no Clerk account yet. Render initials. */
  image_url: string | null;
  invited_at: string | null;
  accepted_at: string | null;
  created_at: string;
}

/** One recurring window, in this person's own wall clock — read against
 *  `user.timezone`, never the viewer's. */
export interface AvailabilityRule {
  /** 0 = Sunday .. 6 = Saturday, matching the database CHECK and JS
   *  getDay(). The grid renders Monday first; that is a display order and
   *  not this number. Conflating the two is the classic bug here. */
  day_of_week: number;
  /** "HH:MM", 24-hour. "24:00" is a legal end and means midnight. */
  start_time: string;
  end_time: string;
}

/** The query half of `GET /api/users`.
 *
 * Named, because two components ask for the roster on this screen and they
 * have to ask for the SAME one — react-query keys on these values, so a
 * mismatch is two cache entries, two requests, and two answers that can
 * disagree. A shared type does not enforce that, but it makes the shape
 * something you pass around rather than retype. */
export interface UserListParams {
  status?: "active" | "invited" | "deactivated" | "all";
  limit?: number;
  offset?: number;
}

export interface UserListResult {
  users: User[];
  total: number;
  limit: number;
  offset: number;
}
