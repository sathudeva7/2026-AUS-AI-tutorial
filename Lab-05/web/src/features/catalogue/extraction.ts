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
 *
 * This is the WIRE shape of `POST /api/programmes/read`. The server has
 * already checked every quote against the page text and already converted
 * every value into the units the catalogue stores — "MSc" arrives as
 * `masters`, "United Kingdom" as `GB`. Nothing here re-reads or re-converts;
 * doing either would be a second opinion the counsellor cannot see.
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
 *              with no year. Also what a value the server could not convert
 *              comes back as: "please contact us" is not a fee.
 *  - `absent`  not on this page. NOT a guess, and never filled from model
 *              knowledge: the box stays empty and the form says so.
 */
export type Evidence = "quoted" | "unclear" | "absent";

/** `absent` never reaches a list — a proposal nobody can source is dropped
 *  outright rather than offered with an empty slot beside it. Not exported:
 *  it is a narrowing of `Evidence` for the two list shapes below, not a
 *  vocabulary anything outside this file speaks. */
type ProposalEvidence = "quoted" | "unclear";

export interface Sourced<T> {
  /** Null when `evidence` is `absent`, and when the page said something the
   *  server could not turn into a catalogue value. */
  value: T | null;
  evidence: Evidence;
  /** The words on the page. Null only when `absent`. */
  quote: string | null;
  /** The heading it sat under, so a person can find it again. */
  section: string | null;
}

/** One entry requirement, as the page words it.
 *
 * FREE TEXT, and not saved anywhere. `programme_requirements` needs a
 * `fact_key` and a `rule`, and the reader produces neither yet — turning
 * prose into a threshold is its own piece of work. So these are shown for a
 * person to read while they fill the requirements builder themselves, and
 * they disappear when the form is saved. The screen has to say so.
 *
 * Kept as prose rather than forced into a rule because most of what a page
 * states has no threshold form at all: a portfolio, two references, two
 * years of work. A requirement nothing can evaluate is still one a
 * counsellor needs to have read.
 */
export interface RequirementPoint {
  text: string | null;
  quote: string | null;
  section: string | null;
  evidence: ProposalEvidence;
}

/** One start date the page names.
 *
 * Both the page's words and what the server made of them, because the review
 * step is comparing the two. `intake` is null when the page gave a month and
 * no year — the commonest case, and the one the counsellor has to finish by
 * hand. Guessing the year would put a deadline on screen that nobody
 * published.
 */
export interface ProposedIntake {
  /** As the page says it — "September". */
  month: string | null;
  /** Null unless the quoted sentence itself carried the year. */
  year: string | null;
  /** As the page says it — "12 August 2027". */
  application_deadline: string | null;
  /** 'YYYY-MM', or null while the year is unknown. */
  intake: string | null;
  /** ISO date, or null. */
  deadline_date: string | null;
  evidence: ProposalEvidence;
  quote: string | null;
  section: string | null;
}

/** Everything one page yielded. Field names match `Draft` in the editor so
 *  the review step is the ordinary form, not a second screen that has to be
 *  kept in step with it. */
export interface Extraction {
  /** Where the fetch ENDED. Course pages redirect to the current year's
   *  entry, and the page that was read is the one worth recording. */
  url: string;
  title: string | null;
  /** The page as the reader saw it. Not shown by default — it is here so a
   *  thin extraction can be checked against what was actually read. */
  text: string;
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
  requirements: RequirementPoint[];
  /** True when the page refused to be fetched and an agent researched it.
   *
   * Weaker evidence, and the screen must say so. Nothing in a researched
   * reading was checked against the page — there was no page text to check
   * it against — and a value or two may have come off a different website
   * entirely, which is why each one carries the host that was cited for it.
   * Everything arrives `unclear`; none of it is ever `quoted`. */
  researched: boolean;
}

export type ExtractedKey = keyof Extraction["fields"];

/** The host, for the line that says where this came from. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    // A url the browser cannot parse still got read; the label just falls
    // back to whatever was typed rather than throwing on a cosmetic line.
    return url;
  }
}
