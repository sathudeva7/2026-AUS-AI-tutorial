/** One person's record.
 *
 * Deliberately plain about NUMBERS. The prototype's panel showed a caseload
 * bar, a "this week" stat strip and a permissions checklist; none of those
 * exist in the database — there is no cap column, no per-week counter and no
 * per-user permission UI — so rendering them from real data is not possible
 * and rendering them from fixtures would be a lie on a screen that otherwise
 * tells the truth.
 *
 * Two agency-wide tiles ("Active counsellors", "Unassigned countries") sat
 * here briefly. Both figures were real, but neither was about the person
 * whose record this is, and the roster beside it already answers both — the
 * chip counts and the coverage banner. A number repeated one panel away is
 * furniture.
 */
import { useState } from "react";

import { AvailabilityGrid } from "./AvailabilityGrid";
import { Avatar } from "./Avatar";
import { ContactCard } from "./ContactCard";
import { LeadsCard } from "./LeadsCard";
import { PencilIcon } from "@/components/ui/icons";
import { useMayEditUser } from "../access";
import {
  ROLE_LABEL,
  STATUS_LABEL,
  countryNames,
  displayName,
} from "../display";
import type { User } from "../types";

export function UserDetail({
  user,
  rosterIds,
}: {
  user: User;
  /** Every `users.id` on the roster. The leads panel needs it to tell "no
   *  leads for this person" from "lead assignments do not name roster users
   *  at all" — two very different sentences. */
  rosterIds: Set<string>;
}) {
  const mayEdit = useMayEditUser(user);

  // Held here rather than on the route, and that placement is load-bearing.
  // The route mounts this panel with key={user.id}, so a different person is a
  // different component and this resets to false on its own. Lifted one level
  // higher it would survive the switch, and the contact form would reopen on
  // the next person still holding the last one's half-finished edit — the
  // exact bug the key was added to fix.
  const [editing, setEditing] = useState(false);

  return (
    <div className="flex max-w-[980px] flex-col gap-4">
      <header className="console-profile">
        <Avatar user={user} size="lg" />

        <div className="min-w-0 flex-1">
          <h2 className="console-name truncate">{displayName(user)}</h2>
          {/* Role and status as two distinct things, not one string joined by
              a dot. They answer different questions and one of them is
              coloured. */}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="console-meta">{ROLE_LABEL[user.role]}</span>
            <span className="console-pill" data-status={user.status}>
              {STATUS_LABEL[user.status]}
            </span>
          </div>
          {/* Where the reference design puts a strapline. A per-person tagline
              is not a column on `users` and writing one here would be the
              screen's only invented sentence, so the line states this
              person's coverage instead — the fact the rest of the panel is
              about. */}
          <p className="console-meta m-0 mt-2">
            {user.status === "invited"
              ? "No leads are routed here until the invitation is accepted."
              : user.countries.length === 0
                ? "Owns no countries, so no leads route here automatically."
                : `Covers ${countryNames(user.countries)}.`}
          </p>
        </div>

        {mayEdit && !editing ? (
          <button
            type="button"
            className="console-btn"
            data-variant="primary"
            onClick={() => setEditing(true)}
          >
            <PencilIcon size={15} />
            Edit
          </button>
        ) : null}
      </header>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <ContactCard
          user={user}
          editing={editing}
          onDone={() => setEditing(false)}
        />
        <LeadsCard user={user} rosterIds={rosterIds} />
      </div>

      <AvailabilityGrid user={user} />
    </div>
  );
}
