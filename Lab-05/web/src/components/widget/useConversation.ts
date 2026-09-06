/** One student conversation, from an empty panel to a booked consultation.
 *
 * Owns three things: the lead this widget is talking as, the SSE turn in
 * flight, and the timeline built from it. Everything it renders comes from a
 * `tool_result` frame or from the agent's own reply text — see timeline.ts
 * for why that separation is load-bearing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { repo } from "@/data/repo";
import { AgentUnreachableError, type AgentEvent } from "@/data/live";
import {
  recordFactQuote,
  recordMessage,
  storeLeadId,
  storedLeadId,
} from "@/data/session";
import type { RequirementCheck } from "@/data/types";
import {
  CARD_TOOLS,
  isToolError,
  noteFor,
  parseChecks,
  parseEscalation,
  parseRetrieval,
  parseShortlist,
  parseSlot,
  type TimelineItem,
  type ToolChip,
} from "./timeline";

let counter = 0;
const nextId = () => `t${++counter}`;

/** A widget visitor is anonymous, but `/api/run` needs a lead to attach the
 *  conversation to and `update_lead_facts` needs one to validate quotes
 *  against. So the first message creates a lead.
 *
 *  The alternative — an intake form asking for a name and email before the
 *  student may type anything — is the friction the product exists to remove:
 *  the agent's whole value is answering at 11pm instead of tomorrow morning.
 *  The identity is a placeholder the counsellor replaces; the conversation is
 *  real from the first word. */
function widgetIdentity() {
  const short = Math.random().toString(36).slice(2, 8);
  return {
    name: `Widget visitor ${short}`,
    email: `widget+${short}@northbound.example`,
  };
}

export interface ConversationState {
  leadId: string | null;
  items: TimelineItem[];
  /** True between send and the `done` frame — drives the typing indicator. */
  running: boolean;
  /** A conversation-level failure: no lead, no backend. Turn-level errors
   *  land in the timeline as a failure item instead. */
  fatal: unknown;
}

export function useConversation(options: { initialLeadId?: string | null }) {
  const [leadId, setLeadId] = useState<string | null>(
    options.initialLeadId ?? storedLeadId(),
  );
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [running, setRunning] = useState(false);
  const [fatal, setFatal] = useState<unknown>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (leadId) storeLeadId(leadId);
  }, [leadId]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const send = useCallback(
    async (text: string) => {
      const prompt = text.trim();
      if (!prompt || running) return;

      const at = new Date().toISOString();
      setItems((prev) => [
        ...prev,
        { id: nextId(), kind: "student", text: prompt, at },
      ]);
      setRunning(true);
      setFatal(null);

      let activeLead = leadId;
      try {
        if (!activeLead) {
          const created = await repo.createLead(widgetIdentity());
          activeLead = created.lead_id;
          setLeadId(created.lead_id);
        }
      } catch (error) {
        setFatal(error);
        setRunning(false);
        return;
      }

      recordMessage({
        lead_id: activeLead,
        role: "student",
        content: prompt,
        timestamp: at,
      });

      // One in-flight turn per conversation. A student who hits enter twice
      // gets the second message queued by the disabled composer, not two
      // concurrent agent runs writing facts over each other.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // Per-turn scratch. `pending` pairs a tool_call with the tool_result
      // that arrives later; `checks` accumulates check_requirements output so
      // a build_shortlist card can show the requirement chips behind each
      // entry, which is the only place those two tools' results meet.
      const pending = new Map<string, { name: string; args: Record<string, unknown> }>();
      const checks: Record<string, RequirementCheck[]> = {};
      let replyId: string | null = null;
      let reply = "";
      let chipRowId: string | null = null;

      const upsertChip = (chip: ToolChip) => {
        setItems((prev) => {
          const next = [...prev];
          const index = next.findIndex((item) => item.id === chipRowId);
          if (index === -1) {
            const row: TimelineItem = {
              id: chipRowId ?? (chipRowId = nextId()),
              kind: "tools",
              chips: [chip],
            };
            return [...next, row];
          }
          const row = next[index];
          if (row.kind !== "tools") return next;
          const chips = [...row.chips];
          const at = chips.findIndex((c) => c.toolUseId === chip.toolUseId);
          if (at === -1) chips.push(chip);
          else chips[at] = { ...chips[at], ...chip };
          next[index] = { ...row, chips };
          return next;
        });
      };

      const append = (item: TimelineItem) =>
        setItems((prev) => [...prev, item]);

      const onEvent = (event: AgentEvent) => {
        switch (event.type) {
          case "tool_call": {
            pending.set(event.tool_use_id, {
              name: event.name,
              args: event.args ?? {},
            });
            if (!chipRowId) chipRowId = nextId();
            upsertChip({
              toolUseId: event.tool_use_id,
              name: event.name,
              argsSummary: event.args_summary,
            });
            break;
          }

          case "tool_result": {
            const call = pending.get(event.tool_use_id);
            if (!call) break;
            upsertChip({
              toolUseId: event.tool_use_id,
              name: call.name,
              argsSummary: "",
              resultSummary: event.result_summary,
              isError: event.is_error,
            });
            handleResult(call.name, call.args, event.result);
            break;
          }

          case "text_delta": {
            reply += event.delta;
            // A new chip row starts after the next tool call, so the reply
            // and the calls that produced it stay in the order they happened.
            chipRowId = null;
            setItems((prev) => {
              const id = replyId ?? (replyId = nextId());
              const index = prev.findIndex((item) => item.id === id);
              const bubble: TimelineItem = {
                id,
                kind: "agent",
                text: reply,
                at: new Date().toISOString(),
                streaming: true,
              };
              if (index === -1) return [...prev, bubble];
              const next = [...prev];
              next[index] = bubble;
              return next;
            });
            break;
          }

          case "done": {
            const finalText = event.final_reply || reply;
            if (finalText) {
              recordMessage({
                lead_id: activeLead,
                role: "agent",
                content: finalText,
                timestamp: new Date().toISOString(),
              });
            }
            setItems((prev) =>
              prev.map((item) =>
                item.id === replyId && item.kind === "agent"
                  ? { ...item, text: finalText, streaming: false }
                  : item,
              ),
            );
            break;
          }

          case "error":
            append({ id: nextId(), kind: "failure", message: event.message });
            break;

          // `plan` and `system_prompt` are the lab's instrumentation. A
          // student widget has no business rendering either.
          default:
            break;
        }
      };

      const handleResult = (
        name: string,
        args: Record<string, unknown>,
        result: unknown,
      ) => {
        if (isToolError(result)) {
          // The chip already shows the error and its remediation. The agent
          // will say what happens next in its own words — a failed tool is
          // not a card, and it is never silently swallowed either.
          return;
        }

        // Fact writes are not audited (see data/session.ts), so the quote is
        // caught here as it goes past or it is gone. Only a write the backend
        // ACCEPTED is kept — a rejected one is the anti-inference guard
        // firing, and storing that quote would preserve exactly the invented
        // fact the guard exists to block.
        if (name === "update_lead_facts") {
          const quote = args.source_quote;
          const key = args.key;
          if (typeof quote === "string" && typeof key === "string") {
            recordFactQuote(activeLead, key, quote);
          }
        }

        if (name === "check_requirements") {
          const parsed = parseChecks(result);
          if (parsed?.programmeId) checks[parsed.programmeId] = parsed.checks;
          return;
        }

        if (name === "build_shortlist") {
          const shortlist = parseShortlist(result);
          if (shortlist) {
            append({
              id: nextId(),
              kind: "shortlist",
              shortlist,
              checks: { ...checks },
            });
            chipRowId = null;
          }
          return;
        }

        if (
          name === "research_visa_question" ||
          name === "find_unverified_programmes"
        ) {
          const parsed = parseRetrieval(result);
          if (parsed && parsed.sources.length) {
            append({ id: nextId(), kind: "citation", ...parsed });
            chipRowId = null;
          }
          return;
        }

        if (name === "book_slot") {
          const slot = parseSlot(result);
          if (slot) {
            append({ id: nextId(), kind: "booking", slot });
            chipRowId = null;
          }
          return;
        }

        if (name === "escalate") {
          const parsed = parseEscalation(result);
          if (parsed) {
            append({ id: nextId(), kind: "escalation", ...parsed });
            chipRowId = null;
          }
          return;
        }

        if (!CARD_TOOLS.has(name)) {
          const note = noteFor(name, args, result);
          if (note) {
            append({ id: nextId(), kind: "note", text: note });
            chipRowId = null;
          }
        }
      };

      try {
        await repo.runAgent({
          leadId: activeLead,
          prompt,
          signal: controller.signal,
          onEvent,
        });
      } catch (error) {
        if (error instanceof AgentUnreachableError) setFatal(error);
        else
          append({
            id: nextId(),
            kind: "failure",
            message: error instanceof Error ? error.message : String(error),
          });
      } finally {
        setRunning(false);
      }
    },
    [leadId, running],
  );

  return { leadId, items, running, fatal, send } satisfies ConversationState & {
    send: (text: string) => Promise<void>;
  };
}
