/** The roster: everyone in this agency, from `GET /api/users`.
 *
 * One request draws the whole list. `countries` come back inline on each row,
 * so there is no per-person follow-up — the prototype fetched a profile per
 * counsellor, which was free against fixtures and would have been 41 requests
 * against a 40-person agency.
 *
 * Hours are deliberately not read here. They belong to whoever is selected,
 * not to a list nobody has clicked yet.
 *
 * The search box, the chips and the sort live on the route above; this reads
 * them as props and narrows the same cached list. It still calls `useUsers`
 * itself rather than taking rows as a prop, so the loading and failure states
 * stay where the list is — and because the route asks with the same params,
 * both hooks land on one cache entry and one request.
 */
import { FailureCard } from "@/components/ui/States";

import { useUsers } from "../queries";
import { Avatar } from "./Avatar";
import { coverage, displayName, STATUS_LABEL } from "../display";
import {
  filterUsers,
  searchUsers,
  sortUsers,
  type RosterFilter,
  type RosterSort,
} from "../roster";
import type { User, UserListParams } from "../types";

export function RosterList({
  params,
  query,
  filter,
  sort,
  selectedId,
  onSelect,
}: {
  /** The same object the route passes to its own `useUsers`. Both must match
   *  or the screen fires two requests for two versions of the roster. */
  params: UserListParams;
  query: string;
  filter: RosterFilter;
  sort: RosterSort;
  selectedId?: string;
  onSelect: (userId: string) => void;
}) {
  const { data, isPending, error } = useUsers(params);

  if (isPending) {
    return <p className="console-meta px-1 py-2">Reading the roster…</p>;
  }

  // Fail loudly (CLAUDE.md). An empty list on a dead backend reads as "this
  // agency has no counsellors", which is a different and much worse claim.
  if (error) {
    return (
      <div className="py-2">
        <FailureCard error={error} />
      </div>
    );
  }

  // Search last, so the chip a person clicked decides the population and the
  // box only narrows within it.
  const shown = sortUsers(
    searchUsers(filterUsers(data.users, filter), query),
    sort,
  );

  if (data.users.length === 0) {
    return (
      <p className="console-empty m-0">
        Nobody on the roster yet. Invite a colleague to get started.
      </p>
    );
  }

  // Three different nothings, and they need three different sentences. "No
  // results" after a search is a typo; after a chip it is a fact about the
  // agency worth reading.
  if (shown.length === 0) {
    return (
      <p className="console-empty m-0">
        {query.trim()
          ? `Nobody matches “${query.trim()}”.`
          : filter === "unassigned"
            ? "Everybody owns at least one country."
            : "Nobody on the roster is active."}
      </p>
    );
  }

  return (
    <ul
      className="m-0 flex list-none flex-col gap-1 p-0"
      aria-label="Counsellors"
    >
      {shown.map((user) => (
        <li key={user.id}>
          <RosterRow
            user={user}
            selected={user.id === selectedId}
            onSelect={onSelect}
          />
        </li>
      ))}
    </ul>
  );
}

function RosterRow({
  user,
  selected,
  onSelect,
}: {
  user: User;
  selected: boolean;
  onSelect: (userId: string) => void;
}) {
  const name = displayName(user);
  const { role, countries } = coverage(user);
  return (
    <button
      type="button"
      className="console-row"
      onClick={() => onSelect(user.id)}
      aria-current={selected ? "true" : undefined}
      // The accessible name carries the status too, so a test — and a screen
      // reader — can tell "Zoe, invited" from "Zoe, active" without reading
      // colour off a dot.
      aria-label={`${name}, ${STATUS_LABEL[user.status]}`}
    >
      <span className="flex items-center gap-3">
        <Avatar user={user} />
        <span className="min-w-0 flex-1">
          <span className="console-row-name truncate">{name}</span>
          {/* Role and coverage separated by space, not a dot or a dash. Both
              are on every row, and a glyph between them is chrome that earns
              nothing. */}
          <span className="console-row-sub flex gap-2.5">
            <span className="flex-none">{role}</span>
            <span className="truncate">{countries}</span>
          </span>
        </span>
        <span
          className="console-status flex-none"
          data-status={user.status}
          aria-hidden="true"
        >
          {STATUS_LABEL[user.status]}
        </span>
      </span>
    </button>
  );
}
