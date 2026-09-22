/** Turning a catalogue row into what the console shows.
 *
 * Shared by the table and the editor, because the two disagreeing is how a
 * programme reads "Active" in one place and "Draft" in the other.
 */
import type { ProgrammeRow } from "./types";

/** The states a row can be in, and they are not the same question.
 *
 * `draft` and `archived` are about VISIBILITY — the agent cannot use the row
 * at all. `stale` is about AGE: the agent may still state the figure, but
 * nobody has checked it inside the window. Collapsing them would hide the one
 * that stops a programme being matched.
 */
export type RowStatus = "draft" | "archived" | "stale" | "active";

/** `staleAfterDays` comes from the server, with the rows.
 *
 * Not a constant here. The server filters "Needs check" by comparing
 * `verified_at` against its own window, and a second number in the client
 * would eventually disagree — showing a row badged stale that the stale
 * filter does not return.
 */
export function rowStatus(
  programme: ProgrammeRow,
  staleAfterDays: number,
): RowStatus {
  if (programme.status === "draft") return "draft";
  if (programme.status === "archived") return "archived";
  if (!programme.verified_at) return "stale";
  const days =
    (Date.now() - new Date(programme.verified_at).getTime()) / 86_400_000;
  return days > staleAfterDays ? "stale" : "active";
}

export const STATUS_LABEL: Record<RowStatus, string> = {
  draft: "Draft",
  archived: "Archived",
  stale: "Needs check",
  active: "Active",
};

/** `level` is stored as a slug — the seed catalogue is all "masters" — and a
 *  column reading "masters" under every programme name looks like a bug. An
 *  unknown value passes through rather than being blanked: a level this build
 *  has not seen is still a fact about the programme. */
const LEVEL_LABEL: Record<string, string> = {
  masters: "Master's degree",
  bachelors: "Bachelor's degree",
  phd: "Doctorate (PhD)",
  doctorate: "Doctorate",
  diploma: "Diploma",
  certificate: "Certificate",
  foundation: "Foundation",
};

export function levelLabel(level: string | null): string {
  if (!level) return "—";
  return LEVEL_LABEL[level.toLowerCase()] ?? level;
}

/** Two initials for an institution, so a table of fourteen universities has
 *  something to scan down other than a column of similar long names. */
export function orgInitials(institution: string | null): string {
  if (!institution) return "—";
  const words = institution.split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "—";
}
