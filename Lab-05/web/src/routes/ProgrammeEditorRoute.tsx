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
import {
  Button,
  Card,
  Field,
  Input,
  Kicker,
  Pill,
  StatusChip,
} from "@/components/ui";
import { RuleGrid } from "./CatalogueRoute";
import {
  getProgramme,
  newProgrammeId,
  saveProgramme,
  useCatalogue,
} from "@/data/catalogueStore";
import { formatIntake, verifiedLabel } from "@/lib/format";
import type { FactKey, Programme, Requirement } from "@/data/types";

const INTAKE_OPTIONS = ["2027-01", "2027-02", "2027-09", "2027-10"];
const LEVELS = ["masters", "bachelors", "phd", "foundation"];

/** Requirement templates. `key` must be one of the seven fact keys — a rule
 *  keyed on anything else can never be evaluated, because there is no fact to
 *  evaluate it against. */
const TEMPLATES: { label: string; key: FactKey; rule: string; description: string }[] = [
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
    <div className="max-w-[1000px] px-8 pb-12 pt-[26px]">
      <Button
        variant="ghost"
        className="mb-3.5 text-[12.5px]"
        onClick={() => navigate("/catalogue")}
      >
        ← Back to catalogue
      </Button>

      <div className="mb-1.5 flex items-start gap-4">
        <div>
          <h2 className="m-0 text-[32px]">
            {isNew ? "Add a programme" : draft.name || "Untitled programme"}
          </h2>
          <p
            className="m-0 mt-1.5 max-w-[74ch] text-[13.5px]"
            style={{ color: "var(--color-neutral-700)" }}
          >
            {isNew
              ? "Nothing here is visible to the agent until it is saved and marked verified."
              : `${draft.institution} · editing writes a new revision. The previous one is retained, and any shortlist built on it stays intact.`}
          </p>
        </div>
        <StatusChip
          label={
            isNew
              ? "Draft · not yet visible"
              : `Published · verified ${verifiedLabel(draft.verified_at)}`
          }
          background={
            isNew ? "var(--color-neutral-300)" : "var(--color-accent-2-200)"
          }
          foreground={
            isNew ? "var(--color-neutral-900)" : "var(--color-accent-2-800)"
          }
          className="ml-auto"
        />
      </div>

      <div className="mt-5 flex flex-col gap-4">
        <Card className="rounded-md p-[18px]">
          <Kicker>Identity</Kicker>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Programme name" htmlFor="pg-name">
              <Input
                id="pg-name"
                value={draft.name}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </Field>
            <Field label="Institution" htmlFor="pg-inst">
              <Input
                id="pg-inst"
                value={draft.institution}
                onChange={(e) => patch({ institution: e.target.value })}
              />
            </Field>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-3">
            <Field label="Country" htmlFor="pg-country">
              <Input
                id="pg-country"
                value={draft.country}
                onChange={(e) => patch({ country: e.target.value })}
              />
            </Field>
            <Field label="City" htmlFor="pg-city">
              <Input
                id="pg-city"
                value={draft.city}
                onChange={(e) => patch({ city: e.target.value })}
              />
            </Field>
            <Field label="Award level">
              <div className="flex flex-wrap gap-1.5 pt-1">
                {LEVELS.map((level) => (
                  <Pill
                    key={level}
                    role="radio"
                    label={level}
                    selected={draft.level === level}
                    onClick={() => patch({ level })}
                  />
                ))}
              </div>
            </Field>
            <Field label="Duration (months)" htmlFor="pg-duration">
              <Input
                id="pg-duration"
                type="number"
                value={draft.duration_months}
                onChange={(e) =>
                  patch({ duration_months: Number(e.target.value) })
                }
              />
            </Field>
          </div>
          <Field
            label="Field"
            htmlFor="pg-field"
            className="mt-3"
            hint="Field feeds career-goal mapping. It affects ranking only — it never excludes a programme from a shortlist."
          >
            <Input
              id="pg-field"
              value={draft.field}
              onChange={(e) => patch({ field: e.target.value })}
            />
          </Field>
        </Card>

        <Card className="rounded-md p-[18px]">
          <Kicker>Intakes &amp; cost</Kicker>
          <div className="mb-3.5 flex flex-wrap gap-[7px]">
            {INTAKE_OPTIONS.map((intake) => (
              <Pill
                key={intake}
                role="checkbox"
                label={formatIntake(intake)}
                selected={draft.intakes.includes(intake)}
                onClick={() =>
                  patch({
                    intakes: draft.intakes.includes(intake)
                      ? draft.intakes.filter((i) => i !== intake)
                      : [...draft.intakes, intake],
                  })
                }
              />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Tuition · international, per year" htmlFor="pg-fee">
              <Input
                id="pg-fee"
                type="number"
                value={draft.tuition_per_year || ""}
                onChange={(e) =>
                  patch({ tuition_per_year: Number(e.target.value) })
                }
              />
            </Field>
            <Field
              label="Currency"
              htmlFor="pg-currency"
              hint="Stored beside the amount — nothing in this system assumes a symbol."
            >
              <Input
                id="pg-currency"
                value={draft.currency}
                onChange={(e) =>
                  patch({ currency: e.target.value.toUpperCase() })
                }
              />
            </Field>
            <Field label="Application deadline" htmlFor="pg-deadline">
              <Input
                id="pg-deadline"
                type="date"
                value={draft.application_deadline}
                onChange={(e) =>
                  patch({ application_deadline: e.target.value })
                }
              />
            </Field>
          </div>
        </Card>

        <Card className="rounded-md p-[18px]">
          <div className="mb-1 flex items-baseline gap-2.5">
            <Kicker>Entry requirements</Kicker>
            <span
              className="ml-auto text-[11.5px]"
              style={{ color: "var(--color-neutral-700)" }}
            >
              {draft.requirements.length}{" "}
              {draft.requirements.length === 1 ? "requirement" : "requirements"}
            </span>
          </div>
          <p
            className="mb-3.5 mt-0 max-w-[76ch] text-[12.5px]"
            style={{ color: "var(--color-neutral-700)" }}
          >
            Requirements are data, not prose. Each row evaluates to MET,
            NOT_MET or INDETERMINATE against a student&apos;s stated facts, and
            a row keyed on a fact they have never stated comes back
            INDETERMINATE rather than failing them.
          </p>

          <RuleGrid
            requirements={draft.requirements}
            onRemove={(index) =>
              patch({
                requirements: draft.requirements.filter((_, i) => i !== index),
              })
            }
          />

          <div className="mt-3.5 flex flex-wrap gap-[7px]">
            {TEMPLATES.map((template) => (
              <button
                key={template.label}
                type="button"
                onClick={() => addTemplate(template)}
                className="cursor-pointer rounded-pill border px-[13px] py-1.5 font-body text-[12px]"
                style={{
                  background: "var(--color-neutral-100)",
                  borderColor: "var(--color-divider)",
                }}
              >
                + {template.label}
              </button>
            ))}
          </div>
        </Card>

        <Card className="rounded-md p-[18px]">
          <Kicker>Source &amp; verification</Kicker>
          <Field
            label="Official source URL"
            htmlFor="pg-source"
            className="mb-3"
            hint={
              draft.source_url
                ? "The overnight refresh job checks this URL and raises a review item when a figure drifts. It never writes to the catalogue itself."
                : "Without a source URL this programme is excluded from the overnight refresh job, and its figures will go stale silently."
            }
            hintTone={draft.source_url ? "muted" : "warning"}
          >
            <Input
              id="pg-source"
              type="url"
              value={draft.source_url ?? ""}
              onChange={(e) => patch({ source_url: e.target.value })}
            />
          </Field>
        </Card>
      </div>

      <div
        className="sticky bottom-0 mt-4 flex items-center gap-2 rounded-md p-4"
        style={{
          background: "var(--color-neutral-100)",
          border: "1px solid var(--color-divider)",
        }}
      >
        <span
          className="flex-1 text-[12.5px]"
          style={{
            color: ready
              ? "var(--color-neutral-700)"
              : "var(--color-accent-800)",
          }}
        >
          {summary}
        </span>
        <Button variant="secondary" onClick={() => navigate("/catalogue")}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={save}
          disabled={!ready}
          aria-disabled={!ready}
        >
          {isNew ? "Save · publish to the agent" : "Save · writes a revision"}
        </Button>
      </div>
    </div>
  );
}
