/** One person's record.
 *
 * Deliberately plain. The prototype's panel showed a caseload bar, a "this
 * week" stat strip and a permissions checklist; none of those exist in the
 * database — there is no cap column, no per-week counter and no per-user
 * permission UI — so rendering them from real data is not possible and
 * rendering them from fixtures would be a lie on a screen that otherwise tells
 * the truth. They come back as each one gets a real source.
 */
import { COUNTRY_BY_CODE } from "@/data/countries";

import { ContactCard } from "./ContactCard";
import { ROLE_LABEL, STATUS_LABEL, displayName } from "../display";
import type { User } from "../types";

export function UserDetail({ user }: { user: User }) {
  return (
    <div className="max-w-[720px]">
      <header className="mb-6">
        <h2 className="console-name">{displayName(user)}</h2>
        {/* Role and status as two distinct things, not one string joined by a
            dot. They answer different questions and one of them is coloured. */}
        <div className="mt-1.5 flex items-center gap-3">
          <span className="console-meta">{ROLE_LABEL[user.role]}</span>
          <span className="console-status" data-status={user.status}>
            {STATUS_LABEL[user.status]}
          </span>
        </div>
        {user.status === "invited" ? (
          <p className="console-meta m-0 mt-2">
            No leads are routed here until the invitation is accepted.
          </p>
        ) : null}
      </header>

      <ContactCard user={user} />

      <section className="console-card mt-4">
        <div className="console-card-head">
          <h3 className="console-section-title">Countries</h3>
        </div>
        <div className="console-card-body">
          {user.countries.length ? (
            <div className="flex flex-wrap gap-1.5">
              {user.countries.map((country) => (
                <span
                  key={country}
                  className="console-country"
                  // The code is the unit this screen works in, but nobody
                  // reads "IN" and thinks India on the first pass.
                  title={COUNTRY_BY_CODE[country]?.name ?? country}
                >
                  {country}
                </span>
              ))}
            </div>
          ) : (
            <p className="console-empty m-0">
              No countries. Leads for a destination nobody owns join the
              unassigned queue, where everyone can see them.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
