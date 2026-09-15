/** Turning a catalogue row into what the console shows.
 *
 * Shared by the table and the editor, because the two disagreeing is how a
 * programme reads "Active" in one place and "Draft" in the other.
 */
import { isStale } from "@/lib/format";
import type { Programme } from "@/data/types";

/** The three states a row can be in, and they are not the same question.
 *
 * `draft` is about VISIBILITY — the agent cannot use the row at all. Stale is
 * about AGE: the agent may still state the figure, but nobody has checked it
 * in over a month. Collapsing them into one status would hide the one that
 * stops a programme being matched.
 */
export type RowStatus = "draft" | "stale" | "active";

export function statusOf(programme: Programme): RowStatus {
  if (programme.draft) return "draft";
  return isStale(programme.verified_at) ? "stale" : "active";
}

export const STATUS_LABEL: Record<RowStatus, string> = {
  draft: "Draft",
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

export function levelLabel(level: string): string {
  return LEVEL_LABEL[level.toLowerCase()] ?? level;
}

/** Two initials for an institution, so a table of fourteen universities has
 *  something to scan down other than a column of similar long names. */
export function orgInitials(institution: string): string {
  const words = institution.split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "—";
}
