/** The shortlist, in three bands.
 *
 * Shared by the widget (as a chat card) and the dashboard's Shortlist tab (as
 * a page card), because they are the same object and a counsellor should see
 * exactly what the student saw.
 *
 * Bands are derived at render time from each entry's verdict and the lead's
 * budget — see lib/verdict.ts. Nothing stores a band, so a shortlist rebuilt
 * from the audit trail six weeks later groups the same way.
 *
 * Every figure here comes from the programme catalogue and travels with the
 * date it was last verified. An entry whose programme is not in the catalogue
 * renders its id and says so rather than inventing a name.
 */
import { useEffect, useState } from "react";
import { repo } from "@/data/repo";
import {
  formatFit,
  formatIntake,
  formatMoney,
  verifiedLabel,
} from "@/lib/format";
import { BANDS, bandFor, verdictStyle, type Band } from "@/lib/verdict";
import type {
  Programme,
  RequirementCheck,
  Shortlist,
  ShortlistEntry,
} from "@/data/types";
import { cn } from "@/lib/utils";

interface Props {
  shortlist: Shortlist;
  /** programme_id → the checks behind it, when check_requirements ran in the
   *  same turn. Absent is normal: the shortlist stands on its own. */
  checks?: Record<string, RequirementCheck[]>;
  /** The lead's stated tuition ceiling, which is what separates a Strong
   *  match from a Stretch. Without it nothing is called a stretch — we do not
   *  invent a budget the student never gave us. */
  budgetPerYear?: number;
  /** The intake the student stated, e.g. "2027-09".
   *
   *  A programme usually runs several. Showing `intakes[0]` put "January 2027"
   *  on a card for a student who had said September — a factual mismatch on
   *  the one screen that is meant to be about her options. */
  intendedIntake?: string;
  variant?: "widget" | "page";
}

export function ShortlistCard({
  shortlist,
  checks,
  budgetPerYear,
  intendedIntake,
  variant = "widget",
}: Props) {
  const [programmes, setProgrammes] = useState<Programme[]>([]);

  useEffect(() => {
    let cancelled = false;
    void repo.listProgrammes().then((all) => {
      if (!cancelled) setProgrammes(all);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const byId = new Map(programmes.map((p) => [p.programme_id, p]));

  const grouped = new Map<Band, ShortlistEntry[]>();
  for (const entry of shortlist.entries) {
    const programme = byId.get(entry.programme_id);
    const overBudget =
      budgetPerYear !== undefined &&
      programme !== undefined &&
      programme.tuition_per_year > budgetPerYear;
    const band = bandFor(entry.verdict, overBudget);
    grouped.set(band, [...(grouped.get(band) ?? []), entry]);
  }

  return (
    <div className={cn("flex flex-col gap-[10px]", variant === "page" && "max-w-[920px]")}>
      {BANDS.filter((band) => grouped.get(band.key)?.length).map((band) => (
        <div
          key={band.key}
          className="overflow-hidden rounded-md"
          style={{
            background: "var(--color-bg)",
            border: "1px solid var(--color-divider)",
          }}
        >
          <div
            className="flex items-baseline gap-2 px-[13px] py-[9px]"
            style={{ background: band.background, color: band.foreground }}
          >
            <span className="font-heading text-[13px]">{band.name}</span>
            <span className="text-[11px]">{band.note}</span>
          </div>
          <div className="flex flex-col">
            {(grouped.get(band.key) ?? []).map((entry) => (
              <Entry
                key={entry.programme_id}
                entry={entry}
                programme={byId.get(entry.programme_id)}
                checks={checks?.[entry.programme_id]}
                intendedIntake={intendedIntake}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Entry({
  entry,
  programme,
  checks,
  intendedIntake,
}: {
  entry: ShortlistEntry;
  programme?: Programme;
  checks?: RequirementCheck[];
  intendedIntake?: string;
}) {
  // Show the intake the student asked about when this programme runs it;
  // otherwise the earliest one it does run, so the card never implies a start
  // date they did not choose.
  const intake =
    intendedIntake && programme?.intakes.includes(intendedIntake)
      ? intendedIntake
      : [...(programme?.intakes ?? [])].sort()[0];

  return (
    <div
      className="px-[13px] py-3"
      style={{ borderTop: "1px solid var(--color-divider)" }}
    >
      <div className="flex items-baseline gap-2">
        <div className="flex-1">
          <div className="text-[13px] font-semibold leading-snug">
            {programme?.name ?? entry.programme_id}
          </div>
          <div
            className="text-[11.5px]"
            style={{ color: "var(--color-neutral-600)" }}
          >
            {programme ? (
              <>
                {programme.institution} ·{" "}
                {formatMoney(programme.tuition_per_year, programme.currency)}
                {intake ? ` · ${formatIntake(intake)}` : ""}
              </>
            ) : (
              "Not in the verified catalogue — a counsellor must check it in before it can be scored."
            )}
          </div>
        </div>
        <span
          className="figure text-[11px]"
          style={{ color: "var(--color-neutral-700)" }}
        >
          {formatFit(entry.confidence)}
        </span>
      </div>

      {checks?.length ? (
        <div className="mt-2 flex flex-wrap gap-[5px]">
          {checks.map((check) => {
            const style = verdictStyle(check.verdict);
            return (
              <span
                key={check.requirement_id}
                className="rounded-pill px-[9px] py-[3px] text-[10.5px]"
                style={{ background: style.background, color: style.foreground }}
              >
                {check.reason} · {style.label}
              </span>
            );
          })}
        </div>
      ) : null}

      {/* The hinge is the single requirement the match turns on, in the
          agent's plain English. It is the most useful sentence on the card. */}
      {entry.hinge ? (
        <div
          className="mt-2 rounded-sm px-[10px] py-2 text-[11.5px] leading-relaxed"
          style={{
            background: "var(--color-neutral-100)",
            border: "1px solid var(--color-divider)",
          }}
        >
          {entry.hinge}
        </div>
      ) : null}

      {/* An indeterminate entry names the document that would settle it. This
          is the difference between "you are not eligible" and "send us one
          more thing", and collapsing it would lose a student a place. */}
      {entry.verdict === "indeterminate" && entry.resolving_document ? (
        <div
          className="mt-1.5 text-[11.5px]"
          style={{ color: "var(--color-neutral-700)" }}
        >
          Unresolved until we see: {entry.resolving_document}
        </div>
      ) : null}

      {entry.missing_facts.length ? (
        <div
          className="mt-1.5 text-[11.5px]"
          style={{ color: "var(--color-neutral-700)" }}
        >
          One question away — still to ask:{" "}
          {entry.missing_facts.map((f) => f.replace(/_/g, " ")).join(", ")}
        </div>
      ) : null}

      {programme ? (
        <div
          className="mt-[7px] text-[10.5px]"
          style={{ color: "var(--color-neutral-600)" }}
        >
          Catalogue verified {verifiedLabel(programme.verified_at)}
        </div>
      ) : null}
    </div>
  );
}
