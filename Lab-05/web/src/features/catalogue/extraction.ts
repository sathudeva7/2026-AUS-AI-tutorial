/** Reading a programme off the university's own course page.
 *
 * The shape here is the argument. A crawler that handed back a plain
 * `ProgrammeWrite` would be asking the console to publish figures on a
 * model's say-so, and this product does not allow that of its own agent:
 * `update_lead_facts` refuses a fact whose words are not in the student's
 * messages. The page reader is held to the same standard — every value
 * arrives with the sentence it came from, and a value nobody has confirmed
 * can be SAVED as a draft but never VERIFIED.
 *
 * So each field is `Sourced<T>`, never a bare value.
 */

/** How well the page supports this value.
 *
 * Three states rather than a percentage, and deliberately the same
 * trichotomy `services/rules.py` evaluates requirements into. A "72%
 * confident" badge is a number nobody can act on; "here is the line, and it
 * is ambiguous" is one somebody can.
 *
 *  - `quoted`  the page says it, in the words under `quote`
 *  - `unclear` something on the page suggests it, but the line does not
 *              settle it — a fee page listing three fees, an intake month
 *              with no year
 *  - `absent`  not on this page. NOT a guess, and never filled from model
 *              knowledge: the box stays empty and the form says so.
 */
export type Evidence = "quoted" | "unclear" | "absent";

export interface Sourced<T> {
  /** Null when `evidence` is `absent` — there is nothing to propose. */
  value: T | null;
  evidence: Evidence;
  /** The words on the page. Null only when `absent`. */
  quote: string | null;
  /** The heading it sat under, so a person can find it again. */
  section: string | null;
}

/** A requirement the page implies, before anybody agrees to it.
 *
 * Kept apart from `RequirementRow` on purpose. A rule that quietly joined the
 * set would be an entry condition no human wrote, silently excluding students
 * — so a proposal has to be accepted one at a time, and accepting is what
 * turns it into a `RequirementRow`.
 */
export interface ProposedRequirement {
  fact_key: string;
  rule: string;
  description: string;
  evidence: Evidence;
  quote: string;
  section: string | null;
}

export interface ProposedIntake {
  /** YYYY-MM. */
  intake: string;
  application_deadline: string | null;
  evidence: Evidence;
  quote: string;
}

/** Everything one page yielded. Field names match `Draft` in the editor so
 *  the review step is the ordinary form, not a second screen that has to be
 *  kept in step with it. */
export interface Extraction {
  url: string;
  /** The host, for the line that says where this came from. */
  source: string;
  fields: {
    name: Sourced<string>;
    institution: Sourced<string>;
    country: Sourced<string>;
    city: Sourced<string>;
    level: Sourced<string>;
    field: Sourced<string>;
    tuition_per_year: Sourced<string>;
    currency: Sourced<string>;
    duration_months: Sourced<string>;
  };
  intakes: ProposedIntake[];
  requirements: ProposedRequirement[];
}

export type ExtractedKey = keyof Extraction["fields"];

/** The order the reader works in, which is the order the form is laid out in.
 *  Shown as it happens rather than behind a spinner — the student widget
 *  already shows the agent's tool calls as they run, and this is the same
 *  promise made to the counsellor. */
export interface ReadStage {
  id: string;
  label: string;
  /** Roughly how long this leg takes, in ms. */
  ms: number;
}

export const READ_STAGES: ReadStage[] = [
  { id: "fetch", label: "Fetching the page", ms: 900 },
  { id: "identity", label: "Name, award level, duration", ms: 700 },
  { id: "fees", label: "Tuition", ms: 600 },
  { id: "requirements", label: "Entry requirements", ms: 1100 },
  { id: "intakes", label: "Intakes and deadlines", ms: 700 },
];

/** Which stage each field comes out of, so the readout can tick a leg off
 *  and the review can group what landed. */
export const STAGE_OF: Record<ExtractedKey, string> = {
  name: "identity",
  institution: "identity",
  country: "identity",
  city: "identity",
  level: "identity",
  field: "identity",
  duration_months: "identity",
  tuition_per_year: "fees",
  currency: "fees",
};
