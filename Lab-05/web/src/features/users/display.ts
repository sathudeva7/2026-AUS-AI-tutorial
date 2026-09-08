/** Turning a `User` row into what the roster shows.
 *
 * Pure functions, kept out of the component so they can be reasoned about —
 * and tested — without a browser.
 */
import type { User } from "./types";

/** What to call someone.
 *
 * An invited person has no name yet: the invite knew only an address, and the
 * name arrives from Clerk when they accept. Showing "—" would lose the one
 * piece of identifying information there is, so the address stands in.
 */
export function displayName(user: User): string {
  return user.name?.trim() || user.email;
}

/** Two letters for the avatar. Falls back to the email's first letters when
 *  there is no name, so an invited row is not a blank circle. */
export function displayInitials(user: User): string {
  const source = user.name?.trim() || user.email.split("@")[0] || "";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
  return letters.toUpperCase() || "—";
}

export const ROLE_LABEL: Record<User["role"], string> = {
  counsellor: "Counsellor",
  manager: "Manager",
  owner: "Owner",
};

export const STATUS_LABEL: Record<User["status"], string> = {
  active: "Active",
  invited: "Invited",
  deactivated: "Deactivated",
};

/** Roster line under the name: role, then who they route for.
 *
 * Countries rather than a caseload figure. The prototype showed "8 / 20 leads"
 * and there is no such number in the database — a cap was never built. Owned
 * countries decide which leads this person SEES, which is the thing the
 * screen exists to make legible.
 */
export function coverageLine(user: User): string {
  const role = ROLE_LABEL[user.role];
  if (!user.countries.length) return `${role} · no countries`;
  return `${role} · ${user.countries.join(", ")}`;
}
