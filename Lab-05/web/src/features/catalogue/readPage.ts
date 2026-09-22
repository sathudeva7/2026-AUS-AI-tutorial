/** THE PAGE READER — A MOCK. Nothing here touches the network.
 *
 * This exists so the flow can be walked through and argued with before any
 * of it is built. It returns one canned extraction on a timer, shaped exactly
 * as the real endpoint will answer, and it is deliberately the ONLY module
 * that knows the reading is fake.
 *
 * Replacing it is one function: `readPage` becomes
 * `POST /api/programmes/read` with the url, streaming stage events back over
 * SSE the way `/api/run` already does for the agent (see `lib/sse.ts`). The
 * component calling it does not change, because what it consumes — stages
 * landing in order, then an `Extraction` — is what the server will send.
 *
 * The canned figures are placeholder, in the same spirit as the seed
 * catalogue: Camden Metropolitan is the fixtures' invented university.
 */
import {
  READ_STAGES,
  type Extraction,
  type ProposedIntake,
  type ProposedRequirement,
  type Sourced,
} from "./extraction";

function quoted<T>(value: T, quote: string, section: string): Sourced<T> {
  return { value, evidence: "quoted", quote, section };
}

function unclear<T>(value: T, quote: string, section: string): Sourced<T> {
  return { value, evidence: "unclear", quote, section };
}

function absent<T>(): Sourced<T> {
  return { value: null, evidence: "absent", quote: null, section: null };
}

/** The canned answer.
 *
 * Chosen to show all three evidence states on one screen, because a demo
 * where everything comes back clean is a demo that hides the case the design
 * exists for. Tuition is `unclear` (the page lists a band), and the city and
 * the September deadline are `absent` — that page simply does not say.
 */
function cannedExtraction(url: string): Extraction {
  let source = url;
  try {
    source = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    /* A url the browser cannot parse still gets read; the label just falls
       back to whatever was typed rather than throwing on a cosmetic line. */
  }

  const fields: Extraction["fields"] = {
    name: quoted(
      "MSc Data Science",
      "MSc Data Science (Full-time, 12 months)",
      "Course overview",
    ),
    institution: quoted(
      "Camden Metropolitan University",
      "School of Computer Science, Camden Metropolitan University",
      "Course overview",
    ),
    country: quoted("GB", "Camden Metropolitan University, Manchester, UK", "Contact"),
    // The page names a campus, not a city, and they are not always the same
    // place. Left empty rather than guessed.
    city: absent(),
    level: quoted(
      "masters",
      "Award: MSc — Master of Science",
      "Course overview",
    ),
    field: quoted(
      "Computer Science",
      "Subject area: Computing and Data Science",
      "Course overview",
    ),
    duration_months: quoted(
      "12",
      "Duration: 12 months full-time",
      "Course overview",
    ),
    // A band, not a figure. The reader does not get to pick one.
    tuition_per_year: unclear(
      "28500",
      "International tuition for 2026/27 entry: £28,500–£31,000 depending on pathway",
      "Fees and funding",
    ),
    currency: quoted("GBP", "£28,500–£31,000", "Fees and funding"),
  };

  const intakes: ProposedIntake[] = [
    {
      intake: "2027-09",
      application_deadline: "2027-07-31",
      evidence: "quoted",
      quote:
        "Next start date: September 2027. Applications close 31 July 2027.",
    },
    {
      // The page says "a January entry is available" with no year beside it,
      // and no deadline anywhere near the sentence.
      intake: "2027-01",
      application_deadline: null,
      evidence: "unclear",
      quote: "A January entry is available for this programme.",
    },
  ];

  const requirements: ProposedRequirement[] = [
    {
      fact_key: "qualification",
      rule: "bachelor_years>=3",
      description:
        "An honours degree in a quantitative subject, or an equivalent overseas qualification.",
      evidence: "quoted",
      quote:
        "Applicants should hold a UK honours degree in a numerate discipline.",
      section: "Entry requirements",
    },
    {
      fact_key: "grades",
      rule: "percentage>=60",
      description: "A UK 2:1, or 60% and above on an international transcript.",
      evidence: "quoted",
      quote: "We normally require a 2:1 (or international equivalent).",
      section: "Entry requirements",
    },
    {
      fact_key: "english_test",
      rule: "ielts>=6.5",
      description: "IELTS 6.5 overall, or an accepted equivalent.",
      evidence: "quoted",
      quote:
        "IELTS 6.5 overall with no component below 6.0, or equivalent.",
      section: "English language requirements",
    },
    {
      fact_key: "english_test",
      rule: "ielts_band>=6.0",
      description:
        "No individual band below 6.0. INDETERMINATE when band scores are not supplied.",
      evidence: "quoted",
      quote:
        "IELTS 6.5 overall with no component below 6.0, or equivalent.",
      section: "English language requirements",
    },
  ];

  return { url, source, fields, intakes, requirements };
}

export interface ReadHandle {
  /** Resolves with everything the page yielded, or rejects if stopped. */
  done: Promise<Extraction>;
  /** Abandon the read. The promise rejects with `ReadStopped`. */
  stop: () => void;
}

export class ReadStopped extends Error {
  constructor() {
    super("Stopped reading the page");
    this.name = "ReadStopped";
  }
}

/** Walk the stages, then hand back what was found.
 *
 * `onStage` fires as each leg completes, so the readout shows real progress
 * in real order rather than an indeterminate bar. The real endpoint sends
 * the same events; only the transport changes.
 */
export function readPage(
  url: string,
  onStage: (stageId: string) => void,
): ReadHandle {
  let stopped = false;
  const timers: number[] = [];
  // Hoisted so `stop` can settle the promise. A stopped read that left it
  // pending would leave any awaiting caller hanging for the rest of the
  // session, which is the failure mode an abort button exists to prevent.
  let abandon: (reason: Error) => void = () => {};

  const done = new Promise<Extraction>((resolve, reject) => {
    abandon = reject;
    let elapsed = 0;
    for (const stage of READ_STAGES) {
      elapsed += stage.ms;
      timers.push(
        window.setTimeout(() => {
          if (!stopped) onStage(stage.id);
        }, elapsed),
      );
    }
    timers.push(
      window.setTimeout(() => {
        if (!stopped) resolve(cannedExtraction(url));
      }, elapsed + 200),
    );
  });

  return {
    done,
    stop: () => {
      if (stopped) return;
      stopped = true;
      for (const t of timers) window.clearTimeout(t);
      abandon(new ReadStopped());
    },
  };
}
