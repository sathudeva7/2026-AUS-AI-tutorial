/** When this counsellor can be booked.
 *
 * A week template, drawn on dated columns. The dates are orientation only:
 * `availability_rules` stores a day of the week and a time, with no date
 * anywhere, so painting Tuesday changes EVERY Tuesday. That is stated above
 * the grid permanently rather than in a toast somebody dismisses once, because
 * it is the difference between "I am free next Tuesday" and "I am free every
 * Tuesday for the rest of my employment".
 *
 * Times are the counsellor's own wall clock, read against `users.timezone` —
 * not the viewer's. A manager in Colombo editing someone in London who sets
 * 09:00 has set 09:00 in London.
 *
 * Booked meetings will appear here as a second kind of block. They have no
 * table yet (003's header: "slots come in 004"), so the legend says so rather
 * than the screen pretending they do not exist.
 */
import { useState } from "react";

import { FieldValidationError } from "@/api/errors";
import { useSession } from "@/data/SessionProvider";

import {
  COLUMN_DAYS,
  DAY_LABEL,
  SLOT_MINUTES,
  addDays,
  cellKey,
  cellsToRules,
  formatMinutes,
  mondayOf,
  offGridRules,
  rulesToCells,
  sameRules,
  totalHours,
  visibleSlotRange,
} from "../availability";
import { useSetUserAvailability, useUserAvailability } from "../queries";
import type { AvailabilityRule, User } from "../types";

export function AvailabilityGrid({ user }: { user: User }) {
  const { session, can } = useSession();
  const { data: saved, isPending, error } = useUserAvailability(user.id);

  // Self, or users.edit — the rule the endpoint enforces. Someone who cannot
  // set their own hours has them decided by a colleague in another timezone.
  const mayEdit = can("users.edit") || session?.user_id === user.id;

  if (isPending) {
    return (
      <section className="console-card mt-4">
        <div className="console-card-head">
          <h3 className="console-section-title">Availability</h3>
        </div>
        <div className="console-card-body">
          <p className="console-meta m-0">Reading the week…</p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="console-card mt-4">
        <div className="console-card-head">
          <h3 className="console-section-title">Availability</h3>
        </div>
        <div className="console-card-body">
          <p className="console-error m-0" role="alert">
            {(error as Error).message}
          </p>
        </div>
      </section>
    );
  }

  return <Grid user={user} saved={saved} mayEdit={mayEdit} />;
}

function Grid({
  user,
  saved,
  mayEdit,
}: {
  user: User;
  saved: AvailabilityRule[];
  mayEdit: boolean;
}) {
  const save = useSetUserAvailability(user.id);
  const [cells, setCells] = useState(() => rulesToCells(saved));
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [error, setError] = useState<string | null>(null);
  // Painting: whether the drag is adding or removing is decided by the first
  // cell, so dragging across a mixed selection does one thing rather than
  // inverting each cell under the cursor.
  const [painting, setPainting] = useState<null | boolean>(null);

  // Not memoised. The grid is at most 7 × 48 cells, and every one of these is a
  // single pass over it — while the hot path, dragging across cells, changes
  // `cells` on every mousemove and would invalidate the cache anyway. No child
  // here is memoised either, so a stable reference buys nothing. All a useMemo
  // would add is a dependency array to get wrong.
  const draft = cellsToRules(cells);
  const offGrid = offGridRules(saved);
  const [fromSlot, toSlot] = visibleSlotRange(cells);

  // The saved week put through the same round trip the draft went through.
  //
  // Comparing against `saved` directly is wrong: the API happily stores a split
  // shift as two windows, 09:00-12:00 and 12:00-17:00, and the grid paints
  // those as one contiguous run that merges back into a single 09:00-17:00.
  // Nothing has been edited, but the two lists differ — so Save lights up on
  // load and pressing it rewrites the week nobody touched.
  const dirty = !sameRules(draft, cellsToRules(rulesToCells(saved)));

  function paint(day: number, slot: number, on: boolean) {
    setCells((current) => {
      const next = new Set(current);
      const key = cellKey(day, slot);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  async function commit() {
    setError(null);
    try {
      // Off-grid rules are sent back untouched. They cannot be drawn on a
      // 30-minute grid, and dropping them because the UI cannot render them
      // would delete somebody's hours as a side effect of opening a screen.
      await save.mutateAsync([...offGrid, ...draft]);
    } catch (e: unknown) {
      setError(
        e instanceof FieldValidationError
          ? Object.values(e.fields)[0]
          : (e as Error).message,
      );
    }
  }

  const hours = totalHours(cells);

  return (
    <section className="console-card mt-4">
      <div className="console-card-head">
        <h3 className="console-section-title">Availability</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="console-btn"
            data-variant="secondary"
            aria-label="Previous week"
            onClick={() => setWeekStart(addDays(weekStart, -7))}
          >
            ‹
          </button>
          <span className="console-meta">
            Week of{" "}
            {weekStart.toLocaleDateString(undefined, {
              day: "numeric",
              month: "long",
            })}
          </span>
          <button
            type="button"
            className="console-btn"
            data-variant="secondary"
            aria-label="Next week"
            onClick={() => setWeekStart(addDays(weekStart, 7))}
          >
            ›
          </button>
        </div>
      </div>

      <div className="console-card-body">
        {/* Permanent, not dismissible. The dates above are for orientation and
            the pattern underneath is the same every week. */}
        <p className="console-week-note">
          These hours repeat every week. The dates are only to help you read the
          grid — changing Tuesday changes every Tuesday.
        </p>
        <p className="console-meta m-0 mt-1">
          Times are {user.timezone} —{" "}
          {user.name?.trim()
            ? `${user.name.trim().split(/\s+/)[0]}'s own timezone`
            : "this person's own timezone"}
          , not yours.
        </p>

        <div className="console-grid-scroll mt-4">
          <div
            className="console-grid"
            onMouseLeave={() => setPainting(null)}
            onMouseUp={() => setPainting(null)}
          >
            <div className="console-grid-corner" />
            {COLUMN_DAYS.map((day, i) => {
              const date = addDays(weekStart, i);
              return (
                <div key={day} className="console-grid-day">
                  <span className="console-grid-day-name">{DAY_LABEL[day]}</span>{" "}
                  <span className="console-grid-day-date">{date.getDate()}</span>
                </div>
              );
            })}

            {Array.from({ length: toSlot - fromSlot }, (_, row) => {
              const slot = fromSlot + row;
              const onHour = (slot * SLOT_MINUTES) % 60 === 0;
              return (
                <Row
                  key={slot}
                  slot={slot}
                  onHour={onHour}
                  cells={cells}
                  mayEdit={mayEdit}
                  painting={painting}
                  onPaintStart={(day, on) => {
                    setPainting(on);
                    paint(day, slot, on);
                  }}
                  onPaintOver={(day) => {
                    if (painting !== null) paint(day, slot, painting);
                  }}
                />
              );
            })}
          </div>
        </div>

        <div className="console-legend">
          <span className="console-legend-item">
            <span className="console-swatch" data-kind="available" />
            Available
          </span>
          <span className="console-legend-item">
            <span className="console-swatch" data-kind="booked" />
            Booked — appears here once meetings are live
          </span>
        </div>

        {offGrid.length ? (
          <p className="console-hint mt-3">
            {offGrid.length === 1 ? "One window is" : `${offGrid.length} windows are`}{" "}
            not on the half-hour and cannot be drawn here:{" "}
            {offGrid
              .map((r) => `${DAY_LABEL[r.day_of_week]} ${r.start_time}–${r.end_time}`)
              .join(", ")}
            . They are kept exactly as they are.
          </p>
        ) : null}

        {error ? (
          <p className="console-error mt-3" role="alert">
            {error}
          </p>
        ) : null}

        {mayEdit ? (
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              className="console-btn"
              data-variant="primary"
              onClick={commit}
              disabled={!dirty || save.isPending}
            >
              {save.isPending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="console-btn"
              data-variant="secondary"
              disabled={!dirty || save.isPending}
              onClick={() => {
                setCells(rulesToCells(saved));
                setError(null);
              }}
            >
              Discard
            </button>
            <span className="console-meta ml-1">
              {hours === 0
                ? "Nothing selected"
                : `${hours} hour${hours === 1 ? "" : "s"} a week`}
            </span>
          </div>
        ) : (
          <p className="console-meta mt-3">
            {hours === 0
              ? "No hours set."
              : `${hours} hours a week. Only they or a manager can change this.`}
          </p>
        )}
      </div>
    </section>
  );
}

function Row({
  slot,
  onHour,
  cells,
  mayEdit,
  painting,
  onPaintStart,
  onPaintOver,
}: {
  slot: number;
  onHour: boolean;
  cells: Set<string>;
  mayEdit: boolean;
  painting: null | boolean;
  onPaintStart: (day: number, on: boolean) => void;
  onPaintOver: (day: number) => void;
}) {
  return (
    <>
      <div className="console-grid-time" data-hour={onHour ? "true" : undefined}>
        {onHour ? formatMinutes(slot * SLOT_MINUTES) : ""}
      </div>
      {COLUMN_DAYS.map((day) => {
        const on = cells.has(cellKey(day, slot));
        const label = `${DAY_LABEL[day]} ${formatMinutes(slot * SLOT_MINUTES)}`;
        return (
          <button
            key={day}
            type="button"
            className="console-cell"
            data-on={on ? "true" : undefined}
            data-hour={onHour ? "true" : undefined}
            disabled={!mayEdit}
            // Space and Enter reach this through click, so the grid works
            // without a mouse. Drag-to-paint is an accelerator, never the only
            // way in.
            aria-pressed={on}
            aria-label={`${label}, ${on ? "available" : "not available"}`}
            onMouseDown={() => onPaintStart(day, !on)}
            onMouseEnter={() => (painting !== null ? onPaintOver(day) : undefined)}
            onClick={(e) => {
              // A plain click (no drag) still toggles: mousedown already did
              // the work, so only act on keyboard-generated clicks.
              if (e.detail === 0) onPaintStart(day, !on);
            }}
          />
        );
      })}
    </>
  );
}
