/** Create or edit one programme.
 *
 * The footer is the important part: it never just says "invalid". It names
 * exactly what is still missing, and it says out loud what saving with no
 * entry requirements would mean — a programme that matches every student.
 * A catalogue row is what the agent is permitted to assert about someone's
 * future, so the editor argues with you before it lets you publish a vague
 * one.
 */
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { Select, type SelectOption } from "@/components/ui/Select";
import { ChevronLeftIcon, PlusIcon } from "@/components/ui/icons";
import { RuleGrid } from "./CatalogueRoute";
import {
  getProgramme,
  newProgrammeId,
  saveProgramme,
  useCatalogue,
} from "@/data/catalogueStore";
import { COUNTRIES } from "@/data/countries";
import { levelLabel } from "@/features/catalogue/display";
import { formatIntake, verifiedLabel } from "@/lib/format";
import type { FactKey, Programme, Requirement } from "@/data/types";

const INTAKE_OPTIONS = ["2027-01", "2027-02", "2027-09", "2027-10"];
const LEVELS = ["masters", "bachelors", "phd", "foundation"];

/** Currencies the seed catalogue uses, plus the majors an agency is likely to
 *  add. A free-text box here was how you got "Aud" beside a figure the agent
 *  then quotes to a student. */
const CURRENCIES = ["GBP", "EUR", "USD", "AUD", "CAD", "NZD", "LKR", "INR"];

/** Requirement templates. `key` must be one of the seven fact keys — a rule
 *  keyed on anything else can never be evaluated, because there is no fact to
 *  evaluate it against. */
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

function blankProgramme(): Programme {
  return {
    programme_id: "",
    institution: "",
    country: "",
    city: "",
    name: "",
    level: "masters",
    field: "",
    tuition_per_year: 0,
    currency: "GBP",
    duration_months: 12,
    intakes: [],
    application_deadline: "",
    requirements: [],
    verified_at: "",
    source_url: "",
    draft: true,
  };
}

export function ProgrammeEditorRoute() {
  const { programmeId } = useParams();
  const navigate = useNavigate();
  useCatalogue(); // re-render when the store changes underneath us
  const isNew = !programmeId;
  const existing = programmeId ? getProgramme(programmeId) : undefined;

  const [draft, setDraft] = useState<Programme>(
    () => existing ?? blankProgramme(),
  );

  const patch = (changes: Partial<Programme>) =>
    setDraft((d) => ({ ...d, ...changes }));

  const missing = useMemo(() => {
    const gaps: string[] = [];
    if (!draft.name.trim()) gaps.push("a programme name");
    if (!draft.institution.trim()) gaps.push("an institution");
    if (!draft.country.trim()) gaps.push("a country");
    if (!draft.tuition_per_year) gaps.push("a tuition figure");
    if (!draft.intakes.length) gaps.push("at least one intake");
    return gaps;
  }, [draft]);

  const ready = missing.length === 0;

  const summary = ready
    ? draft.requirements.length === 0
      ? "Saving with no entry requirements — this programme will match every student who reaches the catalogue."
      : `${draft.requirements.length} requirement${
          draft.requirements.length === 1 ? "" : "s"
        } · ${draft.intakes.length} intake${draft.intakes.length === 1 ? "" : "s"}`
    : `Still needs ${missing.join(", ")}.`;

  /** Countries, with whatever this programme already says kept as an option.
   *
   * The seed catalogue writes "UK", which is not how the ISO list spells it.
   * Dropping the stored value from the list would mean opening an existing
   * programme and finding its country silently blank — an edit to the fee
   * would then save a country nobody touched. */
  const countryOptions: SelectOption[] = [
    ...(draft.country && !COUNTRIES.some((c) => c.name === draft.country)
      ? [{ value: draft.country, label: draft.country, detail: "as stored" }]
      : []),
    ...COUNTRIES.map((c) => ({
      value: c.name,
      label: c.name,
      prefix: c.flag,
      keywords: c.code,
    })),
  ];

  function save() {
    if (!ready) return;
    saveProgramme({
      ...draft,
      programme_id: draft.programme_id || newProgrammeId(),
      draft: false,
    });
    navigate("/catalogue");
  }

  function addTemplate(template: (typeof TEMPLATES)[number]) {
    const requirement: Requirement = {
      requirement_id: `${draft.programme_id || "new"}_r${draft.requirements.length + 1}`,
      key: template.key,
      rule: template.rule,
      description: template.description,
      mandatory: true,
    };
    patch({ requirements: [...draft.requirements, requirement] });
  }

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
            {isNew ? "Add programme" : draft.name || "Untitled programme"}
          </span>
        </nav>

        <div className="flex items-start gap-4">
          <div className="min-w-0">
            <h2 className="console-page-title">
              {isNew ? "Add a programme" : draft.name || "Untitled programme"}
            </h2>
            <p className="console-page-sub">
              {isNew
                ? "Nothing here is visible to the agent until it is saved and marked verified."
                : `${draft.institution} · editing writes a new revision. The previous one is retained, and any shortlist built on it stays intact.`}
            </p>
          </div>
          <span
            className="console-pill ml-auto flex-none"
            data-status={isNew ? "invited" : "active"}
          >
            {isNew
              ? "Draft · not yet visible"
              : `Verified ${verifiedLabel(draft.verified_at)}`}
          </span>
        </div>

        <div className="mt-5 flex flex-col gap-4">
          <section className="console-card">
            <div className="console-card-head">
              <h3 className="console-section-title">Identity</h3>
            </div>
            <div className="console-card-body">
              <div className="console-form-grid" data-cols="2">
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
                </div>
              </div>

              <div className="console-form-grid mt-4" data-cols="3">
                <div>
                  <label className="console-label" htmlFor="pg-country">
                    Country
                  </label>
                  {/* A list, not a text box. The country string is matched
                      against counsellors' owned countries to decide routing
                      and against the catalogue coverage banner — a typed
                      "Aus" is a destination nobody owns, forever. */}
                  <Select
                    value={draft.country}
                    options={countryOptions}
                    placeholder="Choose a country…"
                    ariaLabel="Country"
                    onChange={(country) => patch({ country })}
                  />
                </div>
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
                      patch({ duration_months: Number(e.target.value) })
                    }
                  />
                </div>
              </div>

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
            </div>
          </section>

          <section className="console-card">
            <div className="console-card-head">
              <h3 className="console-section-title">Intakes and cost</h3>
            </div>
            <div className="console-card-body">
              <div className="console-label">Intakes</div>
              <div
                className="console-chips"
                role="group"
                aria-label="Intakes"
              >
                {INTAKE_OPTIONS.map((intake) => (
                  <button
                    key={intake}
                    type="button"
                    role="checkbox"
                    className="console-chip"
                    aria-checked={draft.intakes.includes(intake)}
                    onClick={() =>
                      patch({
                        intakes: draft.intakes.includes(intake)
                          ? draft.intakes.filter((i) => i !== intake)
                          : [...draft.intakes, intake],
                      })
                    }
                  >
                    {formatIntake(intake)}
                  </button>
                ))}
              </div>

              <div className="console-form-grid mt-4" data-cols="3">
                <div>
                  <label className="console-label" htmlFor="pg-fee">
                    Tuition · international, per year
                  </label>
                  <input
                    id="pg-fee"
                    className="console-input"
                    type="number"
                    value={draft.tuition_per_year || ""}
                    onChange={(e) =>
                      patch({ tuition_per_year: Number(e.target.value) })
                    }
                  />
                </div>
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
                <div>
                  <label className="console-label" htmlFor="pg-deadline">
                    Application deadline
                  </label>
                  <input
                    id="pg-deadline"
                    className="console-input"
                    type="date"
                    value={draft.application_deadline}
                    onChange={(e) =>
                      patch({ application_deadline: e.target.value })
                    }
                  />
                </div>
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

              <RuleGrid
                requirements={draft.requirements}
                onRemove={(index) =>
                  patch({
                    requirements: draft.requirements.filter(
                      (_, i) => i !== index,
                    ),
                  })
                }
              />

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
                value={draft.source_url ?? ""}
                onChange={(e) => patch({ source_url: e.target.value })}
              />
              {/* The absence is the warning, not the presence. A programme
                  with no source is excluded from the refresh job and goes
                  stale without anything saying so. */}
              {draft.source_url ? (
                <p className="console-hint">
                  The overnight refresh job checks this URL and raises a review
                  item when a figure drifts. It never writes to the catalogue
                  itself.
                </p>
              ) : (
                <p className="console-week-note mt-1.5">
                  Without a source URL this programme is excluded from the
                  overnight refresh job, and its figures will go stale
                  silently.
                </p>
              )}
            </div>
          </section>
        </div>

        <div className="console-actionbar">
          <span
            className="console-actionbar-note"
            data-tone={ready ? undefined : "blocked"}
          >
            {summary}
          </span>
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
            onClick={save}
            disabled={!ready}
          >
            {isNew ? "Save · publish to the agent" : "Save · writes a revision"}
          </button>
        </div>
      </div>
    </div>
  );
}
