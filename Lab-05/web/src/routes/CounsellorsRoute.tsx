/** The counsellor roster and one counsellor's coverage.
 *
 * Routing is by owned country, and this surface exists to make the
 * consequences of that legible: who owns what, and which destinations have no
 * active owner at all. That last one is not an error state to be tidied away —
 * it is how the unassigned queue fills, and a manager needs to see it.
 *
 * Live against `GET /api/users` as of the roster wiring. The invite dialog and
 * the richer parts of the detail panel are still to come; what is rendered
 * here is real.
 */
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { RosterList } from "@/features/users/components/RosterList";
import { UserDetail } from "@/features/users/components/UserDetail";
import { useUsers } from "@/features/users/queries";
import { useProgrammes } from "@/features/catalogue/queries";
import { toCountryCode } from "@/features/users/display";
import { COUNTRY_BY_CODE } from "@/data/countries";
import { InviteDialog } from "@/components/counsellors/InviteDialog";

export function CounsellorsRoute() {
  const { counsellorId } = useParams();
  const navigate = useNavigate();
  const [inviting, setInviting] = useState(false);

  // The same query key the list uses, so this is the cached result rather than
  // a second request.
  const { data } = useUsers();
  const users = data?.users;
  const { data: programmes } = useProgrammes();

  // Falls back to the first person so the panel is not empty on arrival.
  //
  // Previously an effect that navigated to /counsellors/{first id}. That is a
  // render, then an effect, then a history entry, then another render — to
  // reach a screen indistinguishable from this one. Deep links still work:
  // an id in the URL is found here first.
  const selected = users?.find((u) => u.id === counsellorId) ?? users?.[0];

  // Destinations the catalogue covers that nobody ACTIVE owns. This is the
  // unassigned queue in advance, and it belongs at the top of the roster.
  // Invited people do not count: they cannot be routed to until they accept.
  //
  // Worked out during render rather than stored. It was state filled by an
  // effect, which cost an extra render and — because the catalogue read is
  // async with nothing cancelling it — could settle out of order and leave the
  // banner describing a roster that had already changed.
  const owned = new Set(
    (users ?? []).filter((u) => u.status === "active").flatMap((u) => u.countries),
  );
  // The catalogue names countries; users own codes. Normalise before
  // comparing, or nothing ever matches and everything reads as a gap.
  const uncovered = [
    ...new Set((programmes ?? []).map((p) => toCountryCode(p.country))),
  ]
    .filter((code) => !owned.has(code))
    .sort();

  return (
    <div className="console flex h-screen">
      <div className="console-rail flex w-[320px] flex-none flex-col">
        <div className="px-4 pb-3 pt-5">
          <h3 className="console-rail-title">Counsellors</h3>
        </div>

        {/* Coverage gaps belong to the ROSTER, not to whoever happens to be
            selected. Above the person's name — where this used to sit — an
            agency-wide warning outranked the record you had just clicked. */}
        {uncovered.length ? (
          <div className="px-3 pb-3">
            <div className="console-gap">
              <div className="console-gap-title">
                {uncovered.length === 1
                  ? "1 country has no owner"
                  : `${uncovered.length} countries have no owner`}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {uncovered.map((code) => (
                  <span
                    key={code}
                    className="console-country"
                    data-uncovered="true"
                    title={COUNTRY_BY_CODE[code]?.name ?? code}
                  >
                    {code}
                  </span>
                ))}
              </div>
              <p className="console-gap-body">
                Leads for {uncovered.length === 1 ? "it" : "these"} join the
                unassigned queue. The agent will not route a lead to someone who
                does not cover the country.
              </p>
            </div>
          </div>
        ) : null}

        <div className="nb-scroll flex flex-1 flex-col gap-2 overflow-y-auto px-3 pb-4">
          <RosterList
            selectedId={counsellorId}
            onSelect={(userId) => navigate(`/counsellors/${userId}`)}
          />
        </div>

        <div className="px-3 pb-4 pt-1">
          <button
            type="button"
            className="console-btn w-full"
            data-variant="secondary"
            onClick={() => setInviting(true)}
          >
            Invite a counsellor
          </button>
        </div>
      </div>

      {/* min-w-0: a flex child defaults to min-width:auto and refuses to
          shrink below its content, so the cards ran off the right edge
          instead of narrowing. */}
      <div className="nb-scroll min-w-0 flex-1 overflow-y-auto px-8 pb-12 pt-7">
        {selected ? <UserDetail user={selected} /> : null}
      </div>

      <InviteDialog
        open={inviting}
        onOpenChange={setInviting}
        // Not wired yet: the dialog collects a role vocabulary and a caseload
        // cap the API has no field for, and inventing a mapping here would be
        // worse than leaving it inert for one more step. Closing without
        // pretending to have invited anyone is the honest interim.
        onInvite={() => setInviting(false)}
      />
    </div>
  );
}
