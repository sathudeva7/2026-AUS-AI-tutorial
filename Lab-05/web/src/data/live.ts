/** Endpoints that have no feature folder yet.
 *
 * The transport moved to `@/api/client` and the error types to `@/api/errors`.
 * What is left here is leads, tenant and the agent turn — each moves into its
 * own `features/<name>/api.ts` the day it is next worked on. Users has already
 * gone; see `features/users/api.ts`.
 *
 * The re-exports below keep existing importers working. They are a migration
 * aid, not an interface: new code imports from `@/api/*` directly.
 */
import { readSse } from "@/lib/sse";
import { AGENT_BASE_URL } from "@/api/config";
import { authHeaders, get, patch } from "@/api/client";
import { AgentUnreachableError } from "@/api/errors";
import type { Briefing, Lead } from "./types";

export { AGENT_BASE_URL } from "@/api/config";
export { setTokenProvider } from "@/api/client";
export {
  AgentUnreachableError,
  ApiRequestError,
  FieldValidationError,
  NotAuthenticatedError,
} from "@/api/errors";

/** `GET /api/me` — the caller, their agency, and everything they may do.
 *
 * Also what provisions a brand-new agency: Clerk creates the organization in
 * the browser, so this is the first time the backend hears of it. Call it
 * before anything that needs a tenant to exist. */
export async function fetchMe(): Promise<{
  tenant_id: string;
  user_id: string;
  role: string;
  permissions: string[];
}> {
  return get("/api/me");
}

export interface Tenant {
  id: string;
  name: string;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
  default_timezone: string;
  active: boolean;
  /** Resolved by libphonenumber on the server, not guessed from the dialling
   *  code: +44 is shared by Guernsey, Jersey, the Isle of Man and the UK, and
   *  +1 by twenty-five countries, so a prefix match picks the wrong one. */
  phone_country: string | null;
  phone_national: string | null;
  /** Phone plus a usable address. Drives the "finish setting up" prompt. */
  complete: boolean;
}

/** `GET /api/tenant` — the agency record. Any member may read it. */
export async function fetchTenant(): Promise<Tenant> {
  return get("/api/tenant");
}

/** `PATCH /api/tenant` — owner-only; the backend enforces that, not the UI.
 *
 * Only the fields passed are written, so a partial form cannot blank the rest
 * by omission. `name` is deliberately not accepted: it is a cache of Clerk's
 * organization name, and writing it here would drift until the next sync.
 */
export async function patchTenant(
  patchBody: Partial<
    Omit<
      Tenant,
      "id" | "name" | "active" | "complete" | "phone_country" | "phone_national"
    >
  >,
): Promise<Tenant> {
  return patch<Tenant>("/api/tenant", patchBody);
}

/** `GET /api/leads` — the lead book. `missing` is what nobody has asked yet. */
export async function fetchLeads(): Promise<Lead[]> {
  const body = await get<{ leads?: Lead[] }>("/api/leads");
  return body.leads ?? [];
}

/** `GET /api/briefing` — facts, escalations, follow-ups, slots and the full
 *  tool-call audit trail for one lead. */
export async function fetchBriefing(leadId: string): Promise<Briefing> {
  const body = await get<Briefing & { error?: string }>(
    `/api/briefing?lead_id=${encodeURIComponent(leadId)}`,
  );
  if ("error" in body && body.error) {
    throw new Error(`No lead ${leadId}: ${body.error}`);
  }
  return body;
}

/** `POST /api/leads` — first contact.
 *
 *  The backend de-duplicates by email and hands back the EXISTING lead on a
 *  match, so `created: false` means this conversation is resuming a record
 *  that may already carry facts. Callers must not treat the two the same. */
export async function createLead(input: {
  name: string;
  email: string;
  country_of_residence?: string;
}): Promise<Lead & { created: boolean }> {
  let response: Response;
  try {
    response = await fetch(`${AGENT_BASE_URL}/api/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(input),
    });
  } catch (cause) {
    throw new AgentUnreachableError(cause);
  }
  if (!response.ok) {
    let detail = String(response.status);
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      // Non-JSON error body; the status code is all we have.
    }
    throw new Error(detail);
  }
  return (await response.json()) as Lead & { created: boolean };
}

// ---------------------------------------------------------------------------
// The agent turn
// ---------------------------------------------------------------------------

/** SSE events from `_run_agent_stream` in student_agent/main.py.
 *
 *  `plan` and `system_prompt` are emitted but the product UI ignores them —
 *  they are the lab's instrumentation, and a student widget has no business
 *  rendering the system prompt. */
export type AgentEvent =
  | { type: "user_message"; content: string }
  | { type: "text_delta"; delta: string }
  | {
      type: "tool_call";
      tool_use_id: string;
      name: string;
      args: Record<string, unknown>;
      args_summary: string;
    }
  | {
      type: "tool_result";
      tool_use_id: string;
      result: unknown;
      result_summary: string;
      is_error: boolean;
    }
  | { type: "done"; final_reply: string }
  | { type: "error"; message: string }
  | { type: "plan"; content: string }
  | { type: "system_prompt"; content: string };

/** `POST /api/run` — one turn, streamed.
 *
 *  The backend records the student's message BEFORE invoking the agent, so
 *  `update_lead_facts` can validate each `source_quote` against it. That is
 *  why there is no separate "save message" call here. */
export async function runAgent(args: {
  leadId: string;
  prompt: string;
  signal?: AbortSignal;
  onEvent: (event: AgentEvent) => void;
}): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${AGENT_BASE_URL}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ prompt: args.prompt, lead_id: args.leadId }),
      signal: args.signal,
    });
  } catch (cause) {
    if (args.signal?.aborted) return;
    throw new AgentUnreachableError(cause);
  }
  if (!response.ok) {
    throw new Error(`POST /api/run returned ${response.status}`);
  }
  await readSse(response, (frame) => {
    args.onEvent({
      ...(frame.data as object),
      type: frame.event,
    } as AgentEvent);
  });
}
