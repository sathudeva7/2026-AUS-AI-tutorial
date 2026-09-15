/** Which leads belong to one counsellor — and whether that question can be
 *  answered at all right now.
 *
 * It cannot, yet, and this module exists to say so precisely rather than let
 * the screen imply something false.
 *
 * `leads.assigned_user_id` in Postgres (migration 003) is a uuid pointing at
 * `users(id)`, which is exactly the join this panel wants. Nothing serves that
 * column: the only `GET /api/leads` is the demo route in `main.py`, which
 * reads the mock JSON store where the field is `assigned_counsellor_id` and
 * holds ids like "c_001" from `mocks/seeds/counsellors.json`. Those ids name
 * people who are not in the `users` table at all.
 *
 * So a plain `lead.assigned_counsellor_id === user.id` filter returns nothing,
 * forever, for everybody. Rendering that as "no leads assigned" would be a
 * false statement about a counsellor's workload on a screen whose whole
 * argument is that it only shows things that are true. Hence the third
 * outcome below.
 *
 * When the endpoint lands and starts returning user ids, `unmatchable` stops
 * being reachable on its own and every other branch already works.
 */
import type { Lead } from "@/data/types";

export type LeadAssignment =
  /** Leads really are assigned to this person. */
  | { kind: "assigned"; leads: Lead[] }
  /** The lead book is empty. Nothing to say about anybody. */
  | { kind: "no-leads" }
  /** Assignments are readable and none of them are this person's. A true
   *  statement about their workload. */
  | { kind: "none-for-user" }
  /** Assignments exist but name people who are not on the roster, so no lead
   *  can be matched to any counsellor. Not a fact about this person. */
  | { kind: "unmatchable"; assignedCount: number };

/**
 * @param leads      every lead the lead book returned
 * @param userId     the counsellor on screen, as `users.id`
 * @param rosterIds  every `users.id` the roster knows about — the evidence
 *                   for deciding whether assignment ids are user ids at all
 */
export function assignmentFor(
  leads: Lead[],
  userId: string,
  rosterIds: Set<string>,
): LeadAssignment {
  if (leads.length === 0) return { kind: "no-leads" };

  const mine = leads.filter((lead) => lead.assigned_counsellor_id === userId);
  if (mine.length > 0) return { kind: "assigned", leads: mine };

  const assigned = leads.filter((lead) => lead.assigned_counsellor_id);
  if (assigned.length === 0) return { kind: "none-for-user" };

  // Every assignment names somebody the roster has never heard of. One stale
  // id would be a deactivated colleague; ALL of them is two id spaces.
  //
  // Deliberately "none match" rather than "some do not": a single lead still
  // pointing at a departed counsellor must not switch the whole panel into
  // the "cannot be matched" story and hide real assignments from view.
  const matchable = assigned.some((lead) =>
    rosterIds.has(lead.assigned_counsellor_id!),
  );
  return matchable
    ? { kind: "none-for-user" }
    : { kind: "unmatchable", assignedCount: assigned.length };
}

/** Open leads first, then by name. A counsellor opening their own record is
 *  looking for what still needs doing, not for a filing cabinet. */
const STATUS_ORDER: Record<string, number> = {
  escalated: 0,
  active: 1,
  parked: 2,
  converted: 3,
  withdrawn: 4,
};

export function sortLeads(leads: Lead[]): Lead[] {
  return [...leads].sort(
    (a, b) =>
      (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
      (a.name ?? a.email).localeCompare(b.name ?? b.email, undefined, {
        sensitivity: "base",
      }),
  );
}
