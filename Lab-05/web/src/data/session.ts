/** What this browser session has said to the agent.
 *
 * The backend persists every message (`CLIENT.append_message` around each
 * turn), but exposes no endpoint to read them back, so the dashboard would
 * otherwise have no way to show a conversation that just happened in the
 * widget one surface away. This keeps a copy as the widget streams, keyed by
 * lead, so the Transcript tab can show the real exchange rather than a
 * fixture.
 *
 * It is a session-scoped mirror, not a store of record. `sessionStorage`
 * means it dies with the tab, which is correct: the record of truth is on the
 * backend, and anything that outlived the tab here would start drifting from
 * it. Reads and writes are wrapped — a browser with site data blocked throws
 * on access, and the widget must still work.
 */
import type { Message } from "./types";

const MESSAGES_KEY = "northbound.session.messages";
const LEAD_KEY = "northbound.session.lead_id";

type Store = Record<string, Message[]>;

function read(): Store {
  try {
    const raw = sessionStorage.getItem(MESSAGES_KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

function write(store: Store): void {
  try {
    sessionStorage.setItem(MESSAGES_KEY, JSON.stringify(store));
  } catch {
    // Private window, blocked site data, or quota. The widget keeps working
    // from React state; only the dashboard's live transcript is lost.
  }
}

export function recordMessage(message: Message): void {
  const store = read();
  const existing = store[message.lead_id] ?? [];
  store[message.lead_id] = [...existing, message];
  write(store);
}

export function sessionTranscript(leadId: string): Message[] {
  return read()[leadId] ?? [];
}

/** Lead ids this session has talked to, so the dashboard can mark them. */
export function sessionLeadIds(): string[] {
  return Object.keys(read());
}

// ---------------------------------------------------------------------------
// Fact quotes
// ---------------------------------------------------------------------------

/** The words behind a fact, captured off the wire.
 *
 * `update_lead_facts` is an in-process Strands tool (student_agent/agent/
 * facts.py), not an MCP one, so it never passes through the `@audited`
 * decorator that writes a `ToolCall` row — verified against a live turn:
 * seven successful fact writes produced zero audit rows. The quote therefore
 * cannot be recovered from `/api/briefing` the way an MCP tool's arguments
 * can.
 *
 * It IS on the SSE stream, in the `tool_call` frame's args, so the widget
 * catches it as it goes past and keeps it here. That covers any lead this
 * browser session actually talked to. Seed leads fall back to
 * fixtures/seedQuotes.ts, and anything else honestly reports that it has no
 * quote rather than inventing one.
 *
 * The real fix is upstream — auditing fact writes, so a counsellor opening a
 * lead in six weeks can still see the sentence a fact came from. Until then
 * this is a session-scoped mirror and the UI says so.
 */
const QUOTES_KEY = "northbound.session.quotes";

type QuoteStore = Record<string, Record<string, string>>;

export function recordFactQuote(
  leadId: string,
  key: string,
  sourceQuote: string,
): void {
  try {
    const raw = sessionStorage.getItem(QUOTES_KEY);
    const store: QuoteStore = raw ? (JSON.parse(raw) as QuoteStore) : {};
    store[leadId] = { ...(store[leadId] ?? {}), [key]: sourceQuote };
    sessionStorage.setItem(QUOTES_KEY, JSON.stringify(store));
  } catch {
    // Blocked site data. The fact still shows; only its quote is lost.
  }
}

export function sessionQuotes(leadId: string): Record<string, string> {
  try {
    const raw = sessionStorage.getItem(QUOTES_KEY);
    const store: QuoteStore = raw ? (JSON.parse(raw) as QuoteStore) : {};
    return store[leadId] ?? {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// The widget's own lead
// ---------------------------------------------------------------------------

export function storedLeadId(): string | null {
  try {
    return sessionStorage.getItem(LEAD_KEY);
  } catch {
    return null;
  }
}

export function storeLeadId(leadId: string): void {
  try {
    sessionStorage.setItem(LEAD_KEY, leadId);
  } catch {
    // See above — the widget falls back to React state for this tab.
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(LEAD_KEY);
    sessionStorage.removeItem(MESSAGES_KEY);
    sessionStorage.removeItem(QUOTES_KEY);
  } catch {
    /* nothing to clear */
  }
}
