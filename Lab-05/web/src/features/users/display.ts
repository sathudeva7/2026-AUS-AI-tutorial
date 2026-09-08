/** Turning a `User` row into what the roster shows.
 *
 * Pure functions, kept out of the component so they can be reasoned about —
 * and tested — without a browser.
 */
import { COUNTRIES } from "@/data/countries";

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
      ? user.countries.join(", ")
      : "No countries",
  };
}

/** The catalogue names a country ("Australia", "UK"); a user owns a code
 *  ("AU", "GB"). Comparing the two directly never matches, so every catalogued
 *  destination reads as unowned even when somebody owns it — the alarm this
 *  screen exists to raise, stuck permanently on.
 *
 *  Aliases cover the names the catalogue uses that are not the official ones.
 *  Fixture-only: `programmes` has no live endpoint yet, and when it gets one it
 *  should return codes so this can go.
 */
const CODE_BY_NAME: Record<string, string> = {
  ...Object.fromEntries(COUNTRIES.map((c) => [c.name.toLowerCase(), c.code])),
  uk: "GB",
  usa: "US",
  "united states of america": "US",
};

/** A catalogue country name as an ISO code, or the input unchanged when it is
 *  already one. Unknown names pass through so they still show as a gap rather
 *  than vanishing — an uncatalogued destination nobody owns is worth seeing. */
export function toCountryCode(nameOrCode: string): string {
  const trimmed = nameOrCode.trim();
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  return CODE_BY_NAME[trimmed.toLowerCase()] ?? trimmed;
}
