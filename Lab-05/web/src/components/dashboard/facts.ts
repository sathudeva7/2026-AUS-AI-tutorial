/** Assembling a lead's profile from what is on file — and only that.
 *
 * Two rules from CLAUDE.md shape everything here:
 *
 *   "Facts are quoted, not inferred." Every stated fact carries the student's
 *   own words. `resolveQuote` recovers them from the audit trail first and
 *   the seed book second, and returns null rather than inventing one.
 *
 *   Absent means NOT YET STATED, never "assume the default". So a fact is
 *   Confirmed when it is present and Missing when it is in `missing` — there
 *   is no third state the UI derives on its own. The prototype showed an
 *   "Inferred" pill; nothing in this system produces inferred facts, and
 *   rendering one would advertise a capability the guardrails exist to
 *   prevent.
 */
import { SEED_QUOTES } from "@/data/fixtures/seedQuotes";
import { sessionQuotes } from "@/data/session";
import { FACT_LABELS, type Briefing, type Fact, type FactKey } from "@/data/types";

export type FactState = "Confirmed" | "Missing";

export type QuoteSource = "audit trail" | "this session" | "seed record";

export interface FactRow {
  key: FactKey;
  label: string;
  value: string;
  state: FactState;
  /** The student's own words, when they are recoverable. */
  quote: string | null;
  /** Where the quote came from, so the UI can be honest about it. */
  quoteSource: QuoteSource | null;
}

export interface FactGroup {
  name: string;
  rows: FactRow[];
}

const GROUPS: { name: string; keys: FactKey[] }[] = [
  { name: "Intent", keys: ["target_country", "field_of_study", "intended_intake"] },
  { name: "Academic", keys: ["qualification", "grades"] },
  { name: "English", keys: ["english_test"] },
  { name: "Financial", keys: ["budget_per_year"] },
];

/** The latest `update_lead_facts` quote per key, from the audit trail.
 *
 *  In practice this finds nothing today, and that is worth knowing rather
 *  than discovering: `update_lead_facts` is an in-process Strands tool, not
 *  an MCP one, so it never passes through the `@audited` decorator that
 *  writes a ToolCall row. Verified against a live turn — seven successful
 *  fact writes, zero audit rows.
 *
 *  It is kept because it is the correct source the moment fact writes are
 *  audited, and because it costs one pass over a list we already have.
 *
 *  Only successful writes count: a rejected write is the `fact_not_stated`
 *  guardrail firing, and showing that quote would display exactly the
 *  invented fact the check exists to block. */
function quotesFromTrail(
  toolCalls: Briefing["tool_calls"],
): Partial<Record<FactKey, Fact>> {
  const out: Partial<Record<FactKey, Fact>> = {};
  for (const call of toolCalls) {
    if (call.tool !== "update_lead_facts" || !call.ok) continue;
    const args = call.args as {
      key?: string;
      value?: string;
      source_quote?: string;
    };
    if (!args.key || !args.source_quote) continue;
    out[args.key as FactKey] = {
      value: args.value ?? "",
      source_quote: args.source_quote,
      stated_at: call.timestamp,
    };
  }
  return out;
}

function formatValue(key: FactKey, value: string | number): string {
  if (key === "budget_per_year" && typeof value === "number") {
    // No currency is stored beside a budget in the fact record, so it is
    // shown as the bare number the student stated rather than dressed in a
    // symbol nobody chose.
    return `${value.toLocaleString("en-GB")} per year`;
  }
  if (key === "grades" && typeof value === "number") return `${value}%`;
  return String(value);
}

export function buildFactGroups(briefing: Briefing): FactGroup[] {
  // Three sources, most authoritative first: the audit trail (durable, and
  // empty until fact writes are audited), what the widget caught on the wire
  // this session, then the seed book.
  const trail = quotesFromTrail(briefing.tool_calls);
  const fromSession = sessionQuotes(briefing.lead_id);
  const seeded = SEED_QUOTES[briefing.lead_id] ?? {};

  return GROUPS.map((group) => ({
    name: group.name,
    rows: group.keys.map((key): FactRow => {
      const value = briefing.facts[key];
      if (value === undefined || value === null) {
        return {
          key,
          label: FACT_LABELS[key],
          value: "Not yet stated",
          state: "Missing",
          quote: null,
          quoteSource: null,
        };
      }
      const quote =
        trail[key]?.source_quote ??
        fromSession[key] ??
        seeded[key]?.source_quote ??
        null;
      const quoteSource: QuoteSource | null = trail[key]
        ? "audit trail"
        : fromSession[key]
          ? "this session"
          : seeded[key]
            ? "seed record"
            : null;
      return {
        key,
        label: FACT_LABELS[key],
        value: formatValue(key, value),
        state: "Confirmed",
        quote,
        quoteSource,
      };
    }),
  })).filter((group) => group.rows.length > 0);
}

export const FACT_STATE_STYLE: Record<
  FactState,
  { background: string; foreground: string }
> = {
  Confirmed: {
    background: "var(--color-accent-2-200)",
    foreground: "var(--color-accent-2-800)",
  },
  Missing: {
    background: "var(--color-accent-200)",
    foreground: "var(--color-accent-800)",
  },
};

/** A one-line summary of what the lead is after, for the list column. Built
 *  only from facts on file — a lead with nothing stated says so. */
export function wantLine(facts: Briefing["facts"]): string {
  const bits = [
    facts.field_of_study,
    facts.target_country,
    facts.intended_intake,
  ].filter(Boolean);
  return bits.length ? bits.join(" · ") : "Nothing stated yet";
}

/** Progress as a fraction of the seven facts, which is what "profile 38%
 *  complete" means. */
export function profileCompleteness(briefing: {
  facts: Briefing["facts"];
}): number {
  return Math.round((Object.keys(briefing.facts).length / 7) * 100);
}

export const LEAD_STATUS_STYLE: Record<
  string,
  { background: string; foreground: string }
> = {
  active: {
    background: "var(--color-accent-2-200)",
    foreground: "var(--color-accent-2-800)",
  },
  escalated: {
    background: "var(--color-accent-200)",
    foreground: "var(--color-accent-800)",
  },
  parked: {
    background: "var(--color-neutral-300)",
    foreground: "var(--color-neutral-900)",
  },
  withdrawn: {
    background: "var(--color-neutral-300)",
    foreground: "var(--color-neutral-900)",
  },
  converted: {
    background: "var(--color-accent-2-200)",
    foreground: "var(--color-accent-2-800)",
  },
};
