/** Every way a request can fail, as types a surface can branch on.
 *
 * Moved out of `data/live.ts` unchanged. The point of having four classes
 * rather than one is that the caller's response differs: a field error
 * annotates inputs, a 401 sends the viewer to sign in, an unreachable agent
 * is a "start the backend" card, and anything else is a failure notice.
 */
import { AGENT_BASE_URL } from "./config";

/** The API's one response shape.
 *
 *   success  { success: true,  data, message?, meta?, request_id }
 *   failure  { success: false, error: { code, message, details? }, request_id }
 *
 * `code` is a stable constant to switch on; `message` is for people. Before
 * this, 401 returned `detail` as a string and 422 returned it as an array,
 * so every caller had to guess which it had this time.
 */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: { field: string; issue: string }[];
}

export interface Envelope<T> {
  success: boolean;
  data?: T;
  message?: string;
  meta?: Record<string, unknown>;
  error?: ApiErrorBody;
  request_id?: string;
}

/** Thrown on 401/403 so a surface can send the viewer somewhere useful
 *  rather than rendering "500" at them. */
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

/** A validation failure, split per field so the form can annotate its inputs.
 *
 *  The backend sends `details: [{field, issue}]` with dotted paths for nested
 *  bodies — "rules.0.end_time" — so a form can find the exact input. */
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

/** The fetch itself never landed — wrong port, backend not running, CORS. */
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
