/** Turning a stored week into a grid, and a grid back into a stored week.
 *
 * Pure. The grid component paints cells; every rule about what a valid week is
 * lives here, where it can be reasoned about without a browser.
 *
 * Two things the API will refuse, so the grid must not produce them:
 *   - overlapping windows on one day
 *   - a shift crossing midnight, which has to be sent as 22:00-24:00 plus
 *     00:00-02:00
 * Building rules by merging runs of adjacent cells makes both impossible by
 * construction rather than by validation.
 */
import type { AvailabilityRule } from "./types";

export const SLOT_MINUTES = 30;
/** 00:00 through 23:30. Slot 48 is the exclusive end of the day, 24:00. */
export const SLOTS_PER_DAY = (24 * 60) / SLOT_MINUTES;

/** Monday first, because that is how a working week reads.
 *
 * The VALUES are `day_of_week` as the database stores it — 0 is Sunday, per
 * the CHECK on availability_rules and JS getDay(). Column order and stored
 * number are different things, and conflating them is the classic bug in this
 * table: everything lands one day out and looks plausible.
 */
export const COLUMN_DAYS = [1, 2, 3, 4, 5, 6, 0] as const;

export const DAY_LABEL: Record<number, string> = {
  0: "Sun",
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
};

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** A cell's identity. Day first so a sort groups by day. */
export function cellKey(day: number, slot: number): string {
  return `${day}:${slot}`;
}

/** Rules that do not land on the grid.
 *
 * The column stores any time; a 30-minute grid can only express multiples of
 * 30. An existing 09:15-17:45 cannot be drawn, and rounding it would change
 * somebody's stated hours without asking — on a screen that decides when
 * students can book them. So it is reported, shown, and left alone.
 */
export function offGridRules(rules: AvailabilityRule[]): AvailabilityRule[] {
  return rules.filter(
    (r) =>
      minutesOf(r.start_time) % SLOT_MINUTES !== 0 ||
      minutesOf(r.end_time) % SLOT_MINUTES !== 0,
  );
}

/** The painted cells for the rules that DO land on the grid. */
export function rulesToCells(rules: AvailabilityRule[]): Set<string> {
  const cells = new Set<string>();
  for (const rule of rules) {
    const from = minutesOf(rule.start_time);
    const to = minutesOf(rule.end_time);
    if (from % SLOT_MINUTES || to % SLOT_MINUTES) continue;
    for (let m = from; m < to; m += SLOT_MINUTES) {
      cells.add(cellKey(rule.day_of_week, m / SLOT_MINUTES));
    }
  }
  return cells;
}

/** Painted cells back to the smallest set of rules that covers them.
 *
 * Adjacent cells merge into one window, so a full day is one row rather than
 * 48. Merging is also what keeps the result legal: runs of cells cannot
 * overlap each other, and a run stops at the end of its day, so nothing can
 * cross midnight.
 *
 * Ordered by day then start — the same order the API returns — so a saved week
 * and a reloaded one compare equal.
 */
export function cellsToRules(cells: Set<string>): AvailabilityRule[] {
  const byDay = new Map<number, number[]>();
  for (const key of cells) {
    const [day, slot] = key.split(":").map(Number);
    const slots = byDay.get(day) ?? [];
    slots.push(slot);
    byDay.set(day, slots);
  }

  const rules: AvailabilityRule[] = [];
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    const slots = [...byDay.get(day)!].sort((a, b) => a - b);
    let runStart = slots[0];
    let previous = slots[0];

    for (const slot of slots.slice(1)) {
      if (slot === previous + 1) {
        previous = slot;
        continue;
      }
      rules.push(runToRule(day, runStart, previous));
      runStart = slot;
      previous = slot;
    }
    rules.push(runToRule(day, runStart, previous));
  }
  return rules;
}

function runToRule(day: number, first: number, last: number): AvailabilityRule {
  return {
    day_of_week: day,
    start_time: formatMinutes(first * SLOT_MINUTES),
    // Exclusive end. A run ending in the last slot of the day ends at 1440,
    // which formats as "24:00" — legal in Postgres `time`, and the only way to
    // say "until midnight" while end_time > start_time still holds.
    end_time: formatMinutes((last + 1) * SLOT_MINUTES),
  };
}

/** True when two weeks are the same week, so Save can be disabled and a
 *  no-op click does not fire a full-week write. */
export function sameRules(a: AvailabilityRule[], b: AvailabilityRule[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (rule, i) =>
      rule.day_of_week === b[i].day_of_week &&
      rule.start_time === b[i].start_time &&
      rule.end_time === b[i].end_time,
  );
}

/** Total hours painted, for the summary line. */
export function totalHours(cells: Set<string>): number {
  return (cells.size * SLOT_MINUTES) / 60;
}

/** The Monday of the week `date` falls in.
 *
 * Dates are orientation only. The stored pattern has no dates in it at all —
 * paint on any week and it is the same edit — but a column headed "Tue 14"
 * reads faster than one headed "Tue".
 */
export function mondayOf(date: Date): Date {
  const monday = new Date(date);
  const shift = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - shift);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** The slot range worth showing.
 *
 * A full day is 48 rows, most of them empty at 3am. Default to a working
 * window, then widen it to include anything actually painted — someone with a
 * night shift for Australian students must see it, and a grid that silently
 * hides stored hours is worse than a tall one.
 */
export function visibleSlotRange(cells: Set<string>): [number, number] {
  let from = 14; // 07:00
  let to = 44; // 22:00, exclusive
  for (const key of cells) {
    const slot = Number(key.split(":")[1]);
    from = Math.min(from, slot);
    to = Math.max(to, slot + 1);
  }
  return [from, to];
}
