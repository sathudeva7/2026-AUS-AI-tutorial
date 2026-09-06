/** The counsellor's read-only assistant.
 *
 * The counsellor agent is a separate service with its own tool set —
 * `list_leads`, `get_lead_briefing`, `get_lead_timeline`,
 * `get_unassigned_queue`, all read-only — and it is not running in this lab.
 *
 * So this surface answers the three questions it has real answers for and
 * says "not connected" to everything else. That refusal is the design, not a
 * placeholder: an assistant that improvised an answer about a named
 * student's file would be worse than one that admits it is offline, and it
 * would break the rule the whole system rests on — the agent may not state a
 * fact that did not come back from a tool.
 */
import { useState, type FormEvent } from "react";
import { Button, Card, Input, Tag } from "@/components/ui";
import { repo, type AssistantAnswer } from "@/data/repo";
import { verdictStyle } from "@/lib/verdict";

type Result =
  | { kind: "answer"; answer: AssistantAnswer }
  | { kind: "unconnected"; question: string };

export function AssistantRoute() {
  const suggested = repo.suggestedQuestions();
  const [draft, setDraft] = useState(suggested[0]?.question ?? "");
  const [result, setResult] = useState<Result>({
    kind: "answer",
    answer: suggested[0],
  });

  async function ask(question: string) {
    setDraft(question);
    const answer = await repo.ask(question);
    setResult(
      answer ? { kind: "answer", answer } : { kind: "unconnected", question },
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void ask(draft);
  }

  return (
    <div className="max-w-[920px] px-8 pb-12 pt-[34px]">
      <h2 className="m-0 text-[32px]">Ask about your leads</h2>
      <p
        className="max-w-[64ch] text-sm"
        style={{ color: "var(--color-neutral-700)" }}
      >
        Scoped to this tenant. Read-only — the assistant cannot write to a
        student record or send a message, and every query it can answer is
        answered from stored tool results rather than recomputed.
      </p>

      <form onSubmit={submit} className="my-[22px] flex items-center gap-[10px]">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Ask about your leads"
          className="flex-1"
        />
        <Button variant="primary" type="submit">
          Ask
        </Button>
      </form>

      <div className="mb-[26px] flex flex-wrap gap-2">
        {suggested.map((item) => {
          const selected =
            result.kind === "answer" && result.answer.id === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => void ask(item.question)}
              aria-pressed={selected}
              className="cursor-pointer rounded-pill border px-[14px] py-[7px] font-body text-[12.5px]"
              style={{
                background: selected
                  ? "var(--color-neutral-900)"
                  : "var(--color-neutral-100)",
                color: selected
                  ? "var(--color-neutral-100)"
                  : "var(--color-text)",
                borderColor: "var(--color-divider)",
              }}
            >
              {item.question}
            </button>
          );
        })}
      </div>

      {result.kind === "answer" ? (
        <AnswerCard answer={result.answer} />
      ) : (
        <NotConnected question={result.question} />
      )}
    </div>
  );
}

function AnswerCard({ answer }: { answer: AssistantAnswer }) {
  return (
    <Card className="rounded-md p-5">
      <div className="mb-3 flex items-center gap-[9px]">
        <span className="font-heading text-[16px]">{answer.title}</span>
        <Tag tone="outline" className="text-[10px]">
          {answer.tier}
        </Tag>
      </div>
      <p
        className="m-0 mb-3.5 max-w-[74ch] text-sm leading-relaxed"
        style={{ textWrap: "pretty" } as React.CSSProperties}
      >
        {answer.body}
      </p>
      <div className="flex flex-col gap-2">
        {answer.rows.map((row) => {
          const style = row.verdict ? verdictStyle(row.verdict) : null;
          return (
            <div
              key={row.key}
              className="flex items-baseline gap-3 rounded-md px-3.5 py-[11px]"
              style={{ background: "var(--color-neutral-100)" }}
            >
              <span className="w-[180px] flex-none text-[13px] font-semibold">
                {row.key}
              </span>
              <span
                className="flex-1 text-[13px]"
                style={{ color: "var(--color-neutral-800)" }}
              >
                {row.value}
              </span>
              <span
                className="rounded-pill px-[9px] py-[3px] text-[10.5px]"
                style={
                  style
                    ? { background: style.background, color: style.foreground }
                    : {
                        background: "var(--color-neutral-300)",
                        color: "var(--color-neutral-900)",
                      }
                }
              >
                {style ? style.label : row.status}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function NotConnected({ question }: { question: string }) {
  return (
    <Card
      className="max-w-[74ch] rounded-md p-5"
      style={{
        background: "var(--color-accent-100)",
        border: "1px solid var(--color-accent-300)",
      }}
    >
      <div
        className="font-heading text-[16px]"
        style={{ color: "var(--color-accent-800)" }}
      >
        The assistant is not connected
      </div>
      <p
        className="m-0 text-[13px] leading-relaxed"
        style={{ color: "var(--color-accent-800)" }}
      >
        The counsellor agent is a separate read-only service and it is not
        running, so there is nothing to answer{" "}
        <q>{question}</q> from. Rather than compose something plausible about a
        real student&apos;s file, this surface stops here. The suggested
        questions above are answered from stored evaluations and still work.
      </p>
    </Card>
  );
}
