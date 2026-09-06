/** Canned answers for the counsellor assistant.
 *
 * The counsellor agent is a separate service on :8002 with a read-only tool
 * set (`list_leads`, `get_lead_briefing`, `get_lead_timeline`,
 * `get_unassigned_queue` in mcp_servers/northbound). It does not exist in
 * this lab, so this surface has no live backend.
 *
 * These three answers are true of the seed data — check them against
 * `leads.json` and `programmes.json` before editing. A question outside this
 * set returns `null` and the surface says the assistant is not connected. It
 * does not improvise: an assistant that invents an answer about a real
 * student's file is worse than one that admits it is offline.
 */
import type { Verdict } from "../types";

export interface AssistantRow {
  key: string;
  value: string;
  /** A verdict where the row is one, or a plain status word where it is not. */
  verdict?: Verdict;
  status?: string;
}

export interface AssistantAnswer {
  id: string;
  question: string;
  title: string;
  /** Which tool tier the answer came from — Tier 1 is tenant-scoped truth. */
  tier: string;
  body: string;
  rows: AssistantRow[];
}

export const SUGGESTED_ANSWERS: AssistantAnswer[] = [
  {
    id: "english-unresolved",
    question: "Which leads have English unresolved?",
    title: "Two leads with an unresolved English requirement",
    tier: "Tier 1 · tenant-scoped",
    body: "Neither was excluded. The requirement is recorded as unresolved rather than failed, so their programmes stay visible and a single document settles each one.",
    rows: [
      {
        key: "Ravi Menon",
        value: "No English test on file · UK · business analytics",
        verdict: "indeterminate",
      },
      {
        key: "Tomás Herrera",
        value: "Six of seven facts missing · Canada stated, nothing else",
        verdict: "indeterminate",
      },
    ],
  },
  {
    id: "camden-ananya",
    question: "Why was Camden Met not a strong match for Ananya?",
    title: "One requirement could not be settled, the rest passed",
    tier: "Tier 1 · from stored evaluation",
    body: "The evaluation is stored per requirement, so this is a lookup rather than a judgement. Ananya met every rule except the degree-length one, which is unresolved rather than failed — a transcript showing her credit hours settles it either way.",
    rows: [
      {
        key: "Degree length",
        value: "3-year BSc against a 4-year minimum · transcript would settle it",
        verdict: "indeterminate",
      },
      { key: "Grades", value: "72% against a 65% minimum", verdict: "pass" },
      { key: "English", value: "IELTS 6.5 against a 6.5 minimum", verdict: "pass" },
      {
        key: "Tuition against budget",
        value: "GBP 24,500 against a GBP 25,000 ceiling",
        verdict: "pass",
      },
    ],
  },
  {
    id: "unassigned",
    question: "Who is sitting in the unassigned queue?",
    title: "One lead with no owning counsellor",
    tier: "Tier 1 · tenant-scoped",
    body: "Routing is by owned country. Stefan Brandt is the only counsellor covering Germany and he is inactive, so Fatima's lead waits rather than being handed to someone who does not cover it. Activating a counsellor for Germany is what clears this — the agent will not round-robin to fill the gap.",
    rows: [
      {
        key: "Fatima Al-Rashid",
        value: "Germany · mechanical engineering · no active owner for Germany",
        status: "Unassigned",
      },
    ],
  },
];

export function answerFor(question: string): AssistantAnswer | null {
  const normalised = question.trim().toLowerCase();
  return (
    SUGGESTED_ANSWERS.find(
      (a) => a.question.toLowerCase() === normalised,
    ) ?? null
  );
}
