/** The embeddable chat panel.
 *
 * CLAUDE.md, Surfaces §1: "Embeddable chat panel on the agency's site. Shows
 * the agent's tool calls as they run." The tool chips are product, not
 * instrumentation — a student watching `check_requirements` run against a
 * named programme is watching the promise that nothing is invented being
 * kept, live.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import { formatDateTimeWithZone, formatTime } from "@/lib/format";
import { triggerLabel } from "@/lib/verdict";
import { ShortlistCard } from "./ShortlistCard";
import type { TimelineItem } from "./timeline";
import { FailureCard } from "@/components/ui/States";
import { cn } from "@/lib/utils";

interface Props {
  items: TimelineItem[];
  running: boolean;
  fatal: unknown;
  onSend: (text: string) => void;
  greeting: string;
  accent: string;
  budgetPerYear?: number;
  intendedIntake?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function ChatPanel({
  items,
  running,
  fatal,
  onSend,
  greeting,
  accent,
  budgetPerYear,
  intendedIntake,
  className,
  style,
}: Props) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, running]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || running) return;
    onSend(draft);
    setDraft("");
  }

  return (
    <div
      className={cn("flex flex-col overflow-hidden rounded-md shadow-lg", className)}
      style={{ background: "var(--color-neutral-100)", ...style }}
    >
      <header
        className="flex items-center gap-[11px] px-[18px] py-[14px]"
        style={{ background: accent, color: "var(--color-neutral-100)" }}
      >
        <div
          className="grid h-[30px] w-[30px] place-items-center rounded-pill font-heading text-sm"
          style={{
            background: "var(--color-accent-200)",
            color: "var(--color-accent-800)",
          }}
          aria-hidden="true"
        >
          N
        </div>
        <div className="leading-tight">
          <div className="font-heading text-[15px]">Northbound Assistant</div>
          {/* Disclosed on the panel itself, not buried in a policy page. */}
          <div className="text-[11px] opacity-90">
            AI assistant · replies immediately
          </div>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="nb-scroll flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-[18px]"
      >
        {items.length === 0 && !fatal ? (
          <Bubble side="start">{greeting}</Bubble>
        ) : null}

        {items.map((item) => (
          <div key={item.id} className="nb-bub flex flex-col gap-[5px]">
            <Item
              item={item}
              budgetPerYear={budgetPerYear}
              intendedIntake={intendedIntake}
            />
          </div>
        ))}

        {fatal ? <FailureCard error={fatal} /> : null}

        {/* The reply region is announced, not the whole log — a student using
            a screen reader should hear the answer, not every tool chip. */}
        <div className="sr-only" aria-live="polite">
          {running ? "The assistant is working." : ""}
        </div>

        {running ? <Typing /> : null}
      </div>

      <form
        onSubmit={submit}
        className="flex items-center gap-[10px] px-[14px] py-[10px]"
        style={{ borderTop: "1px solid var(--color-divider)" }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Write a message…"
          aria-label="Message the assistant"
          disabled={running}
          className="flex-1 rounded-pill border-0 px-[14px] py-[9px] text-[13px] outline-none disabled:opacity-60"
          style={{ background: "var(--color-neutral-200)", color: "var(--color-text)" }}
        />
        <button
          type="submit"
          disabled={running || !draft.trim()}
          aria-label="Send"
          className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-pill disabled:opacity-45"
          style={{ background: accent, color: "var(--color-neutral-100)" }}
        >
          ↑
        </button>
      </form>
    </div>
  );
}

function Item({
  item,
  budgetPerYear,
  intendedIntake,
}: {
  item: TimelineItem;
  budgetPerYear?: number;
  intendedIntake?: string;
}) {
  switch (item.kind) {
    case "student":
      return (
        <>
          <div
            className="max-w-[86%] self-end rounded-[16px] px-[13px] py-[10px] text-[13px] leading-relaxed"
            style={{
              background: "var(--color-accent-700)",
              color: "var(--color-neutral-100)",
            }}
          >
            {item.text}
          </div>
          <Stamp at={item.at} align="end" />
        </>
      );

    case "agent":
      return (
        <>
          <Bubble side="start">
            <div className="[&_p]:m-0 [&_p+p]:mt-2 [&_ul]:my-1 [&_ul]:pl-4 [&_li]:list-disc">
              <Markdown remarkPlugins={[remarkBreaks]}>{item.text}</Markdown>
            </div>
          </Bubble>
          {item.streaming ? null : <Stamp at={item.at} align="start" />}
        </>
      );

    case "tools":
      return (
        <div className="flex flex-wrap gap-1.5 self-start">
          {item.chips.map((chip) => (
            <span
              key={chip.toolUseId}
              className="inline-flex items-center gap-[7px] rounded-pill px-[10px] py-[5px] text-[11px]"
              style={{
                background: chip.isError
                  ? "var(--color-accent-100)"
                  : "var(--color-neutral-200)",
                color: chip.isError
                  ? "var(--color-accent-800)"
                  : "var(--color-neutral-800)",
              }}
              title={chip.resultSummary}
            >
              <span
                className="h-1.5 w-1.5 rounded-pill"
                style={{
                  background: chip.resultSummary
                    ? chip.isError
                      ? "var(--color-accent-600)"
                      : "var(--color-accent-2-600)"
                    : "var(--color-neutral-500)",
                }}
                aria-hidden="true"
              />
              <span className="figure">{chip.name}</span>
              {chip.resultSummary ? (
                <span style={{ color: "var(--color-neutral-600)" }}>
                  {chip.resultSummary}
                </span>
              ) : null}
            </span>
          ))}
        </div>
      );

    case "note":
      return (
        <div
          className="self-center rounded-pill px-3 py-1 text-[11px]"
          style={{
            color: "var(--color-neutral-600)",
            border: "1px solid var(--color-divider)",
          }}
        >
          {item.text}
        </div>
      );

    case "shortlist":
      return (
        <div className="self-stretch">
          <ShortlistCard
            shortlist={item.shortlist}
            checks={item.checks}
            budgetPerYear={budgetPerYear}
            intendedIntake={intendedIntake}
          />
        </div>
      );

    case "citation":
      return (
        <div
          className="max-w-[92%] self-start rounded-md px-[13px] py-[11px] text-[12.5px] leading-relaxed"
          style={{
            background: "var(--color-accent-2-100)",
            border: "1px solid var(--color-accent-2-300)",
            color: "var(--color-accent-2-900)",
          }}
        >
          {/* Tier 2 is the whole point of this card: retrieved from the open
              web, filtered to an allowlist, never catalogue truth. It is
              labelled as such before the student reads a word of it. */}
          <div className="mb-1.5 text-[10px] uppercase tracking-[0.07em]">
            Tier 2 · retrieved, unverified
          </div>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {item.sources.map((source) => (
              <li key={source.url}>
                <a href={source.url} target="_blank" rel="noreferrer noopener">
                  {source.title}
                </a>
                <span style={{ color: "var(--color-accent-2-700)" }}>
                  {" "}
                  — {source.host}
                  {source.published ? ` · ${source.published}` : ""}
                </span>
              </li>
            ))}
          </ul>
          {item.droppedOfflist > 0 ? (
            <div className="mt-2 text-[11px]" style={{ color: "var(--color-accent-2-700)" }}>
              {item.droppedOfflist} result
              {item.droppedOfflist === 1 ? "" : "s"} dropped for being off the
              approved source list.
            </div>
          ) : null}
        </div>
      );

    case "booking":
      return (
        <div
          className="self-stretch rounded-md px-[14px] py-3"
          style={{
            background: "var(--color-accent-2-100)",
            border: "1px solid var(--color-accent-2-300)",
          }}
        >
          <div
            className="font-heading text-[15px]"
            style={{ color: "var(--color-accent-2-800)" }}
          >
            Consultation booked
          </div>
          <div
            className="text-[13px] leading-relaxed"
            style={{ color: "var(--color-accent-2-800)" }}
          >
            {formatDateTimeWithZone(item.slot.starts_at)} ·{" "}
            {item.slot.duration_minutes} minutes. Booking records your consent
            to share this conversation and your shortlist with your counsellor.
          </div>
        </div>
      );

    case "escalation":
      // A handover, not an error. The student is told a person is taking it
      // on — never that something went wrong, and never that nobody is
      // available when the lead has gone to the unassigned queue.
      return (
        <div
          className="self-stretch rounded-md px-[14px] py-3"
          style={{
            background: "var(--color-accent-100)",
            border: "1px solid var(--color-accent-300)",
          }}
        >
          <div
            className="font-heading text-[15px]"
            style={{ color: "var(--color-accent-800)" }}
          >
            A counsellor is taking this from here
          </div>
          <div
            className="text-[13px] leading-relaxed"
            style={{ color: "var(--color-accent-800)" }}
          >
            {triggerLabel(item.escalation.trigger)}.{" "}
            {item.queued
              ? "You will be contacted directly — this has gone to the team rather than to a named counsellor."
              : "It has been passed to the counsellor who covers your destination."}
          </div>
        </div>
      );

    case "failure":
      return (
        <div
          className="self-stretch rounded-md px-[14px] py-3 text-[12.5px]"
          style={{
            background: "var(--color-accent-100)",
            border: "1px solid var(--color-accent-300)",
            color: "var(--color-accent-800)",
          }}
        >
          The assistant could not complete that turn: {item.message}
        </div>
      );
  }
}

function Bubble({
  side,
  children,
}: {
  side: "start" | "end";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "max-w-[86%] rounded-[16px] px-[13px] py-[10px] text-[13px] leading-relaxed",
        side === "start" ? "self-start" : "self-end",
      )}
      style={{ background: "var(--color-neutral-200)" }}
    >
      {children}
    </div>
  );
}

function Stamp({ at, align }: { at: string; align: "start" | "end" }) {
  const label = formatTime(at);
  if (!label) return null;
  return (
    <div
      className={cn("text-[10px]", align === "end" ? "self-end" : "self-start")}
      style={{ color: "var(--color-neutral-600)" }}
    >
      {label}
    </div>
  );
}

function Typing() {
  return (
    <div
      className="flex gap-1 self-start rounded-[16px] px-[14px] py-[11px]"
      style={{ background: "var(--color-neutral-200)" }}
      aria-hidden="true"
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-pulse rounded-pill"
          style={{
            background: "var(--color-neutral-500)",
            animationDelay: `${i * 0.15}s`,
          }}
        />
      ))}
    </div>
  );
}
