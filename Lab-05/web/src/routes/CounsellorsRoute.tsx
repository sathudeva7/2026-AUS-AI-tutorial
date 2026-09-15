/** The counsellor roster and one counsellor's coverage.
 *
 * Routing is by owned country, and this surface exists to make the
 * consequences of that legible: who owns what, and which destinations have no
 * active owner at all. That last one is not an error state to be tidied away —
 * it is how the unassigned queue fills, and a manager needs to see it.
 *
 * Two panels on a ground rather than a rail butted against a pane. Searching,
 * the chips and the sort are all client-side passes over the one roster this
 * screen already loaded — see `features/users/roster.ts` for why, and for when
 * that stops being the right answer.
 */
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { RosterList } from "@/features/users/components/RosterList";
import { UserDetail } from "@/features/users/components/UserDetail";
import {
  AlertIcon,
  CloseIcon,
  PlusIcon,
  SearchIcon,
  SlidersIcon,
} from "@/components/ui/icons";
import { useUsers } from "@/features/users/queries";
import { countryName } from "@/features/users/display";
import { toCountryCode } from "@/data/countries";
import {
  rosterCounts,
  SORT_LABEL,
  type RosterFilter,
  type RosterSort,
} from "@/features/users/roster";
import { useProgrammes } from "@/features/catalogue/queries";
import { Select } from "@/components/ui/Select";
import { InviteDialog } from "@/components/counsellors/InviteDialog";
import { useSession } from "@/data/SessionProvider";

const FILTERS: RosterFilter[] = ["all", "active", "unassigned"];

const FILTER_LABEL: Record<RosterFilter, string> = {
  all: "All",
  active: "Active",
  unassigned: "Unassigned",
};

const SORT_OPTIONS = (Object.keys(SORT_LABEL) as RosterSort[]).map((value) => ({
  value,
  label: SORT_LABEL[value],
}));

export function CounsellorsRoute() {
  const { counsellorId } = useParams();
  const navigate = useNavigate();
  const { can } = useSession();

  const [inviting, setInviting] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RosterFilter>("all");
  const [sort, setSort] = useState<RosterSort>("name-asc");
  const [showDeactivated, setShowDeactivated] = useState(false);
  // For this visit only, and deliberately not persisted. The gap is still
  // there tomorrow; a warning somebody silenced once in March is a warning
  // nobody ever sees again.
  const [noticeDismissed, setNoticeDismissed] = useState(false);

  // The backend defaults to active plus invited. Deactivated people are
  // history — worth being able to look at, not worth being in the way — so
  // they arrive only when asked for, behind the filter control.
  const params = showDeactivated ? { status: "all" as const } : {};

  // The same query key the list uses, so this is the cached result rather than
  // a second request. Change one of these and you must change the other.
  const { data } = useUsers(params);
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
    (users ?? [])
      .filter((u) => u.status === "active")
      .flatMap((u) => u.countries),
  );
  // The catalogue names countries; users own codes. Normalise before
  // comparing, or nothing ever matches and everything reads as a gap.
  const uncovered = [
    ...new Set((programmes ?? []).map((p) => toCountryCode(p.country))),
  ]
    .filter((code) => !owned.has(code))
    .sort();

  const counts = rosterCounts(users ?? []);

  return (
    <div className="console console-page">
      <section className="console-panel w-[380px] flex-none">
        <div className="console-panel-head">
          <div className="min-w-0">
            <h3 className="console-panel-title">Counsellor roster</h3>
            <p className="console-panel-sub">
              Who is on the team, and which countries each of them owns.
            </p>
          </div>
          {/* Owner-only, the same rule POST /api/users/invite enforces. UX,
              not security: the endpoint re-checks, and a hidden button is not
              a permission — but a button that always answers 403 is worse
              than no button. */}
          {can("users.invite") ? (
            <button
              type="button"
              className="console-icon-btn"
              data-variant="primary"
              aria-label="Invite a counsellor"
              onClick={() => setInviting(true)}
            >
              <PlusIcon size={18} />
            </button>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 px-[18px] pb-3 pt-4">
          <div className="flex items-center gap-2">
            <div className="console-search">
              <SearchIcon size={15} className="console-search-icon" />
              <input
                className="console-input"
                type="search"
                value={query}
                placeholder="Search counsellors…"
                aria-label="Search counsellors"
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="console-icon-btn"
              data-variant="secondary"
              aria-pressed={showDeactivated}
              aria-label="Include deactivated people"
              title="Include deactivated people"
              onClick={() => setShowDeactivated((on) => !on)}
            >
              <SlidersIcon size={16} />
            </button>
          </div>

          <div className="console-chips">
            {FILTERS.map((value) => (
              <button
                key={value}
                type="button"
                className="console-chip"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {FILTER_LABEL[value]} ({counts[value]})
              </button>
            ))}
          </div>

          {/* Coverage gaps belong to the ROSTER, not to whoever happens to be
              selected. Above the person's name — where this used to sit — an
              agency-wide warning outranked the record you had just clicked. */}
          {uncovered.length && !noticeDismissed ? (
            <div className="console-notice">
              <AlertIcon size={17} className="console-notice-icon" />
              <div className="min-w-0 flex-1">
                <div className="console-notice-title">
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
                      title={code}
                    >
                      {countryName(code)}
                    </span>
                  ))}
                </div>
                <p className="console-notice-body">
                  Leads for {uncovered.length === 1 ? "it" : "these"} join the
                  unassigned queue. The agent will not route a lead to someone
                  who does not cover the country.
                </p>
              </div>
              <button
                type="button"
                className="console-notice-dismiss"
                aria-label="Dismiss coverage warning"
                onClick={() => setNoticeDismissed(true)}
              >
                <CloseIcon size={15} />
              </button>
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-2">
            {/* Active and total both, not just a headcount. An agency that has
                invited four people and had none accept has a roster of five
                and a routable team of one, and only one of those numbers is
                about whether leads get answered.

                The total is the SERVER's, not the length of what arrived: the
                list is capped at 25 and there is no paging control yet, so on
                a bigger agency `data.total` is the only one of the two that
                is true. The chip counts beside it are necessarily over the
                rows actually loaded, because those are the rows a chip can
                filter. */}
            <p className="console-meta m-0">
              {counts.active} active of {data?.total ?? counts.all}
            </p>
            <Select
              className="w-[168px]"
              value={sort}
              options={SORT_OPTIONS}
              searchable={false}
              ariaLabel="Sort the roster"
              onChange={(value) => setSort(value as RosterSort)}
            />
          </div>
        </div>

        <div className="nb-scroll flex-1 overflow-y-auto px-[18px] pb-4">
          <RosterList
            params={params}
            query={query}
            filter={filter}
            sort={sort}
            selectedId={counsellorId}
            onSelect={(userId) => navigate(`/counsellors/${userId}`)}
          />
        </div>
      </section>

      {/* min-w-0: a flex child defaults to min-width:auto and refuses to
          shrink below its content, so the cards ran off the right edge
          instead of narrowing. */}
      <section className="console-panel min-w-0 flex-1">
        <div className="nb-scroll flex-1 overflow-y-auto px-7 pb-12 pt-7">
          {selected ? (
            /* key, so a different person is a different panel. The contact
               form, the availability grid and the panel's own edit flag all
               seed useState, and a useState initialiser runs once on mount —
               React would otherwise keep them mounted, swap the props, and
               leave the boxes holding the last person's half-finished edit for
               Save to write to whoever is on screen now. */
            <UserDetail
              key={selected.id}
              user={selected}
              rosterIds={new Set((users ?? []).map((u) => u.id))}
            />
          ) : null}
        </div>
      </section>

      {/* Live against POST /api/users/invite. It used to be inert — it
          collected a role vocabulary and a caseload cap the API has no field
          for — so the fields that had nowhere to go are gone and the two that
          do are wired. */}
      <InviteDialog open={inviting} onOpenChange={setInviting} />
    </div>
  );
}
