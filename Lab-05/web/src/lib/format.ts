/** Money, dates and the small derived strings the console repeats.
 *
 * CLAUDE.md convention: "Money in minor units with currency stored alongside."
 * The timezone half of that rule changed — see VIEWER_TIMEZONE below and the
 * Conventions section of CLAUDE.md. The seed catalogue
 * stores `tuition_per_year` as a major-unit float with its own `currency`
 * beside it, so nothing here assumes a symbol — pass the currency or get an
 * exception, never a silent "£".
 */

/** Times are stored UTC and rendered in the VIEWER's timezone, not the
 *  tenant's.
 *
 *  An agency is not in one place. A consultancy with branches in Colombo and
 *  London has counsellors in both, and a single tenant timezone would show one
 *  of them the wrong clock. Rendering locally means each person reads their
 *  own — which is also what the student in the widget needs.
 *
 *  The consequence: a bare time is ambiguous across zones. Anything naming a
 *  moment two people must both turn up to — a booked consultation — has to
 *  carry its zone. Use `formatDateTimeWithZone` for those, never `formatTime`.
 */
export const VIEWER_TIMEZONE =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
export const TENANT_LOCALE = "en-GB";

export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat(TENANT_LOCALE, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Minor units (pence, cents) to a display string. The catalogue does not use
 *  this yet — the seed stores major units — but anything written against the
 *  real Postgres schema will. */
export function formatMinorUnits(minor: number, currency: string): string {
  return formatMoney(minor / 100, currency);
}

function parse(iso: string): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "14 Nov 2026" */
export function formatDate(iso: string): string {
  const d = parse(iso);
  if (!d) return "—";
  return new Intl.DateTimeFormat(TENANT_LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: VIEWER_TIMEZONE,
  }).format(d);
}

/** "Thursday 13 August, 10:30 AM" — the booking confirmation line. */
export function formatDateTime(iso: string): string {
  const d = parse(iso);
  if (!d) return "—";
  return new Intl.DateTimeFormat(TENANT_LOCALE, {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: VIEWER_TIMEZONE,
  }).format(d);
}

/** "Thursday 13 August, 10:30 AM GMT+5:30" — for anything two people in
 *  different countries must both attend. The zone is not optional here: a
 *  student in Dubai booking a Colombo counsellor who reads "10:30" and shows
 *  up at their own 10:30 has missed the call. */
export function formatDateTimeWithZone(iso: string): string {
  const d = parse(iso);
  if (!d) return "—";
  return new Intl.DateTimeFormat(TENANT_LOCALE, {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
    timeZone: VIEWER_TIMEZONE,
  }).format(d);
}

/** "11:04 PM" — the widget clock and transcript gutter.
 *
 *  Relative, in-conversation times only. Never use this for a booking. */
export function formatTime(iso: string): string {
  const d = parse(iso);
  if (!d) return "";
  return new Intl.DateTimeFormat(TENANT_LOCALE, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: VIEWER_TIMEZONE,
  }).format(d);
}

export function daysSince(iso: string, now: Date = new Date()): number | null {
  const d = parse(iso);
  if (!d) return null;
  return Math.floor((now.getTime() - d.getTime()) / 86_400_000);
}

/** "12 days ago", "3 weeks ago", "94 days ago · stale".
 *
 *  Every catalogue figure the agent states travels with the date it was last
 *  checked, so this string is part of the fact, not a footnote. Anything past
 *  `staleAfterDays` says so in words — a counsellor reading a fee needs to
 *  know it may have moved. */
export function verifiedLabel(iso: string, staleAfterDays = 30): string {
  const days = daysSince(iso);
  if (days === null) return "never verified";
  const stale = days > staleAfterDays;
  let phrase: string;
  if (days <= 0) phrase = "today";
  else if (days === 1) phrase = "yesterday";
  else if (days < 14) phrase = `${days} days ago`;
  else if (days < 60) phrase = `${Math.round(days / 7)} weeks ago`;
  else phrase = `${days} days ago`;
  return stale ? `${phrase} · stale` : phrase;
}

export function isStale(iso: string, staleAfterDays = 30): boolean {
  const days = daysSince(iso);
  return days === null || days > staleAfterDays;
}

/** "2027-01" → "January 2027". Intakes are stored as year-month strings. */
export function formatIntake(intake: string): string {
  const [year, month] = intake.split("-");
  const index = Number(month) - 1;
  const names = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return names[index] ? `${names[index]} ${year}` : intake;
}

/** "PR" from "Priya Rajapaksa". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "—";
}

/** Confidence to the monospace "fit 0.94" the shortlist shows. */
export function formatFit(confidence: number): string {
  return `fit ${confidence.toFixed(2)}`;
}

/** Sentence-case a snake_case enum for display when there is no label map. */
export function humanise(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** A fact value as a number, or undefined if it is not cleanly one.
 *
 * Fact values are `str | float | int` on the Python side and the two paths
 * disagree in practice: the seed book stores `budget_per_year: 50000` as a
 * number, while `update_lead_facts` writes whatever string the agent
 * normalised to — a live turn stored `"25000"`. A bare `typeof x === "number"`
 * check therefore silently ignores every budget a student actually stated,
 * which is how the shortlist's Stretch band quietly stops working.
 *
 * Parsing stops at cleanly numeric text. "25,000" and " 25000 " are a number;
 * "about 25000 per year" is not, and returns undefined rather than a guess —
 * a budget ceiling read wrong pushes a programme into the wrong band, and
 * "we do not know" is the honest outcome.
 */
export function numericFact(
  value: string | number | undefined | null,
): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim().replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}
