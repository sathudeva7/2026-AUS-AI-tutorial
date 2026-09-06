/** The one place a Verdict becomes something you can look at.
 *
 * CLAUDE.md: "`indeterminate` is a first-class result. `check_requirements`
 * returns `pass | fail | indeterminate` plus the document that would settle
 * it. Never collapse indeterminate into a boolean anywhere in the stack."
 *
 * So there is exactly one mapping, it is a `switch` over the union with no
 * `default`, and TypeScript fails the build if a fourth verdict is ever added
 * without a decision about how it looks. Do not write `verdict === "pass"`
 * ternaries at call sites — that is the collapse the rule forbids, spelled
 * differently.
 */
import type { Verdict } from "@/data/types";

export interface VerdictStyle {
  /** The word. Never rely on colour alone to carry state. */
  label: string;
  background: string;
  foreground: string;
}

export function verdictStyle(verdict: Verdict): VerdictStyle {
  switch (verdict) {
    case "pass":
      return {
        label: "MET",
        background: "var(--color-accent-2-200)",
        foreground: "var(--color-accent-2-800)",
      };
    case "fail":
      return {
        label: "NOT MET",
        background: "var(--color-accent-200)",
        foreground: "var(--color-accent-800)",
      };
    case "indeterminate":
      return {
        label: "INDETERMINATE",
        background: "var(--color-neutral-300)",
        foreground: "var(--color-neutral-900)",
      };
  }
}

/** A neutral chip for text that is not a verdict at all — a deadline, a
 *  budget headroom note. Kept here so chip colours live in one file. */
export const plainChipStyle: VerdictStyle = {
  label: "",
  background: "var(--color-neutral-200)",
  foreground: "var(--color-neutral-700)",
};

/** Which shortlist band an entry belongs to.
 *
 * Bands are derived at render time, never stored:
 *   pass, within budget  → strong
 *   pass, over budget    → stretch   (academically fine, above the ceiling)
 *   fail | indeterminate → action    (one thing stands between)
 *
 * `fail` and `indeterminate` share a band but never share a chip — the chip
 * is what tells the student whether to retake a test or send a document.
 */
export type Band = "strong" | "action" | "stretch";

export function bandFor(verdict: Verdict, overBudget: boolean): Band {
  switch (verdict) {
    case "pass":
      return overBudget ? "stretch" : "strong";
    case "fail":
    case "indeterminate":
      return "action";
  }
}

export const BANDS: {
  key: Band;
  name: string;
  note: string;
  background: string;
  foreground: string;
}[] = [
  {
    key: "strong",
    name: "Strong match",
    note: "every requirement met",
    background: "var(--color-accent-2-200)",
    foreground: "var(--color-accent-2-800)",
  },
  {
    key: "action",
    name: "Requires action",
    note: "one thing stands between you and these",
    background: "var(--color-accent-200)",
    foreground: "var(--color-accent-800)",
  },
  {
    key: "stretch",
    name: "Stretch",
    note: "academically fine, above your budget",
    background: "var(--color-neutral-300)",
    foreground: "var(--color-neutral-900)",
  },
];

/** Escalation triggers, in the words a counsellor should read. The agent
 *  stores the enum; nobody should have to read `dependants_or_sponsorship`. */
export const TRIGGER_LABELS: Record<string, string> = {
  visa_refusal: "Previous visa refusal declared",
  fee_dispute: "Fee or payment dispute",
  dependants_or_sponsorship: "Dependants or third-party sponsorship",
  low_confidence: "Shortlist confidence below the floor",
  student_requested_human: "Student asked for a person",
  visa_or_immigration_advice: "Visa or immigration advice requested",
  system_failure: "System failure — the agent could not answer without guessing",
};

export function triggerLabel(trigger: string): string {
  return TRIGGER_LABELS[trigger] ?? trigger.replace(/_/g, " ");
}
