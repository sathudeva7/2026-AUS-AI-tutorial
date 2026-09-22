/** The catalogue as `GET /api/programmes` returns it.
 *
 * Deliberately NOT `data/types.ts`'s `Programme`, which is the shape the
 * fixture and the agent speak. The two are different worlds and will be until
 * the agent reads Postgres: a shortlist entry names `p_uk_001`, this names a
 * uuid. One type stretched across both would be a type that is half true
 * everywhere, so the widget keeps the old one and the console gets this.
 */

export type ProgrammeStatus = "draft" | "published" | "archived";

export interface ProgrammeRow {
  id: string;
  name: string;
  /** Null while a draft is being written; required before it can be verified. */
  institution: string | null;
  institution_id: string | null;
  level: string | null;
  field: string | null;
  /** ISO 3166-1 alpha-2. The same units `user_countries` stores, which is what
   *  lets routing and the coverage banner agree with the catalogue. */
  country: string | null;
  city: string | null;
  /** Pence, cents, or whatever `currency` divides into. Never a float — see
   *  `formatMinorUnits`, which needs the currency to render it. */
  tuition_per_year_minor: number | null;
  currency: string | null;
  duration_months: number | null;
  status: ProgrammeStatus;
  /** Null means NEVER checked, which is a different claim from checked long
   *  ago, and the table draws them differently. */
  verified_at: string | null;
  /** Somebody changed a figure after the last verification. The row is still
   *  live — clearing the stamp would have pulled it away from students — so
   *  this is how the table says the fee moved since anyone confirmed it. */
  edited_since_verified: boolean;
  /** The soonest intake still open. Both null once every intake has passed,
   *  so the table can say so instead of showing a date nobody can act on. */
  next_intake: string | null;
  next_deadline: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProgrammeListParams {
  search?: string;
  country?: string;
  /** The SCREEN's vocabulary. "stale" is not a column — the server turns it
   *  into a comparison against `verified_at`. */
  status?: "active" | "stale" | "draft" | "archived" | "all";
  limit?: number;
  offset?: number;
}

export interface ProgrammeCounts {
  all: number;
  active: number;
  stale: number;
  draft: number;
  archived: number;
  institutions: number;
  countries: number;
}

export interface ProgrammeListResult {
  rows: ProgrammeRow[];
  total: number;
  counts: ProgrammeCounts;
  /** Every destination in the catalogue, not just the ones on this page. */
  countries: string[];
  /** The server's own staleness rule, so the badge this screen draws and the
   *  filter the server runs cannot drift into disagreeing. */
  staleAfterDays: number;
}

/** One intake, as the detail endpoint returns it and as PUT /intakes takes it.
 *
 * The deadline belongs to the INTAKE, not the programme. January and
 * September close months apart, and one date shared across both is how the
 * agent quotes the wrong one to half the students.
 */
export interface IntakeRow {
  /** YYYY-MM. */
  intake: string;
  application_deadline: string | null;
  is_open: boolean;
}

/** One entry requirement. `fact_key` here, not `key`: this is the server's
 *  vocabulary, and the evaluator dispatches on it. */
export interface RequirementRow {
  id?: string;
  fact_key: string;
  rule: string;
  description: string;
  mandatory: boolean;
}

/** `GET /api/programmes/{id}` — the row plus everything hanging off it. */
export interface ProgrammeDetail extends ProgrammeRow {
  intakes: IntakeRow[];
  requirements: RequirementRow[];
}

/** What POST and PATCH accept.
 *
 * `tuition_per_year` is a STRING — the figure as the counsellor typed it,
 * with its currency beside it. The server converts to minor units, because
 * how many of them make one unit is a property of the currency (JPY has
 * none, BHD has three) and the client has no business knowing that table on
 * the write path.
 *
 * `status` and `verified_at` are absent on purpose: they move through
 * /verify and /archive, which check a different permission.
 */
export interface ProgrammeWrite {
  name?: string;
  institution?: string | null;
  /** ISO 3166-1 alpha-2. The server refuses anything else. */
  country?: string | null;
  city?: string | null;
  level?: string | null;
  field?: string | null;
  tuition_per_year?: string | null;
  currency?: string | null;
  duration_months?: number | null;
}
