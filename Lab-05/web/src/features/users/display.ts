/** Turning a `User` row into what the roster shows.
 *
 * Pure functions, kept out of the component so they can be reasoned about —
 * and tested — without a browser.
 */
import { COUNTRY_BY_CODE } from "@/data/countries";

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

/** An owned country as a person reads it.
 *
 * The code is the unit everything else works in — it is what the column
 * stores, what `PUT /api/users/{id}/countries` takes and what the search box
 * matches — but nobody reads "LK" and thinks Sri Lanka on the first pass, and
 * a roster is read far more often than it is edited.
 *
 * An unknown code passes through unchanged rather than being dropped or
 * rendered as a dash. A country this build has never heard of is still a
 * country somebody owns, and hiding it would hide the coverage with it.
 */
export function countryName(code: string): string {
  return COUNTRY_BY_CODE[code]?.name ?? code;
}

export function countryNames(codes: string[]): string {
  return codes.map(countryName).join(", ");
}

/** What this person covers, for the line under their name.
 *
 * Countries rather than a caseload figure. The prototype showed "8 / 20 leads"
 * and no such number exists: there is no cap column and no per-week counter.
 * Owned countries decide which leads a person SEES, which is the thing this
 * screen exists to make legible.
 *
 * Returned as parts rather than one joined string. Role and coverage answer
 * different questions, so they are set apart by space in the layout instead of
 * welded together with a separator glyph.
 */
export function coverage(user: User): { role: string; countries: string } {
  return {
    role: ROLE_LABEL[user.role],
    countries: user.countries.length
      ? countryNames(user.countries)
      : "No countries",
  };
}
