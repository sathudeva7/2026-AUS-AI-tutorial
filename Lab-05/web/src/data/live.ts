/** HTTP against the student agent on :8001.
 *
 * Only the endpoints that exist. `student_agent/main.py` also serves
 * /api/notes, /api/tools, /api/reset and /api/end_session; those are lab
 * instruments, not product, and the console does not call them.
 *
 * Failures throw. CLAUDE.md: "Prefer failing loudly over degrading
 * gracefully." Nothing in this file returns an empty list to paper over a
 * dead backend — the surfaces render an explicit failure card instead.
 */
import { readSse } from "@/lib/sse";
import type { Briefing, Lead } from "./types";

export const AGENT_BASE_URL =
  import.meta.env.VITE_AGENT_URL ?? "http://localhost:8001";

/** Thrown on 401/403 so a surface can send the viewer somewhere useful
 *  rather than rendering "500" at them. */
/** The API's one response shape.
 *
 *   success  { success: true,  data, message?, meta?, request_id }
 *   failure  { success: false, error: { code, message, details? }, request_id }
 *
 * `code` is a stable constant to switch on; `message` is for people. Before
 * this, 401 returned `detail` as a string and 422 returned it as an array,
 * so every caller had to guess which it had this time. */
interface ApiError {
  code: string;
  message: string;
  details?: { field: string; issue: string }[];
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  message?: string;
  meta?: Record<string, unknown>;
  error?: ApiError;
  request_id?: string;
}

export class NotAuthenticatedError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Quote this when reporting a failure — the same id is in the server log. */
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "NotAuthenticatedError";
  }
}

/** How this module gets a Clerk token.
 *
 * `live.ts` is a plain module, so it cannot call `useAuth()`. A component
 * registers Clerk's own `getToken` at startup instead — see AuthBridge in
 * App.tsx. Reaching into `window.Clerk` would work today and break on any
 * internal change; this does not.
 *
 * Default returns null so the student widget, which runs on an agency's site
 * with no Clerk session at all, keeps working. Its endpoints are public.
 */
type TokenProvider = () => Promise<string | null>;

let tokenProvider: TokenProvider = async () => null;

export function setTokenProvider(provider: TokenProvider): void {
  tokenProvider = provider;
}

/** `Authorization` when there is a session, nothing when there is not. */
async function authHeaders(): Promise<Record<string, string>> {
  let token: string | null = null;
  try {
    token = await tokenProvider();
  } catch {
    // Clerk still loading, or signed out. Send the request unauthenticated
    // and let the backend decide — it is the only side that may decide.
  }
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** A validation failure, split per field so the form can annotate its inputs. */
export class FieldValidationError extends Error {
  constructor(
    readonly fields: Record<string, string>,
    message?: string,
    readonly requestId?: string,
  ) {
    super(message ?? Object.values(fields)[0] ?? "Some details need fixing.");
    this.name = "FieldValidationError";
  }
}

/** Anything else the API refused. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

/** Unwrap an envelope, or throw the typed error it describes.
 *
 * One place, so no caller parses an error body again. Before the envelope,
 * 401 returned `detail` as a string and 422 returned it as an array, and each
 * call site had to guess which it had. */
async function unwrap<T>(response: Response, label: string): Promise<T> {
  let body: Envelope<T> | null = null;
  try {
    body = (await response.json()) as Envelope<T>;
  } catch {
    // A non-JSON body — a proxy error page, say. The status still tells us
    // something, so fall through rather than masking it.
  }

  if (response.ok && body?.success) return body.data as T;

  const err = body?.error;
  const rid = body?.request_id;
  const code = err?.code ?? "ERROR";
  const message = err?.message ?? `${label} failed (${response.status}).`;

  if (err?.details?.length) {
    const fields: Record<string, string> = {};
    for (const d of err.details) fields[d.field] = d.issue;
    throw new FieldValidationError(fields, message, rid);
  }
  if (response.status === 401 || response.status === 403) {
    throw new NotAuthenticatedError(response.status, code, message, rid);
  }
  throw new ApiRequestError(response.status, code, message, rid);
}

export class AgentUnreachableError extends Error {
  constructor(cause: unknown) {
    super(
      `Cannot reach the Northbound agent at ${AGENT_BASE_URL}. ` +
        `Start it with: cd Lab-05/student_agent && uvicorn main:app --port 8001`,
    );
    this.name = "AgentUnreachableError";
    this.cause = cause;
  }
}

async function get<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${AGENT_BASE_URL}${path}`, {
      headers: await authHeaders(),
    });
  } catch (cause) {
    throw new AgentUnreachableError(cause);
  }
  return unwrap<T>(response, `GET ${path}`);
}

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
  patch: Partial<
    Omit<
      Tenant,
      "id" | "name" | "active" | "complete" | "phone_country" | "phone_national"
    >
  >,
): Promise<Tenant> {
  let response: Response;
  try {
    response = await fetch(`${AGENT_BASE_URL}/api/tenant`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(patch),
    });
  } catch (cause) {
    throw new AgentUnreachableError(cause);
  }
  return unwrap<Tenant>(response, "PATCH /api/tenant");
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
