/** Turning an agent turn into things a student can look at.
 *
 * The rule this file exists to enforce: **the widget renders tool results,
 * never parsed prose.** CLAUDE.md — "The agent may never state a fee,
 * deadline, requirement, ranking or visa rule that did not come back from a
 * tool call." A UI that scraped a fee out of the reply text would be a second
 * place that rule could break, and a harder one to audit than the tool
 * boundary. So every figure on screen traces to a `tool_result` frame, and
 * the agent's own words are rendered as words.
 *
 * The reply text still appears — as a bubble, as prose. It just never becomes
 * a card.
 */
import type {
  Escalation,
  RequirementCheck,
  Shortlist,
  Slot,
  Verdict,
} from "@/data/types";

// ---------------------------------------------------------------------------
// Timeline items
// ---------------------------------------------------------------------------

export interface ToolChip {
  toolUseId: string;
  name: string;
  argsSummary: string;
  /** Undefined while the call is still in flight. */
  resultSummary?: string;
  isError?: boolean;
}

export interface RetrievedSource {
  title: string;
  url: string;
  host: string;
  published?: string;
}

export type TimelineItem =
  | { id: string; kind: "student"; text: string; at: string }
  | { id: string; kind: "agent"; text: string; at: string; streaming?: boolean }
  | { id: string; kind: "tools"; chips: ToolChip[] }
  | { id: string; kind: "note"; text: string }
  | {
      id: string;
      kind: "shortlist";
      shortlist: Shortlist;
      /** programme_id → the checks behind it, when check_requirements ran. */
      checks: Record<string, RequirementCheck[]>;
    }
  | {
      id: string;
      kind: "citation";
      /** Tier 2. Retrieved from the open web, filtered to an allowlist, and
       *  never presented as catalogue truth. */
      sources: RetrievedSource[];
      droppedOfflist: number;
      note?: string;
      searchCostUsd?: number;
    }
  | { id: string; kind: "booking"; slot: Slot }
  | { id: string; kind: "escalation"; escalation: Escalation; queued: boolean }
  | { id: string; kind: "failure"; message: string };

// ---------------------------------------------------------------------------
// Narrow, defensively, from `unknown`
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A tool result that came back as an error envelope. `_error()` in the MCP
 *  server shapes these: {error, code, detail, remediation}. */
export function isToolError(result: unknown): boolean {
  return isRecord(result) && "error" in result;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const VERDICTS: Verdict[] = ["pass", "fail", "indeterminate"];

function asVerdict(value: unknown): Verdict | null {
  return VERDICTS.includes(value as Verdict) ? (value as Verdict) : null;
}

/** `build_shortlist` → Shortlist, or null if the payload is not one.
 *
 *  An entry whose verdict is not a member of the union is dropped rather than
 *  defaulted to "pass". Guessing here would put a programme in the Strong
 *  match band on the strength of a typo. */
export function parseShortlist(result: unknown): Shortlist | null {
  if (!isRecord(result) || !Array.isArray(result.entries)) return null;
  const entries = result.entries.flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const verdict = asVerdict(raw.verdict);
    if (!verdict) return [];
    return [
      {
        programme_id: str(raw.programme_id),
        confidence: num(raw.confidence) ?? 0,
        hinge: str(raw.hinge),
        verdict,
        resolving_document: str(raw.resolving_document) || null,
        missing_facts: Array.isArray(raw.missing_facts)
          ? (raw.missing_facts as Shortlist["entries"][number]["missing_facts"])
          : [],
      },
    ];
  });
  if (!entries.length) return null;
  return {
    lead_id: str(result.lead_id),
    entries,
    overall_confidence: num(result.overall_confidence) ?? 0,
  };
}

/** `check_requirements` → the per-requirement checks for one programme. */
export function parseChecks(
  result: unknown,
): { programmeId: string; checks: RequirementCheck[] } | null {
  if (!isRecord(result) || !Array.isArray(result.checks)) return null;
  const checks = result.checks.flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const verdict = asVerdict(raw.verdict);
    if (!verdict) return [];
    return [
      {
        requirement_id: str(raw.requirement_id),
        key: raw.key as RequirementCheck["key"],
        verdict,
        reason: str(raw.reason),
        mandatory: raw.mandatory !== false,
        resolving_document: str(raw.resolving_document) || null,
        missing_fact: raw.missing_fact === true,
      },
    ];
  });
  return { programmeId: str(result.programme_id), checks };
}

/** `research_visa_question` / `find_unverified_programmes` → Tier 2 sources.
 *
 *  Both tools filter results by host against the allowlist in
 *  `mcp_servers/northbound/sources.py` before the agent ever sees them, and
 *  report how many they dropped. That count is shown: it is the boundary
 *  visibly working, in the same place the student reads the answer. */
export function parseRetrieval(result: unknown): {
  sources: RetrievedSource[];
  droppedOfflist: number;
  note?: string;
  searchCostUsd?: number;
} | null {
  if (!isRecord(result)) return null;
  const raw = result.sources ?? result.candidates;
  if (!Array.isArray(raw)) return null;
  const sources = raw.flatMap((item): RetrievedSource[] => {
    if (!isRecord(item)) return [];
    const url = str(item.url);
    return [
      {
        title: str(item.title) || url,
        url,
        host: str(item.source_host) || hostOf(url),
        published: str(item.published) || undefined,
      },
    ];
  });
  return {
    sources,
    droppedOfflist:
      num(result.dropped_offlist) ?? num(result.dropped_malformed) ?? 0,
    note: str(result.note) || undefined,
    searchCostUsd: num(result.search_cost_usd),
  };
}

export function parseSlot(result: unknown): Slot | null {
  if (!isRecord(result) || !result.slot_id) return null;
  return {
    slot_id: str(result.slot_id),
    lead_id: str(result.lead_id),
    counsellor_id: str(result.counsellor_id),
    starts_at: str(result.starts_at),
    duration_minutes: num(result.duration_minutes) ?? 30,
    created_at: str(result.created_at),
  };
}

export function parseEscalation(
  result: unknown,
): { escalation: Escalation; queued: boolean } | null {
  if (!isRecord(result) || !result.escalation_id) return null;
  return {
    escalation: {
      escalation_id: str(result.escalation_id),
      lead_id: str(result.lead_id),
      trigger: result.trigger as Escalation["trigger"],
      detail: str(result.detail),
      counsellor_id: str(result.counsellor_id) || null,
      created_at: str(result.created_at),
    },
    // `queued: true` means no active counsellor owns that country. The agent
    // does not round-robin to fill the gap, and neither does this UI: the
    // student is told they will be contacted, not that someone is assigned.
    queued: result.queued === true || !result.counsellor_id,
  };
}

/** The short centred line for a write the student should see happen but does
 *  not need a card for. Returns null when the tool warrants no line. */
export function noteFor(
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
): string | null {
  if (isToolError(result)) return null;
  switch (toolName) {
    case "update_lead_facts":
      return `Recorded for your counsellor — ${str(args.key).replace(/_/g, " ")}`;
    case "schedule_followup":
      return `Follow-up scheduled — ${str(args.reason) || str(args.kind).replace(/_/g, " ")}`;
    default:
      return null;
  }
}

/** Tools whose result becomes a card, so the chip row does not also repeat
 *  them as a bare "ok". */
export const CARD_TOOLS = new Set([
  "build_shortlist",
  "book_slot",
  "escalate",
  "research_visa_question",
  "find_unverified_programmes",
]);
