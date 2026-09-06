/** Domain types, mirrored from `Lab-05/mocks/models.py`.
 *
 * These are the shapes the backend actually stores and the agent's tools
 * actually return. Keep the literal unions in step with the Python
 * `Literal[...]` declarations — they are closed sets on purpose, and the UI
 * relies on that to switch exhaustively.
 */

// ---------------------------------------------------------------------------
// Closed sets
// ---------------------------------------------------------------------------

/** The result of evaluating one entry requirement against a lead's facts.
 *
 * `indeterminate` is a first-class member and CLAUDE.md forbids collapsing it
 * anywhere in the stack: it means "a document would settle this", which is a
 * different instruction to the student than either pass or fail. Nothing in
 * this frontend may reduce a Verdict to a boolean. See lib/verdict.ts. */
export type Verdict = "pass" | "fail" | "indeterminate";

export type LeadStatus =
  | "active"
  | "parked"
  | "escalated"
  | "withdrawn"
  | "converted";

/** Escalation is rule-driven, so the triggers are a closed set rather than
 *  free text the model composes. */
export type EscalationTrigger =
  | "visa_refusal"
  | "fee_dispute"
  | "dependants_or_sponsorship"
  | "low_confidence"
  | "student_requested_human"
  | "visa_or_immigration_advice"
  | "system_failure";

export type FollowupStatus = "pending" | "fired" | "cancelled";

export type FollowupKind =
  | "document_chase"
  | "test_result"
  | "intake_cutoff"
  | "deposit_deadline"
  | "catalogue_verification";

/** The seven facts a lead can state. Nothing outside this list is a fact. */
export type FactKey =
  | "target_country"
  | "field_of_study"
  | "qualification"
  | "grades"
  | "english_test"
  | "budget_per_year"
  | "intended_intake";

export const FACT_KEYS: readonly FactKey[] = [
  "target_country",
  "field_of_study",
  "qualification",
  "grades",
  "english_test",
  "budget_per_year",
  "intended_intake",
] as const;

export const FACT_LABELS: Record<FactKey, string> = {
  target_country: "Destination",
  field_of_study: "Field of study",
  qualification: "Qualification",
  grades: "Result",
  english_test: "English test",
  budget_per_year: "Budget",
  intended_intake: "Intended intake",
};

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/** A stated fact and the student's own words that carry it.
 *
 *  `source_quote` is not decoration. `update_lead_facts` rejects a write whose
 *  quote is not present in the student's messages, so every fact on file is
 *  backed by something the student actually typed — and the UI has to be able
 *  to show it. */
export interface Fact {
  value: string | number;
  source_quote: string;
  stated_at: string;
}

/** `GET /api/leads` returns facts already flattened to their values, plus the
 *  list of keys nobody has asked yet. The seed JSON carries the full `Fact`
 *  objects, so the quote is available for fixture-backed leads. */
export interface Lead {
  lead_id: string;
  name: string | null;
  email: string;
  country_of_residence: string | null;
  status: LeadStatus;
  assigned_counsellor_id: string | null;
  /** Known facts, value-only. */
  facts: Partial<Record<FactKey, string | number>>;
  /** Keys with nothing on file. This is what makes "ask, never infer" visible
   *  before a single message is sent. */
  missing: FactKey[];
  created_at?: string;
  /** Present on leads read from the seed book, absent from `/api/leads`. */
  quotes?: Partial<Record<FactKey, Fact>>;
}

export interface Message {
  lead_id: string;
  role: "student" | "agent";
  content: string;
  timestamp: string;
}

/** One row of the audit trail. Every agent decision is replayable from these
 *  plus Messages — which is why the dashboard rebuilds the shortlist from
 *  recorded `build_shortlist` calls rather than from a stored shortlist. */
export interface ToolCall {
  call_id: string;
  lead_id: string;
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  ok: boolean;
  error: string | null;
  agent_id: string;
  timestamp: string;
}

export interface Requirement {
  requirement_id: string;
  key: FactKey;
  /** Machine-ish rule text, e.g. "bachelor_years>=4". */
  rule: string;
  /** What the student would be told, in plain English. */
  description: string;
  mandatory: boolean;
}

export interface Programme {
  programme_id: string;
  institution: string;
  country: string;
  city: string;
  name: string;
  level: string;
  field: string;
  tuition_per_year: number;
  currency: string;
  duration_months: number;
  /** e.g. ["2027-01", "2027-09"] */
  intakes: string[];
  application_deadline: string;
  requirements: Requirement[];
  /** ISO date this entry was last confirmed. Every figure the agent states
   *  travels with this date. */
  verified_at: string;
  /** Official source URL. Not in the Python model — the catalogue console
   *  edits it and the refresh job would read it. */
  source_url?: string;
  /** Local-only: a programme added or edited in this session and not yet
   *  visible to the agent. */
  draft?: boolean;
}

export interface RequirementCheck {
  requirement_id: string;
  key: FactKey;
  verdict: Verdict;
  reason: string;
  mandatory: boolean;
  /** The document that would settle an `indeterminate`. */
  resolving_document: string | null;
  missing_fact: boolean;
}

export interface EligibilityResult {
  programme_id: string;
  checks: RequirementCheck[];
  verdict: Verdict;
  confidence: number;
  hinge_requirement_id: string | null;
  missing_facts: FactKey[];
  pending_documents: string[];
}

export interface ShortlistEntry {
  programme_id: string;
  confidence: number;
  /** The one requirement the outcome turns on, in plain English. */
  hinge: string;
  verdict: Verdict;
  resolving_document: string | null;
  missing_facts: FactKey[];
}

export interface Shortlist {
  lead_id: string;
  entries: ShortlistEntry[];
  overall_confidence: number;
}

export interface Counsellor {
  counsellor_id: string;
  name: string;
  email: string;
  /** Routing is by owned country. No owner for a country means the lead joins
   *  the unassigned queue — the agent never round-robins to fill the gap. */
  countries: string[];
  active: boolean;
}

export interface Escalation {
  escalation_id: string;
  lead_id: string;
  trigger: EscalationTrigger;
  /** What the counsellor needs so they do not re-investigate. */
  detail: string;
  counsellor_id: string | null;
  created_at: string;
}

export interface Followup {
  followup_id: string;
  lead_id: string;
  kind: FollowupKind;
  due_at: string;
  reason: string;
  status: FollowupStatus;
  created_at: string;
}

export interface Slot {
  slot_id: string;
  lead_id: string;
  counsellor_id: string;
  starts_at: string;
  duration_minutes: number;
  created_at: string;
}

/** `GET /api/briefing` — everything written about one lead. */
export interface Briefing {
  lead_id: string;
  name: string | null;
  status: LeadStatus;
  assigned_counsellor_id: string | null;
  facts: Partial<Record<FactKey, string | number>>;
  missing: FactKey[];
  escalations: Escalation[];
  followups: Followup[];
  slots: Slot[];
  tool_calls: ToolCall[];
}

// ---------------------------------------------------------------------------
// Presentation-only records — the prototype shows these, the backend has no
// model for them. They live in data/fixtures and are marked here so nobody
// mistakes them for something the agent can read or write.
// ---------------------------------------------------------------------------

export interface CounsellorProfile {
  counsellor_id: string;
  role: string;
  subhead: string;
  status: "Accepting" | "Supervised" | "On leave" | "Admin only" | "Invited";
  initials: string;
  caseload: { active: number; cap: number; note: string };
  stats: { label: string; value: string }[];
  specialisations: string[];
  routing: { label: string; value: string }[];
  /** Five weekday rows. `hours` null means unavailable. */
  availability: {
    day: string;
    hours: string | null;
    /** Percentages across a 07:00–19:00 day, for the bar. */
    startPct: number;
    widthPct: number;
  }[];
  availabilityNote: string;
  permissions: { label: string; state: "Allowed" | "Denied" | "Pending" }[];
  assigned: { name: string; want: string; stage: string; next: string }[];
}

/** One item the overnight refresh job raised for human review. The job never
 *  writes to the catalogue itself — approval is the only path in. */
export interface RefreshItem {
  item_id: string;
  programme: string;
  field: string;
  was: string;
  now: string;
  source: string;
  state: "awaiting" | "approved" | "rejected" | "unchanged";
}

export interface TenantConfig {
  name: string;
  city: string;
  catalogue_country: string;
  public_key: string;
  secret_key_masked: string;
  allowed_origins: string[];
  last_used: string;
  widget: { accent: string; greeting: string; position: "left" | "right" };
}
