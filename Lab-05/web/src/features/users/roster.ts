/** Searching, filtering and ordering the roster.
 *
 * All client-side, and deliberately so. The whole roster arrives in one
 * request — `GET /api/users` returns the table with `countries` inline — so
 * narrowing it is a pass over an array that is already in memory. Sending a
 * request per keystroke to re-sort forty rows would be slower, would flicker,
 * and would need debouncing and cancellation to be correct.
 *
 * That stops being true at the point the list is paged. When it is, these
 * become query parameters and the sort has to move to SQL, because sorting
 * one page of a list is sorting the wrong thing.
 *
 * Pure, and kept out of the component so the rules can be read — and tested —
 * without a browser.
 */
import { displayName } from "./display";
import type { User } from "./types";

/** Which slice of the roster the chips are showing.
 *
 * "unassigned" is people owning no country, not leads in the unassigned
 * queue. They are related — a counsellor with no countries is why that queue
 * fills — but they are different lists, and the chip counts people. */
export type RosterFilter = "all" | "active" | "unassigned";

export type RosterSort = "name-asc" | "name-desc" | "recent";

export const SORT_LABEL: Record<RosterSort, string> = {
  "name-asc": "Name A–Z",
  "name-desc": "Name Z–A",
  recent: "Recently added",
};

/** Matches on name AND email, not name alone.
 *
 * An invited person has no name yet, so a search that only looked at names
 * could not find the row that says "newjoiner@agency.test" — the one row on
 * the screen where the address is the only thing there is to type.
 */
export function searchUsers(users: User[], query: string): User[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return users;
  return users.filter((user) => {
    const name = user.name?.toLowerCase() ?? "";
    return (
      name.includes(needle) ||
      user.email.toLowerCase().includes(needle) ||
      // Country codes are how this screen is read; "AU" should find whoever
      // covers Australia.
      user.countries.some((c) => c.toLowerCase().includes(needle))
    );
  });
}

export function filterUsers(users: User[], filter: RosterFilter): User[] {
  switch (filter) {
    case "active":
      return users.filter((u) => u.status === "active");
    case "unassigned":
      return users.filter((u) => u.countries.length === 0);
    case "all":
      return users;
  }
}

/** A new array every time — `sort` mutates in place, and the array handed in
 *  here belongs to the react-query cache. Sorting it directly would reorder
 *  the cached roster underneath every other component reading it. */
export function sortUsers(users: User[], sort: RosterSort): User[] {
  const copy = [...users];
  switch (sort) {
    case "name-asc":
      return copy.sort((a, b) => compareNames(a, b));
    case "name-desc":
      return copy.sort((a, b) => compareNames(b, a));
    case "recent":
      // Newest first. Ties broken by name so the order is stable across
      // renders — several people invited in the same second is normal when an
      // agency onboards, and a list that reshuffles itself is unusable.
      return copy.sort(
        (a, b) =>
          b.created_at.localeCompare(a.created_at) || compareNames(a, b),
      );
  }
}

/** localeCompare, not `<`. Sinhala, Tamil and accented Latin names all sort
 *  wrongly under a codepoint comparison, and this is a product for agencies
 *  whose staff are named in those scripts. */
function compareNames(a: User, b: User): number {
  return displayName(a).localeCompare(displayName(b), undefined, {
    sensitivity: "base",
  });
}

/** What each chip says in its brackets.
 *
 * Counted BEFORE the search is applied on purpose. A chip is a filter over
 * the roster, and "Active (1)" changing to "Active (0)" because you typed a
 * letter in an unrelated box reads as people disappearing.
 */
export function rosterCounts(users: User[]): Record<RosterFilter, number> {
  return {
    all: users.length,
    active: filterUsers(users, "active").length,
    unassigned: filterUsers(users, "unassigned").length,
  };
}
