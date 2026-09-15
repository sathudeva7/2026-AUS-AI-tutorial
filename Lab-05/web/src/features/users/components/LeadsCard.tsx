/** The leads sitting with this counsellor.
 *
 * Read from the lead book, filtered to this person. What it can currently say
 * is limited by something real: see `features/leads/assignment.ts` for why an
 * empty result here is usually NOT the sentence "this counsellor has no
 * leads", and must not be rendered as one.
 *
 * Read-only. Reassigning a lead is a routing decision with rules behind it
 * (owned countries, fewest active leads, ties by lowest user id) and it does
 * not belong on a dropdown in the corner of somebody's profile card.
 */
import { FailureCard } from "@/components/ui/States";
import { useLeads } from "@/features/leads/queries";
import { assignmentFor, sortLeads } from "@/features/leads/assignment";
import type { Lead } from "@/data/types";

import { displayName } from "../display";
import type { User } from "../types";
import { AlertIcon, InboxIcon } from "@/components/ui/icons";

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  parked: "Parked",
  escalated: "Escalated",
  withdrawn: "Withdrawn",
  converted: "Converted",
};

export function LeadsCard({
  user,
  /** Every `users.id` on the roster. Evidence for whether lead assignments
   *  are user ids at all — see assignmentFor. */
  rosterIds,
}: {
  user: User;
  rosterIds: Set<string>;
}) {
  const { data, isPending, error } = useLeads();

  return (
    <section className="console-card">
      <div className="console-card-head">
        <h3 className="console-section-title">
          <span className="inline-flex items-center gap-2">
            <InboxIcon size={17} />
            Leads
          </span>
        </h3>
        {data && !error ? <LeadsCount user={user} leads={data} rosterIds={rosterIds} /> : null}
      </div>

      <div className="console-card-body">
        {isPending ? (
          <p className="console-meta m-0">Reading the lead book…</p>
        ) : error ? (
          // Fail loudly (CLAUDE.md). An empty list on a dead backend reads as
          // "this counsellor has nothing on", which is a claim about a
          // person's workload rather than about a broken request.
          <FailureCard error={error} />
        ) : (
          <Body user={user} leads={data} rosterIds={rosterIds} />
        )}
      </div>
    </section>
  );
}

function LeadsCount({
  user,
  leads,
  rosterIds,
}: {
  user: User;
  leads: Lead[];
  rosterIds: Set<string>;
}) {
  const assignment = assignmentFor(leads, user.id, rosterIds);
  if (assignment.kind !== "assigned") return null;
  const open = assignment.leads.filter(
    (lead) => lead.status === "active" || lead.status === "escalated",
  ).length;
  return (
    <span className="console-meta">
      {assignment.leads.length} total · {open} open
    </span>
  );
}

function Body({
  user,
  leads,
  rosterIds,
}: {
  user: User;
  leads: Lead[];
  rosterIds: Set<string>;
}) {
  const assignment = assignmentFor(leads, user.id, rosterIds);

  switch (assignment.kind) {
    case "assigned":
      return (
        <ul className="m-0 flex list-none flex-col p-0" aria-label="Assigned leads">
          {sortLeads(assignment.leads).map((lead) => (
            <li key={lead.lead_id} className="console-lead">
              <div className="min-w-0 flex-1">
                <div className="console-lead-name truncate">
                  {lead.name ?? lead.email}
                </div>
                <div className="console-lead-sub truncate">
                  {[lead.country_of_residence, lead.facts?.target_country]
                    .filter(Boolean)
                    .join(" → ") || lead.email}
                </div>
              </div>
              <span
                className="console-lead-status flex-none"
                data-status={lead.status}
              >
                {STATUS_LABEL[lead.status] ?? lead.status}
              </span>
            </li>
          ))}
        </ul>
      );

    case "no-leads":
      return (
        <div className="console-emptybox">
          <InboxIcon size={26} className="console-emptybox-icon" />
          <div className="console-emptybox-title">No leads yet</div>
          <p className="console-emptybox-body">
            Inquiries appear here once students start reaching the agent.
          </p>
        </div>
      );

    case "none-for-user":
      return (
        <div className="console-emptybox">
          <InboxIcon size={26} className="console-emptybox-icon" />
          <div className="console-emptybox-title">No leads assigned</div>
          <p className="console-emptybox-body">
            Nothing is routed to {displayName(user)} right now. Leads are
            assigned by owned country; a destination nobody owns goes to the
            unassigned queue instead.
          </p>
        </div>
      );

    // Not an empty workload, and mustn't be drawn as one. Amber rather than
    // the neutral dashed box for exactly that reason: this is a wiring fault
    // to be fixed, not a state of the business to be read.
    case "unmatchable":
      return (
        <div className="console-notice">
          <AlertIcon size={17} className="console-notice-icon" />
          <div className="min-w-0 flex-1">
            <div className="console-notice-title">
              Leads cannot be matched to the roster yet
            </div>
            <p className="console-notice-body">
              {assignment.assignedCount === 1
                ? "The one assigned lead names"
                : `All ${assignment.assignedCount} assigned leads name`}{" "}
              a counsellor who is not on this roster.{" "}
              <code>GET /api/leads</code> still answers from the demo lead book,
              where assignments are ids like <code>c_001</code>, while the
              roster is the <code>users</code> table. Until that endpoint reads{" "}
              <code>leads.assigned_user_id</code>, nobody&rsquo;s leads can be
              shown here — this is not a statement about{" "}
              {displayName(user)}&rsquo;s workload.
            </p>
          </div>
        </div>
      );
  }
}
