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
import { StatusChip } from "@/components/ui";
import { EmptyNote, FailureCard } from "@/components/ui/States";

import { useUsers } from "../queries";
import {
  coverageLine,
  displayInitials,
  displayName,
  STATUS_LABEL,
} from "../display";
import type { User } from "../types";

const STATUS_STYLE: Record<
  User["status"],
  { background: string; foreground: string }
> = {
  active: {
    background: "var(--color-accent-2-200)",
    foreground: "var(--color-accent-2-800)",
  },
  invited: {
    background: "var(--color-accent-200)",
    foreground: "var(--color-accent-800)",
  },
  deactivated: {
    background: "var(--color-neutral-300)",
    foreground: "var(--color-neutral-900)",
  },
};

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
    return (
      <p
        className="px-5 pb-3.5 text-[12.5px]"
        style={{ color: "var(--color-neutral-700)" }}
      >
        Reading the roster…
      </p>
    );
  }

  // Fail loudly (CLAUDE.md). An empty list on a dead backend reads as "this
  // agency has no counsellors", which is a different and much worse claim.
  if (error) {
    return (
      <div className="px-3 pb-4">
        <FailureCard error={error} />
      </div>
    );
  }

  const { users, total } = data;

  return (
    <>
      <p
        className="m-0 mt-1 px-5 pb-3.5 text-[12.5px]"
        style={{ color: "var(--color-neutral-700)" }}
      >
        {users.filter((u) => u.status === "active").length} active of {total} ·
        routing is by owned country.
      </p>

      {users.length === 0 ? (
        <div className="px-3">
          <EmptyNote>
            Nobody on the roster yet. Invite a colleague to get started.
          </EmptyNote>
        </div>
      ) : (
        <ul
          className="m-0 flex list-none flex-col gap-1.5 p-0"
          aria-label="Counsellors"
        >
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
  const style = STATUS_STYLE[user.status];
  const name = displayName(user);
  return (
    <button
      type="button"
      onClick={() => onSelect(user.id)}
      aria-current={selected ? "true" : undefined}
      // The accessible name carries the status too, so a test — and a screen
      // reader — can tell "Zoe, invited" from "Zoe, active" without reading
      // colour off a chip.
      aria-label={`${name}, ${STATUS_LABEL[user.status]}`}
      className="w-full cursor-pointer rounded-md px-3 py-2.5 text-left"
      style={{
        background: selected ? "var(--color-bg)" : "transparent",
        border: `1px solid ${selected ? "var(--color-accent)" : "var(--color-divider)"}`,
      }}
    >
      <span className="flex items-center gap-[10px]">
        <span
          aria-hidden="true"
          className="grid h-[30px] w-[30px] flex-none place-items-center rounded-pill text-[11px]"
          style={{
            background: "var(--color-accent-200)",
            color: "var(--color-accent-800)",
          }}
        >
          {displayInitials(user)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold">
            {name}
          </span>
          <span
            className="block truncate text-[11.5px]"
            style={{ color: "var(--color-neutral-700)" }}
          >
            {coverageLine(user)}
          </span>
        </span>
      </span>
      <span className="mt-2 flex items-center gap-1.5">
        <StatusChip
          label={STATUS_LABEL[user.status]}
          background={style.background}
          foreground={style.foreground}
        />
      </span>
    </button>
  );
}
