/** The roster: everyone in this agency, from `GET /api/users`.
 *
 * One request draws the whole list. `countries` come back inline on each row,
 * so there is no per-person follow-up — the prototype fetched a profile per
 * counsellor, which was free against fixtures and would have been 41 requests
 * against a 40-person agency.
 *
 * Hours are deliberately not read here. They belong to whoever is selected,
 * not to a list nobody has clicked yet.
 */
import { FailureCard } from "@/components/ui/States";

import { useUsers } from "../queries";
import { coverage, displayInitials, displayName, STATUS_LABEL } from "../display";
import type { User } from "../types";

export function RosterList({
  selectedId,
  onSelect,
}: {
  selectedId?: string;
  onSelect: (userId: string) => void;
}) {
  // No status filter: the backend defaults to active plus invited. Deactivated
  // people are history, and an owner who invited someone yesterday needs to
  // see that it happened.
  const { data, isPending, error } = useUsers();

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

  const { users, total } = data;
  const active = users.filter((u) => u.status === "active").length;

  return (
    <>
      <p className="console-meta m-0 mb-3">
        {active} active of {total}
      </p>

      {users.length === 0 ? (
        <p className="console-empty m-0">
          Nobody on the roster yet. Invite a colleague to get started.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0" aria-label="Counsellors">
          {users.map((user) => (
            <li key={user.id}>
              <RosterRow
                user={user}
                selected={user.id === selectedId}
                onSelect={onSelect}
              />
            </li>
          ))}
        </ul>
      )}
    </>
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
      <span className="flex items-center gap-2.5">
        <span className="console-avatar" aria-hidden="true">
          {displayInitials(user)}
        </span>
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
