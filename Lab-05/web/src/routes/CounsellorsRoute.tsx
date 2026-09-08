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
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { Button } from "@/components/ui";
import { RosterList } from "@/features/users/components/RosterList";
import { UserDetail } from "@/features/users/components/UserDetail";
import { useUsers } from "@/features/users/queries";
import { InviteDialog } from "@/components/counsellors/InviteDialog";
import { repo } from "@/data/repo";

export function CounsellorsRoute() {
  const { counsellorId } = useParams();
  const navigate = useNavigate();
  const [inviting, setInviting] = useState(false);

  // The same query key the list uses, so this is the cached result rather than
  // a second request.
  const { data } = useUsers();
  const users = data?.users;

  const selected = useMemo(
    () => users?.find((u) => u.id === counsellorId),
    [users, counsellorId],
  );

  // Open on the first person so the panel is not empty on arrival.
  useEffect(() => {
    if (!counsellorId && users?.length) {
      navigate(`/counsellors/${users[0].id}`, { replace: true });
    }
  }, [counsellorId, users, navigate]);

  // Destinations the catalogue covers that nobody ACTIVE owns. This is the
  // unassigned queue in advance, and it belongs at the top of the roster.
  // Invited people do not count: they cannot be routed to until they accept.
  const [uncovered, setUncovered] = useState<string[]>([]);
  useEffect(() => {
    if (!users) return;
    void repo.listProgrammes().then((programmes) => {
      const owned = new Set(
        users.filter((u) => u.status === "active").flatMap((u) => u.countries),
      );
      const catalogued = new Set(programmes.map((p) => p.country));
      setUncovered([...catalogued].filter((c) => !owned.has(c)).sort());
    });
  }, [users]);

  return (
    <div className="flex h-screen">
      <div
        className="flex w-[300px] flex-none flex-col"
        style={{ borderRight: "1px solid var(--color-divider)" }}
      >
        <div className="px-5 pt-[22px]">
          <h3 className="m-0 text-[21px]">Counsellors</h3>
        </div>

        <div className="nb-scroll flex flex-col gap-1.5 overflow-y-auto px-3 pb-4">
          <RosterList
            selectedId={counsellorId}
            onSelect={(userId) => navigate(`/counsellors/${userId}`)}
          />

          <Button
            variant="secondary"
            className="mt-1.5"
            onClick={() => setInviting(true)}
          >
            Invite a counsellor
          </Button>
        </div>
      </div>

      <div className="nb-scroll flex-1 overflow-y-auto px-8 pb-10 pt-[26px]">
        {uncovered.length ? (
          <div
            className="mb-5 rounded-md p-4"
            style={{
              border: "1px solid var(--color-accent-300)",
              background: "var(--color-accent-100)",
            }}
          >
            <div
              className="font-heading text-[15px]"
              style={{ color: "var(--color-accent-800)" }}
            >
              {uncovered.join(", ")} {uncovered.length === 1 ? "has" : "have"} no
              active owner
            </div>
            <p
              className="m-0 mt-1.5 text-[13px] leading-relaxed"
              style={{ color: "var(--color-accent-800)" }}
            >
              The catalogue carries programmes for{" "}
              {uncovered.length === 1 ? "this destination" : "these destinations"}{" "}
              but no active counsellor owns{" "}
              {uncovered.length === 1 ? "it" : "them"}. Those leads join the
              unassigned queue — the agent will not route them to someone who
              does not cover the country.
            </p>
          </div>
        ) : null}

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
