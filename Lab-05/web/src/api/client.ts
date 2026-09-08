/** The HTTP layer: one place that knows about auth, the envelope and verbs.
 *
 * Extracted from `data/live.ts`, which had grown to hold both this and every
 * endpoint function in the product. Transport is the genuinely shared half;
 * endpoints belong to the feature that owns them.
 *
 * Failures throw. CLAUDE.md: "Prefer failing loudly over degrading
 * gracefully." Nothing here returns an empty list to paper over a dead
 * backend — surfaces render an explicit failure card instead.
 */
import { AGENT_BASE_URL } from "./config";
import {
  AgentUnreachableError,
  ApiRequestError,
  type Envelope,
  FieldValidationError,
  NotAuthenticatedError,
} from "./errors";

/** How this module gets a Clerk token.
 *
 * This is a plain module, so it cannot call `useAuth()`. A component
 * registers Clerk's own `getToken` at startup instead — see AuthBridge in
 * App.tsx. Reaching into `window.Clerk` would work today and break on any
 * internal change; this does not.
 *
 * The token is held only here, in a closure, and re-read per request. It is
 * never written to localStorage or sessionStorage, which any injected script
 * can read.
 *
 * Default returns null so the student widget, which runs on an agency's site
 * with no Clerk session at all, keeps working. Its endpoints are public.
 */
type TokenProvider = () => Promise<string | null>;

let tokenProvider: TokenProvider = async () => null;

export function setTokenProvider(provider: TokenProvider): void {
  tokenProvider = provider;
}

/** `Authorization` when there is a session, nothing when there is not.
 *
 * Exported because the SSE turn builds its own request — a stream is not an
 * envelope and cannot go through `unwrap` — and still needs the same header. */
export async function authHeaders(): Promise<Record<string, string>> {
  let token: string | null = null;
  try {
    token = await tokenProvider();
  } catch {
    // Clerk still loading, or signed out. Send the request unauthenticated
    // and let the backend decide — it is the only side that may decide.
  }
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Unwrap an envelope, or throw the typed error it describes.
 *
 * One place, so no caller parses an error body again. Before the envelope,
 * 401 returned `detail` as a string and 422 returned it as an array, and each
 * call site had to guess which it had.
 *
 * `meta` is dropped here. A caller that needs it — the roster's total, the
 * lead count from a deactivation — uses `requestWithMeta` below.
 */
async function unwrap<T>(response: Response, label: string): Promise<T> {
  return (await unwrapWithMeta<T>(response, label)).data;
}

export interface Result<T> {
  data: T;
  meta?: Record<string, unknown>;
}

async function unwrapWithMeta<T>(
  response: Response,
  label: string,
): Promise<Result<T>> {
  let body: Envelope<T> | null = null;
  try {
    body = (await response.json()) as Envelope<T>;
  } catch {
    // A non-JSON body — a proxy error page, say. The status still tells us
    // something, so fall through rather than masking it.
  }

  if (response.ok && body?.success) {
    return { data: body.data as T, meta: body.meta };
  }

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

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

async function send(
  method: Method,
  path: string,
  body?: unknown,
): Promise<Response> {
  try {
    return await fetch(`${AGENT_BASE_URL}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(await authHeaders()),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (cause) {
    // fetch only rejects when the request never landed: wrong port, backend
    // down, CORS refusing the preflight. An HTTP error status resolves.
    throw new AgentUnreachableError(cause);
  }
}

export async function get<T>(path: string): Promise<T> {
  return unwrap<T>(await send("GET", path), `GET ${path}`);
}

export async function post<T>(path: string, body?: unknown): Promise<T> {
  return unwrap<T>(await send("POST", path, body), `POST ${path}`);
}

export async function put<T>(path: string, body?: unknown): Promise<T> {
  return unwrap<T>(await send("PUT", path, body), `PUT ${path}`);
}

export async function patch<T>(path: string, body?: unknown): Promise<T> {
  return unwrap<T>(await send("PATCH", path, body), `PATCH ${path}`);
}

/** For the handful of endpoints whose `meta` is part of the answer: the
 *  roster's `total`, and how many leads a deactivation moved. */
export async function postWithMeta<T>(
  path: string,
  body?: unknown,
): Promise<Result<T>> {
  return unwrapWithMeta<T>(await send("POST", path, body), `POST ${path}`);
}

export async function getWithMeta<T>(path: string): Promise<Result<T>> {
  return unwrapWithMeta<T>(await send("GET", path), `GET ${path}`);
}
