/** Create or edit one programme.
 *
 * Backed by `GET /api/programmes/{id}` and the write endpoints beside it, not
 * by the session store. It used to read `catalogueStore`, which is keyed on
 * the fixture's `p_uk_001` while the table lists database uuids — so opening
 * an existing row found nothing and drew a blank form over a programme that
 * exists, and saving it created a second one in memory that no reload kept.
 *
 * The footer is the important part: it never just says "invalid". It names
 * exactly what is still missing, and it says out loud what saving with no
 * entry requirements would mean — a programme that matches every student.
 * A catalogue row is what the agent is permitted to assert about someone's
 * future, so the editor argues with you before it lets you publish a vague
 * one.
 *
 * A new programme can be filled in two ways, and they share this one form.
 * Either somebody types it, or the course page is read and the boxes arrive
 * already holding what it said — each with the sentence it came from and a
 * mark saying nobody has checked it yet. There is no second editor for the
 * read road, because the thing being reviewed IS the programme, and a review
 * screen that is not the form is a screen that drifts out of step with it.
 *
 * Unconfirmed values do not block SAVING. They block VERIFYING. A draft is
 * allowed to be half-finished — that is what a draft is — but the stamp that
 * puts a programme in front of students means a person read it, and a
 * crawler's reading is not a person's.
 */
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { Select, type SelectOption } from "@/components/ui/Select";
import { FailureCard, LoadingNote } from "@/components/ui/States";
import {
  AlertIcon,
  ChevronLeftIcon,
  CloseIcon,
  PlusIcon,
} from "@/components/ui/icons";
import { RuleGrid } from "./CatalogueRoute";
import { COUNTRIES } from "@/data/countries";
import { levelLabel } from "@/features/catalogue/display";
import { ProgrammeStart } from "@/features/catalogue/components/ProgrammeStart";
import { SourcedField } from "@/features/catalogue/components/SourcedField";
import type {
  ExtractedKey,
  Extraction,
  ProposedIntake,
  ProposedRequirement,
} from "@/features/catalogue/extraction";
import {
  useProgrammeDetail,
  useSaveProgramme,
  useVerifyProgramme,
} from "@/features/catalogue/queries";
import type {
  IntakeRow,
  ProgrammeDetail,
  ProgrammeWrite,
  RequirementRow,
} from "@/features/catalogue/types";
import {
  formatDate,
  formatIntake,
  minorUnitsToInput,
  verifiedLabel,
} from "@/lib/format";
import type { FactKey } from "@/data/types";

const INTAKE_OPTIONS = ["2027-01", "2027-02", "2027-09", "2027-10"];
const LEVELS = ["masters", "bachelors", "phd", "foundation"];

/** Currencies the seed catalogue uses, plus the majors an agency is likely to
 *  add. A free-text box here was how you got "Aud" beside a figure the agent
 *  then quotes to a student. */
const CURRENCIES = ["GBP", "EUR", "USD", "AUD", "CAD", "NZD", "LKR", "INR"];

/** How a field is named in a sentence.
 *
 * The same words the footer uses for what is still missing, so "the page did
 * not give a tuition fee" and "still needs a tuition fee" are recognisably
 * about the same box.
 */
const FIELD_LABELS: Record<ExtractedKey, string> = {
  name: "a programme name",
  institution: "an institution",
  country: "a country",
  city: "a city",
  level: "an award level",
  field: "a field of study",
  tuition_per_year: "a tuition fee",
  currency: "a currency",
  duration_months: "a duration",
};

/** "a, b and c" — an Oxford-comma-free list for prose. */
function sentenceList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** Requirement templates. `key` must be one of the fact keys the evaluator
 *  has a branch for — `services/rules.py::EVALUATED_KEYS` refuses the rest,
 *  because a rule keyed on anything else can never be evaluated and would
 *  come back INDETERMINATE on every shortlist it touches. */
const TEMPLATES: {
  label: string;
  key: FactKey;
  rule: string;
  description: string;
}[] = [
  {
    label: "Degree length",
    key: "qualification",
    rule: "bachelor_years>=4",
    description: "A four-year bachelor's degree in a relevant subject.",
  },
  {
    label: "Grades",
    key: "grades",
    rule: "percentage>=65",
    description: "A UK 2:1 or international equivalent (65% and above).",
  },
  {
    label: "English overall",
    key: "english_test",
    rule: "ielts>=6.5",
    description: "IELTS 6.5 overall, or an accepted equivalent.",
  },
  {
    label: "English band minimum",
    key: "english_test",
    rule: "ielts_band>=6.0",
    description:
      "No individual band below 6.0. INDETERMINATE when band scores are not supplied.",
  },
  {
    label: "Budget",
    key: "budget_per_year",
    rule: "budget>=tuition",
    description: "Stated tuition budget covers the annual fee.",
  },
];

/** The form's own state.
 *
 * Every field is a string because every field is an input, and a half-typed
 * "24" is not the number 24 — parsing on each keystroke is how a box refuses
 * to let you clear it. Conversion happens once, on save.
 */
interface Draft {
  name: string;
  institution: string;
  /** ISO 3166-1 alpha-2 — what the server stores and the only thing PATCH
   *  accepts. The picker's values are codes for that reason. */
  country: string;
  city: string;
  level: string;
  field: string;
  tuition_per_year: string;
  currency: string;
  duration_months: string;
  intakes: IntakeRow[];
  requirements: RequirementRow[];
}

function draftFrom(existing: ProgrammeDetail | undefined): Draft {
  if (!existing) {
    return {
      name: "",
      institution: "",
      country: "",
      city: "",
      level: "masters",
      field: "",
      tuition_per_year: "",
      currency: "GBP",
      duration_months: "12",
      intakes: [],
      requirements: [],
    };
  }
  return {
    name: existing.name,
    institution: existing.institution ?? "",
    country: existing.country ?? "",
    city: existing.city ?? "",
    level: existing.level ?? "",
    field: existing.field ?? "",
    // The stored figure is minor units; the box holds what a person types.
    tuition_per_year:
      existing.tuition_per_year_minor === null || !existing.currency
        ? ""
        : minorUnitsToInput(
            existing.tuition_per_year_minor,
            existing.currency,
          ),
    currency: existing.currency ?? "GBP",
    duration_months:
      existing.duration_months === null ? "" : String(existing.duration_months),
    intakes: existing.intakes.map((i) => ({ ...i })),
    requirements: existing.requirements.map((r) => ({ ...r })),
  };
}

/** The same draft, seeded from a page that was read.
 *
 * Intakes and requirements are NOT seeded. They arrive as proposals and are
 * taken one at a time — a rule that joined the set on its own would be an
 * entry condition no human wrote, and it would quietly exclude students from
 * every shortlist it touched.
 */
function draftFromExtraction(extraction: Extraction): Draft {
  const f = extraction.fields;
  return {
    name: f.name.value ?? "",
    institution: f.institution.value ?? "",
    country: f.country.value ?? "",
    city: f.city.value ?? "",
    level: f.level.value ?? "",
    field: f.field.value ?? "",
    tuition_per_year: f.tuition_per_year.value ?? "",
    currency: f.currency.value ?? "GBP",
    duration_months: f.duration_months.value ?? "",
    intakes: [],
    requirements: [],
  };
}

export function ProgrammeEditorRoute() {
  const { programmeId } = useParams();
  const navigate = useNavigate();
  const detail = useProgrammeDetail(programmeId);

  /* Undefined until a road is chosen. `{}` is the manual road and
     `{ extraction }` is the read one — a plain boolean plus a separate
     nullable result would let "started, nothing read" and "not started" look
     identical for one render. */
  const [started, setStarted] = useState<{ extraction?: Extraction }>();

  if (programmeId && detail.isPending) {
    return (
      <EditorShell onBack={() => navigate("/catalogue")} title="Programme">
        <LoadingNote>Reading the programme…</LoadingNote>
      </EditorShell>
    );
  }

  if (programmeId && detail.isError) {
    return (
      <EditorShell onBack={() => navigate("/catalogue")} title="Programme">
        <FailureCard
          title="This programme could not be opened"
          error={detail.error}
          onRetry={() => detail.refetch()}
        />
      </EditorShell>
    );
  }

  /* A new programme starts at the fork; an existing one never does — there is
     nothing to read a page for when the row already exists. */
  if (!programmeId && !started) {
    return (
      <EditorShell onBack={() => navigate("/catalogue")} title="Add programme">
        <h2 className="console-page-title">Add a programme</h2>
        <p className="console-page-sub">
          Saved as a draft either way. Nothing here is visible to the agent
          until somebody verifies it.
        </p>
        <div className="mt-5">
          <ProgrammeStart
            onRead={(result) => setStarted({ extraction: result })}
            onManual={() => setStarted({})}
          />
        </div>
      </EditorShell>
    );
  }

  /* `key` remounts the form when a different programme is opened, so the
     draft is seeded from the row that was actually fetched. An effect syncing
     state to props would edit the previous programme for one render. */
  return (
    <ProgrammeForm
      key={detail.data?.id ?? "new"}
      existing={programmeId ? detail.data : undefined}
      extraction={started?.extraction}
    />
  );
}

/** Breadcrumb and page frame, shared by the loading, failure and form states
 *  so a slow fetch does not collapse the layout. */
function EditorShell({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="console console-sheet-page">
      <div className="mx-auto max-w-[1040px]">
        <nav className="console-crumbs" aria-label="Breadcrumb">
          <button type="button" className="console-crumb-link" onClick={onBack}>
            <ChevronLeftIcon size={14} />
            Catalogue
          </button>
          <span className="console-crumbs-sep" aria-hidden="true">
            ›
          </span>
          <span style={{ color: "var(--c-ink)" }}>{title}</span>
        </nav>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

/** The fields each card is responsible for, for the scoped confirm below. */
const IDENTITY_KEYS: ExtractedKey[] = [
  "name",
  "institution",
  "country",
  "city",
  "level",
  "field",
  "duration_months",
];
const COST_KEYS: ExtractedKey[] = ["tuition_per_year", "currency"];

/** Confirm a card's worth of read values at once.
 *
 * Deliberately NOT one button for the whole form. Somebody reads a card at a
 * time, so a card is the honest unit to agree to; a single "confirm
 * everything" turns the whole review into one reflex click, which is the same
 * as not reviewing.
 *
 * It also refuses to cover the ambiguous ones. A value the page did not
 * settle — a fee quoted as a band, a month with no year — is exactly what
 * this screen exists to put in front of a person, and sweeping it up with the
 * clean reads would hide the one row that needed looking at. Those keep their
 * own button and their own sentence.
 */
function CardConfirm({
  extraction,
  outstanding,
  keys,
  onConfirm,
}: {
  extraction?: Extraction;
  outstanding: ExtractedKey[];
  keys: ExtractedKey[];
  onConfirm: (keys: ExtractedKey[]) => void;
}) {
  if (!extraction) return null;
  const clean = keys.filter(
    (key) =>
      outstanding.includes(key) && extraction.fields[key].evidence === "quoted",
  );
  const unclear = keys.filter(
    (key) =>
      outstanding.includes(key) && extraction.fields[key].evidence === "unclear",
  );
  if (!clean.length) return null;

  return (
    <button
      type="button"
      className="console-confirm ml-auto"
      onClick={() => onConfirm(clean)}
      title={
        unclear.length
          ? `Leaves ${sentenceList(unclear.map((k) => FIELD_LABELS[k]))} for you to check`
          : undefined
      }
    >
      Confirm {clean.length} quoted {clean.length === 1 ? "value" : "values"}
      {unclear.length ? ` (${unclear.length} left to check)` : ""}
    </button>
  );
}

function ProgrammeForm({
  existing,
  extraction,
}: {
  existing?: ProgrammeDetail;
  /** Set only when this programme was started by reading a course page. */
  extraction?: Extraction;
}) {
  const navigate = useNavigate();
  const isNew = !existing;
  const save = useSaveProgramme();
  const verify = useVerifyProgramme();

  const initial = useMemo(
    () => (extraction ? draftFromExtraction(extraction) : draftFrom(existing)),
    [existing, extraction],
  );
  const [draft, setDraft] = useState<Draft>(initial);
  const [sourceUrl, setSourceUrl] = useState(extraction?.url ?? "");

  /** Which read values a person has agreed to.
   *
   * A set of keys rather than a flag on each field, because the fields
   * themselves are the same objects the manual road edits and there is
   * nowhere on a string to hang "somebody checked this".
   */
  const [confirmed, setConfirmed] = useState<ReadonlySet<ExtractedKey>>(
    new Set(),
  );

  /* Structured claims wait their turn, individually. Accepting moves one into
     the draft; dismissing drops it. Neither is reversible from here, which is
     fine — both roads end in a form you can still edit. */
  const [proposedIntakes, setProposedIntakes] = useState<ProposedIntake[]>(
    extraction?.intakes ?? [],
  );
  const [proposedRules, setProposedRules] = useState<ProposedRequirement[]>(
    extraction?.requirements ?? [],
  );

  const moved = (field: keyof Draft) => draft[field] !== initial[field];

  /** Every key the page actually filled in, so the banner can count what is
   *  left and the footer can name it. A field the page did not mention is not
   *  outstanding — it is simply empty, like any other empty box. */
  const outstanding = useMemo(() => {
    if (!extraction) return [] as ExtractedKey[];
    return (Object.keys(extraction.fields) as ExtractedKey[]).filter(
      (key) =>
        extraction.fields[key].evidence !== "absent" && !confirmed.has(key),
    );
  }, [extraction, confirmed]);

  const notOnPage = useMemo(() => {
    if (!extraction) return [] as ExtractedKey[];
    return (Object.keys(extraction.fields) as ExtractedKey[]).filter(
      (key) => extraction.fields[key].evidence === "absent",
    );
  }, [extraction]);

  function toggleConfirmed(key: ExtractedKey) {
    setConfirmed((held) => {
      const next = new Set(held);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** Editing a read value is confirming it.
   *
   * Somebody who has typed over what the page said has plainly looked at it,
   * and making them then click "Looks right" on their own words is the kind
   * of ceremony that teaches people to click everything without reading.
   */
  const patch = (changes: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...changes }));
    if (!extraction) return;
    const touched = (Object.keys(changes) as (keyof Draft)[]).filter(
      (k): k is ExtractedKey => k in extraction.fields,
    );
    if (touched.length) {
      setConfirmed((held) => new Set([...held, ...touched]));
    }
  };

  /** The `Sourced` entry for a field, or undefined on the manual road. */
  const sourceOf = (key: ExtractedKey) => extraction?.fields[key];

  /** What is still missing before this row could be VERIFIED.
   *
   * The same list the server checks in `_REQUIRED_TO_PUBLISH`, in the order
   * the form shows them. Saving is not blocked on it — a draft is allowed to
   * be incomplete, that is what a draft is — but nothing goes in front of a
   * student until every one of these is answered.
   */
  const missing = useMemo(() => {
    const gaps: string[] = [];
    if (!draft.institution.trim()) gaps.push("an institution");
    if (!draft.level.trim()) gaps.push("an award level");
    if (!draft.field.trim()) gaps.push("a field of study");
    if (!draft.country.trim()) gaps.push("a country");
    if (!draft.tuition_per_year.trim()) gaps.push("a tuition fee");
    if (!draft.duration_months.trim()) gaps.push("a duration");
    if (!draft.intakes.length) gaps.push("at least one intake");
    return gaps;
  }, [draft]);

  const named = draft.name.trim().length > 0;
  const complete = missing.length === 0;
  const busy = save.isPending || verify.isPending;

  const summary = !named
    ? "Still needs a programme name."
    : outstanding.length
      ? `Saves as a draft — ${outstanding.length} value${
          outstanding.length === 1 ? "" : "s"
        } read off the page ${
          outstanding.length === 1 ? "is" : "are"
        } still unconfirmed, and nothing unconfirmed can be verified.`
      : !complete
        ? `Saves as a draft — still needs ${missing.join(", ")} before it can be verified.`
        : draft.requirements.length === 0
          ? "Saving with no entry requirements — this programme will match every student who reaches the catalogue."
          : `${draft.requirements.length} requirement${
              draft.requirements.length === 1 ? "" : "s"
            } · ${draft.intakes.length} intake${
              draft.intakes.length === 1 ? "" : "s"
            }`;

  /** Countries, with whatever this programme already says kept as an option.
   *
   * The value is the ISO code, not the name: `PATCH /api/programmes` runs
   * `geo.normalise_country` and refuses anything that is not already a code.
   * Sending "United Kingdom" would be a 422 on save with a form that looked
   * filled in. A stored code the list does not carry stays selectable rather
   * than silently blanking — an edit to the fee must not also move the
   * country nobody touched.
   */
  const countryOptions: SelectOption[] = [
    ...(draft.country && !COUNTRIES.some((c) => c.code === draft.country)
      ? [{ value: draft.country, label: draft.country, detail: "as stored" }]
      : []),
    ...COUNTRIES.map((c) => ({
      value: c.code,
      label: c.name,
      prefix: c.flag,
      keywords: c.code,
    })),
  ];

  /** The chips to offer: the standard months plus any this programme already
   *  holds, so an intake outside the list is not quietly dropped by a save
   *  that PUTs the whole set. */
  const intakeChoices = useMemo(() => {
    const stored = draft.intakes.map((i) => i.intake);
    return [...new Set([...INTAKE_OPTIONS, ...stored])].sort();
  }, [draft.intakes]);

  function toggleIntake(month: string) {
    const held = draft.intakes.some((i) => i.intake === month);
    patch({
      intakes: held
        ? draft.intakes.filter((i) => i.intake !== month)
        : [
            ...draft.intakes,
            { intake: month, application_deadline: null, is_open: true },
          ].sort((a, b) => a.intake.localeCompare(b.intake)),
    });
  }

  function patchIntake(month: string, changes: Partial<IntakeRow>) {
    patch({
      intakes: draft.intakes.map((i) =>
        i.intake === month ? { ...i, ...changes } : i,
      ),
    });
  }

  /** Take one proposed intake into the draft, and stop offering it. */
  function acceptIntake(proposal: ProposedIntake) {
    setProposedIntakes((held) =>
      held.filter((i) => i.intake !== proposal.intake),
    );
    if (draft.intakes.some((i) => i.intake === proposal.intake)) return;
    patch({
      intakes: [
        ...draft.intakes,
        {
          intake: proposal.intake,
          application_deadline: proposal.application_deadline,
          // Open unless the page said otherwise, which is the same default the
          // manual chips use. A closed intake is a claim of its own and the
          // reader is not allowed to make it.
          is_open: true,
        },
      ].sort((a, b) => a.intake.localeCompare(b.intake)),
    });
  }

  /** Take one proposed requirement. Appended, not inserted by key — order is
   *  content here, and the order the page listed them in is the order a
   *  student reads them. */
  function acceptRule(index: number) {
    const proposal = proposedRules[index];
    if (!proposal) return;
    setProposedRules((held) => held.filter((_, i) => i !== index));
    patch({
      requirements: [
        ...draft.requirements,
        {
          fact_key: proposal.fact_key,
          rule: proposal.rule,
          description: proposal.description,
          mandatory: true,
        },
      ],
    });
  }

  function addTemplate(template: (typeof TEMPLATES)[number]) {
    patch({
      requirements: [
        ...draft.requirements,
        {
          fact_key: template.key,
          rule: template.rule,
          description: template.description,
          mandatory: true,
        },
      ],
    });
  }

  /** What to send: everything on a create, only what moved on an edit.
   *
   * PATCH is "only the fields the client sent" for a reason — two counsellors
   * with the same programme open must not overwrite each other's untouched
   * columns. A form that posts all nine fields every time turns every save
   * into a full overwrite and throws that away.
   *
   * Empty is sent as null, not "". The server nulls the column for either,
   * but null is the one that says "nobody has filled this in" rather than
   * "somebody typed nothing".
   */
  function payload(): ProgrammeWrite {
    const body: ProgrammeWrite = {};
    const fresh = !existing;

    if (fresh || moved("name")) body.name = draft.name.trim();
    if (fresh || moved("institution"))
      body.institution = draft.institution.trim() || null;
    if (fresh || moved("country")) body.country = draft.country || null;
    if (fresh || moved("city")) body.city = draft.city.trim() || null;
    if (fresh || moved("level")) body.level = draft.level || null;
    if (fresh || moved("field")) body.field = draft.field.trim() || null;
    if (fresh || moved("duration_months"))
      body.duration_months = draft.duration_months.trim()
        ? Number(draft.duration_months)
        : null;

    // The pair moves together, in both directions. "24500" with no currency
    // is not a cheaper programme, it is an unanswerable question — and the
    // same figure under a different currency is a different fee.
    if (fresh || moved("tuition_per_year") || moved("currency")) {
      body.tuition_per_year = draft.tuition_per_year.trim() || null;
      body.currency = draft.currency || null;
    }

    return body;
  }

  function submit() {
    if (!named || busy) return;
    save.mutate(
      {
        id: existing?.id,
        fields: payload(),
        intakes: draft.intakes,
        requirements: draft.requirements,
      },
      { onSuccess: () => navigate("/catalogue") },
    );
  }

  /* Named the moment there is a name, on both roads. "Add a programme" over
     a form already holding "MSc Data Science" reads as though the read did
     not take. */
  const title = draft.name.trim() || (isNew ? "Add a programme" : "Untitled programme");
  const status = existing?.status ?? "draft";

  return (
    <div className="console console-sheet-page">
      <div className="mx-auto max-w-[1040px]">
        <nav className="console-crumbs" aria-label="Breadcrumb">
          <button
            type="button"
            className="console-crumb-link"
            onClick={() => navigate("/catalogue")}
          >
            <ChevronLeftIcon size={14} />
            Catalogue
          </button>
          <span className="console-crumbs-sep" aria-hidden="true">
            ›
          </span>
          <span style={{ color: "var(--c-ink)" }}>
            {draft.name.trim() || (isNew ? "Add programme" : "Untitled programme")}
          </span>
        </nav>

        <div className="flex items-start gap-4">
          <div className="min-w-0">
            <h2 className="console-page-title">{title}</h2>
            <p className="console-page-sub">
              {isNew
                ? "Saved as a draft. Nothing here is visible to the agent until somebody verifies it."
                : `${draft.institution || "No institution"} · editing leaves the verification date alone, and says the figures moved since it.`}
            </p>
          </div>
          <span
            className="console-pill ml-auto flex-none"
            data-status={status === "published" ? "active" : "invited"}
          >
            {status === "published"
              ? `Verified ${verifiedLabel(existing?.verified_at ?? "")}`
              : status === "archived"
                ? "Archived"
                : "Draft · not yet visible"}
          </span>
        </div>

        {/* What the read produced, counted down as it is checked off. Named
            here rather than only per-field so the scale of the job is clear
            before scrolling into it, and so the two things that need saying
            once — where it came from, what the page did not cover — are said
            once. */}
        {extraction ? (
          <div className="console-review mt-4">
            <div className="console-review-body">
              <div className="console-review-title">
                {outstanding.length
                  ? `${outstanding.length} value${
                      outstanding.length === 1 ? "" : "s"
                    } to check`
                  : "Everything read off the page is confirmed"}
              </div>
              <p className="console-review-sub">
                Read from{" "}
                <span className="console-review-src">{extraction.source}</span>.
                Each value shows the line it came from — confirm it, or type
                over it.
                {notOnPage.length
                  ? ` That page did not give ${sentenceList(
                      notOnPage.map((key) => FIELD_LABELS[key]),
                    )}.`
                  : ""}
              </p>
            </div>
          </div>
        ) : null}

        {/* Not an inline field error each: the server answers with the one
            thing it refused, and burying that under a box is how a save
            appears to do nothing. */}
        {save.isError ? (
          <div className="mt-4">
            <FailureCard title="This was not saved" error={save.error} />
          </div>
        ) : null}
        {verify.isError ? (
          <div className="mt-4">
            <FailureCard title="This was not verified" error={verify.error} />
          </div>
        ) : null}
        {existing?.edited_since_verified ? (
          <p className="console-week-note mt-4">
            A figure here changed after the last verification. The programme is
            still live — verify it again to put a date on what it now says.
          </p>
        ) : null}

        <div className="mt-5 flex flex-col gap-4">
          <section className="console-card">
            <div className="console-card-head">
              <h3 className="console-section-title">Identity</h3>
              <CardConfirm
                extraction={extraction}
                outstanding={outstanding}
                keys={IDENTITY_KEYS}
                onConfirm={(keys) =>
                  setConfirmed((held) => new Set([...held, ...keys]))
                }
              />
            </div>
            <div className="console-card-body">
              <div className="console-form-grid" data-cols="2">
                <SourcedField
                  source={sourceOf("name")}
                  confirmed={confirmed.has("name")}
                  onToggle={() => toggleConfirmed("name")}
                >
                  <div>
                    <label className="console-label" htmlFor="pg-name">
                      Programme name
                    </label>
                    <input
                      id="pg-name"
                      className="console-input"
                      value={draft.name}
                      onChange={(e) => patch({ name: e.target.value })}
                    />
                  </div>
                </SourcedField>
                <SourcedField
                  source={sourceOf("institution")}
                  confirmed={confirmed.has("institution")}
                  onToggle={() => toggleConfirmed("institution")}
                >
                  <div>
                    <label className="console-label" htmlFor="pg-inst">
                      Institution
                    </label>
                    <input
                      id="pg-inst"
                      className="console-input"
                      value={draft.institution}
                      onChange={(e) => patch({ institution: e.target.value })}
                    />
                    <p className="console-hint">
                      Matched to an existing university by name, or added as a
                      new one.
                    </p>
                  </div>
                </SourcedField>
              </div>

              <div className="console-form-grid mt-4" data-cols="3">
                <SourcedField
                  source={sourceOf("country")}
                  confirmed={confirmed.has("country")}
                  onToggle={() => toggleConfirmed("country")}
                >
                  <div>
                    <label className="console-label" htmlFor="pg-country">
                      Country
                    </label>
                    {/* A list, not a text box. The country code is matched
                        against counsellors' owned countries to decide routing
                        and against the catalogue coverage banner — a typed
                        "Aus" is a destination nobody owns, forever. A code
                        read off a page goes through the same list, so a page
                        saying "UK" cannot put an unroutable string in here. */}
                    <Select
                      value={draft.country}
                      options={countryOptions}
                      placeholder="Choose a country…"
                      ariaLabel="Country"
                      onChange={(country) => patch({ country })}
                    />
                  </div>
                </SourcedField>
                <SourcedField
                  source={sourceOf("city")}
                  confirmed={confirmed.has("city")}
                  onToggle={() => toggleConfirmed("city")}
                >
                  <div>
                    <label className="console-label" htmlFor="pg-city">
                      City
                    </label>
                    <input
                      id="pg-city"
                      className="console-input"
                      value={draft.city}
                      onChange={(e) => patch({ city: e.target.value })}
                    />
                  </div>
                </SourcedField>
                <SourcedField
                  source={sourceOf("duration_months")}
                  confirmed={confirmed.has("duration_months")}
                  onToggle={() => toggleConfirmed("duration_months")}
                >
                  <div>
                    <label className="console-label" htmlFor="pg-duration">
                      Duration (months)
                    </label>
                    <input
                      id="pg-duration"
                      className="console-input"
                      type="number"
                      value={draft.duration_months}
                      onChange={(e) =>
                        patch({ duration_months: e.target.value })
                      }
                    />
                  </div>
                </SourcedField>
              </div>

              <SourcedField
                source={sourceOf("level")}
                confirmed={confirmed.has("level")}
                onToggle={() => toggleConfirmed("level")}
              >
                <div className="mt-4">
                  <div className="console-label">Award level</div>
                  <div
                    className="console-chips"
                    role="radiogroup"
                    aria-label="Award level"
                  >
                    {LEVELS.map((level) => (
                      <button
                        key={level}
                        type="button"
                        role="radio"
                        className="console-chip"
                        aria-checked={draft.level === level}
                        onClick={() => patch({ level })}
                      >
                        {levelLabel(level)}
                      </button>
                    ))}
                  </div>
                </div>
              </SourcedField>

              <SourcedField
                source={sourceOf("field")}
                confirmed={confirmed.has("field")}
                onToggle={() => toggleConfirmed("field")}
              >
                <div className="mt-4">
                  <label className="console-label" htmlFor="pg-field">
                    Field
                  </label>
                  <input
                    id="pg-field"
                    className="console-input"
                    value={draft.field}
                    onChange={(e) => patch({ field: e.target.value })}
                  />
                  <p className="console-hint">
                    Field feeds career-goal mapping. It affects ranking only — it
                    never excludes a programme from a shortlist.
                  </p>
                </div>
              </SourcedField>
            </div>
          </section>

          <section className="console-card">
            <div className="console-card-head">
              <h3 className="console-section-title">Intakes and cost</h3>
              <CardConfirm
                extraction={extraction}
                outstanding={outstanding}
                keys={COST_KEYS}
                onConfirm={(keys) =>
                  setConfirmed((held) => new Set([...held, ...keys]))
                }
              />
            </div>
            <div className="console-card-body">
              {/* An intake carries a date the agent will quote to a student,
                  so it is agreed to one at a time rather than seeded into the
                  set. A month the page mentioned in passing is not a month
                  the agency is taking applications for. */}
              {proposedIntakes.length ? (
                <div className="console-proposals">
                  <div className="console-proposals-head">
                    <span>
                      {proposedIntakes.length} intake
                      {proposedIntakes.length === 1 ? "" : "s"} on that page
                    </span>
                  </div>
                  {proposedIntakes.map((proposal) => (
                    <div key={proposal.intake} className="console-proposal">
                      <div className="console-proposal-body">
                        <div className="console-proposal-head">
                          <span className="console-rule-key">
                            {formatIntake(proposal.intake)}
                          </span>
                          <span className="console-rule-note">
                            {proposal.application_deadline
                              ? `Closes ${formatDate(proposal.application_deadline)}`
                              : "No deadline on the page"}
                          </span>
                          {proposal.evidence === "unclear" ? (
                            <span className="console-unclear">
                              <AlertIcon size={13} />
                              No year beside it — this is a guess
                            </span>
                          ) : null}
                        </div>
                        <p className="console-quote">
                          <span className="console-quote-words">
                            {proposal.quote}
                          </span>
                        </p>
                      </div>
                      <div className="console-proposal-actions">
                        <button
                          type="button"
                          className="console-proposal-add"
                          onClick={() => acceptIntake(proposal)}
                        >
                          <PlusIcon size={12} />
                          Add
                        </button>
                        <button
                          type="button"
                          className="console-icon-btn"
                          data-variant="ghost"
                          aria-label={`Dismiss the ${formatIntake(proposal.intake)} intake`}
                          onClick={() =>
                            setProposedIntakes((held) =>
                              held.filter((i) => i.intake !== proposal.intake),
                            )
                          }
                        >
                          <CloseIcon size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="console-label">Intakes</div>
              <div className="console-chips" role="group" aria-label="Intakes">
                {intakeChoices.map((intake) => (
                  <button
                    key={intake}
                    type="button"
                    role="checkbox"
                    className="console-chip"
                    aria-checked={draft.intakes.some(
                      (i) => i.intake === intake,
                    )}
                    onClick={() => toggleIntake(intake)}
                  >
                    {formatIntake(intake)}
                  </button>
                ))}
              </div>

              {/* A deadline per intake, not one for the programme. January
                  and September close months apart, and a single shared date
                  is how the agent quotes the wrong one to half the students. */}
              {draft.intakes.length ? (
                <div className="mt-4 flex flex-col gap-2">
                  {draft.intakes.map((intake) => (
                    <div
                      key={intake.intake}
                      className="console-form-grid"
                      data-cols="3"
                    >
                      <div className="console-label m-0 self-center">
                        {formatIntake(intake.intake)}
                      </div>
                      <div>
                        <label
                          className="console-label"
                          htmlFor={`pg-deadline-${intake.intake}`}
                        >
                          Application deadline
                        </label>
                        <input
                          id={`pg-deadline-${intake.intake}`}
                          className="console-input"
                          type="date"
                          value={intake.application_deadline ?? ""}
                          onChange={(e) =>
                            patchIntake(intake.intake, {
                              application_deadline: e.target.value || null,
                            })
                          }
                        />
                      </div>
                      <label className="console-label flex items-center gap-2 self-center">
                        <input
                          type="checkbox"
                          checked={intake.is_open}
                          onChange={(e) =>
                            patchIntake(intake.intake, {
                              is_open: e.target.checked,
                            })
                          }
                        />
                        Open for applications
                      </label>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="console-form-grid mt-4" data-cols="3">
                <SourcedField
                  source={sourceOf("tuition_per_year")}
                  confirmed={confirmed.has("tuition_per_year")}
                  onToggle={() => toggleConfirmed("tuition_per_year")}
                >
                  <div>
                    <label className="console-label" htmlFor="pg-fee">
                      Tuition · international, per year
                    </label>
                    {/* Text, not number: the figure travels to the server as
                        the person typed it, and `services/money.py` converts
                        it with this currency's own precision. */}
                    <input
                      id="pg-fee"
                      className="console-input"
                      inputMode="decimal"
                      value={draft.tuition_per_year}
                      onChange={(e) =>
                        patch({ tuition_per_year: e.target.value })
                      }
                    />
                  </div>
                </SourcedField>
                <SourcedField
                  source={sourceOf("currency")}
                  confirmed={confirmed.has("currency")}
                  onToggle={() => toggleConfirmed("currency")}
                >
                  <div>
                    <label className="console-label" htmlFor="pg-currency">
                      Currency
                    </label>
                    <Select
                      value={draft.currency}
                      searchable={false}
                      ariaLabel="Currency"
                      options={CURRENCIES.map((c) => ({ value: c, label: c }))}
                      onChange={(currency) => patch({ currency })}
                    />
                    <p className="console-hint">
                      Stored beside the amount — nothing here assumes a symbol.
                    </p>
                  </div>
                </SourcedField>
              </div>
            </div>
          </section>

          <section className="console-card">
            <div className="console-card-head">
              <h3 className="console-section-title">Entry requirements</h3>
              <span className="console-meta">
                {draft.requirements.length}{" "}
                {draft.requirements.length === 1
                  ? "requirement"
                  : "requirements"}
              </span>
            </div>
            <div className="console-card-body">
              <p className="console-meta m-0 mb-4 max-w-[76ch]">
                Requirements are data, not prose. Each row evaluates to MET,
                NOT_MET or INDETERMINATE against a student&apos;s stated facts,
                and a row keyed on a fact they have never stated comes back
                INDETERMINATE rather than failing them.
              </p>

              {/* The rules are the sharp end. One accepted by mistake is an
                  entry condition no human wrote, and it fails students on
                  every shortlist it touches without anybody being asked. So
                  each shows the sentence behind it and waits to be taken. */}
              {proposedRules.length ? (
                <div className="console-proposals">
                  <div className="console-proposals-head">
                    <span>
                      {proposedRules.length} requirement
                      {proposedRules.length === 1 ? "" : "s"} read off that page
                    </span>
                    <span className="console-rule-note">
                      Add the ones that are right. Nothing here is added for
                      you.
                    </span>
                  </div>
                  {proposedRules.map((proposal, index) => (
                    <div
                      key={`${proposal.fact_key}-${proposal.rule}`}
                      className="console-proposal"
                    >
                      <div className="console-proposal-body">
                        <div className="console-proposal-head">
                          <span className="console-rule-key">
                            {proposal.fact_key.replace(/_/g, " ")}
                          </span>
                          <span className="console-rule-expr">
                            {proposal.rule}
                          </span>
                          {proposal.evidence === "unclear" ? (
                            <span className="console-unclear">
                              <AlertIcon size={13} />
                              The page is not specific
                            </span>
                          ) : null}
                        </div>
                        <p className="console-rule-note mt-1">
                          {proposal.description}
                        </p>
                        <p className="console-quote">
                          <span className="console-quote-words">
                            {proposal.quote}
                          </span>{" "}
                          {proposal.section ? (
                            <span className="console-quote-where">
                              — {proposal.section}
                            </span>
                          ) : null}
                        </p>
                      </div>
                      <div className="console-proposal-actions">
                        <button
                          type="button"
                          className="console-proposal-add"
                          onClick={() => acceptRule(index)}
                        >
                          <PlusIcon size={12} />
                          Add
                        </button>
                        <button
                          type="button"
                          className="console-icon-btn"
                          data-variant="ghost"
                          aria-label={`Dismiss the ${proposal.rule} requirement`}
                          onClick={() =>
                            setProposedRules((held) =>
                              held.filter((_, i) => i !== index),
                            )
                          }
                        >
                          <CloseIcon size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {/* Hidden while proposals are on screen: the grid's empty state
                  says "no entry requirements", which under four unread
                  proposals is a contradiction rather than a prompt. */}
              {proposedRules.length && !draft.requirements.length ? null : (
              <RuleGrid
                requirements={draft.requirements.map((r, i) => ({
                  requirement_id: r.id ?? `new-${i}`,
                  key: r.fact_key,
                  rule: r.rule,
                  description: r.description,
                }))}
                onRemove={(index) =>
                  patch({
                    requirements: draft.requirements.filter(
                      (_, i) => i !== index,
                    ),
                  })
                }
              />
              )}

              <div className="console-chips mt-4">
                {TEMPLATES.map((template) => (
                  <button
                    key={template.label}
                    type="button"
                    className="console-chip-add"
                    onClick={() => addTemplate(template)}
                  >
                    <PlusIcon size={12} />
                    {template.label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="console-card">
            <div className="console-card-head">
              <h3 className="console-section-title">Source and verification</h3>
            </div>
            <div className="console-card-body">
              <label className="console-label" htmlFor="pg-source">
                Official source URL
              </label>
              <input
                id="pg-source"
                className="console-input max-w-[560px]"
                type="url"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
              />
              {/* Said plainly rather than implied. There is no source_url
                  column — tuition is on the fees page, requirements on the
                  course page, intakes on an admissions page, and one URL
                  cannot hold all three. `programme_sources` in migration 006
                  is the table for it, one row per figure, which is also where
                  the quotes shown above this belong. Until it exists the
                  quotes live for the length of this review and no longer. A
                  box that looked like it saved would be worse than one that
                  says it does not. */}
              <p className="console-week-note mt-1.5">
                Not stored yet, and neither are the quoted lines above — those
                last as long as this page is open. Sources land as their own
                table in 006, one per figure. Until then this programme is
                excluded from the overnight refresh job and its figures go
                stale silently.
              </p>
            </div>
          </section>
        </div>

        <div className="console-actionbar">
          <span
            className="console-actionbar-note"
            data-tone={!named || outstanding.length ? "blocked" : undefined}
          >
            {summary}
          </span>
          {/* Verification is a different permission from editing, so it is a
              different button. A counsellor may be trusted to correct a fee
              without being the person who certifies it, and the server is the
              side that decides which. */}
          {existing && complete && !outstanding.length && status !== "archived" ? (
            <button
              type="button"
              className="console-btn"
              data-variant="secondary"
              disabled={busy}
              onClick={() => verify.mutate(existing.id)}
            >
              {verify.isPending ? "Verifying…" : "Verify · show to the agent"}
            </button>
          ) : null}
          <button
            type="button"
            className="console-btn"
            data-variant="secondary"
            onClick={() => navigate("/catalogue")}
          >
            Cancel
          </button>
          <button
            type="button"
            className="console-btn"
            data-variant="primary"
            onClick={submit}
            disabled={!named || busy}
          >
            {save.isPending
              ? "Saving…"
              : isNew
                ? "Save · as a draft"
                : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
