/** One person's card, from the roster row already in the cache.
 *
 * Deliberately plain for now. The prototype's panel showed a caseload bar,
 * a "this week" stat strip and a permissions checklist; none of those exist
 * in the database — there is no cap column, no per-week counter and no
 * per-user permission UI — so rendering them from real data is not possible
 * and rendering them from fixtures would be a lie on a screen that otherwise
 * tells the truth. They come back as each one gets a real source.
 */
import { Card, Kicker, Tag } from "@/components/ui";

import { ROLE_LABEL, STATUS_LABEL, displayName } from "../display";
import type { User } from "../types";

export function UserDetail({ user }: { user: User }) {
  return (
    <div>
      <header className="mb-5">
        <h2 className="m-0 text-[30px]">{displayName(user)}</h2>
        <p
          className="m-0 mt-1 text-[13px]"
          style={{ color: "var(--color-neutral-700)" }}
        >
          {ROLE_LABEL[user.role]} · {STATUS_LABEL[user.status]}
          {user.status === "invited"
            ? " · no leads are routed until they accept"
            : ""}
        </p>
      </header>

      <Card className="rounded-md p-4">
        <Kicker>Contact</Kicker>
        <dl className="m-0 mt-3 grid grid-cols-[130px_1fr] gap-y-2 text-[13px]">
          <dt style={{ color: "var(--color-neutral-700)" }}>Email</dt>
          <dd className="m-0">{user.email}</dd>

          <dt style={{ color: "var(--color-neutral-700)" }}>Work phone</dt>
          {/* A product contact, not HR: this is the number a colleague rings
              about an escalation, which is why every member sees it. */}
          <dd className="m-0">{user.work_phone ?? "Not given"}</dd>

          <dt style={{ color: "var(--color-neutral-700)" }}>Timezone</dt>
          {/* Their own zone, not the viewer's. Availability is wall clock read
              against this, so it is a working fact rather than trivia. */}
          <dd className="m-0">{user.timezone}</dd>
        </dl>
      </Card>

      <Card className="mt-4 rounded-md p-4">
        <Kicker>Owns routing for</Kicker>
        {user.countries.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {user.countries.map((country) => (
              <Tag key={country}>{country}</Tag>
            ))}
          </div>
        ) : (
          <p
            className="m-0 mt-3 text-[13px] leading-relaxed"
            style={{ color: "var(--color-neutral-700)" }}
          >
            No countries. Leads for a destination nobody owns join the
            unassigned queue, where everyone can see them.
          </p>
        )}
      </Card>
    </div>
  );
}
