/** What is on file, and the words it came from.
 *
 * Each fact row expands to the student's own quote. That is not a nicety: the
 * anti-inference guard rejects any fact write whose quote is not in the
 * student's messages, and a counsellor about to act on a fact should be able
 * to see the sentence that guard accepted.
 *
 * The visa panel is screening only. The agent records whether a topic came up
 * and stops — it forms no view and offers no advice, so this panel shows the
 * flag and the handover, never an assessment.
 */
import { useState } from "react";
import { Card, Kicker, StatusChip } from "@/components/ui";
import { triggerLabel } from "@/lib/verdict";
import { buildFactGroups, FACT_STATE_STYLE } from "./facts";
import type { Briefing } from "@/data/types";
import { formatDate } from "@/lib/format";

export function ProfileTab({ briefing }: { briefing: Briefing }) {
  const groups = buildFactGroups(briefing);

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-3">
      {groups.map((group) => (
        <Card key={group.name} className="rounded-md p-4">
          <Kicker>{group.name}</Kicker>
          <div className="flex flex-col gap-2">
            {group.rows.map((row) => (
              <FactRowView key={row.key} row={row} />
            ))}
          </div>
        </Card>
      ))}

      <Card className="rounded-md p-4">
        <Kicker>Visa factors — screening only</Kicker>
        {briefing.escalations.length === 0 ? (
          <p
            className="m-0 text-[12.5px] leading-relaxed"
            style={{ color: "var(--color-neutral-700)" }}
          >
            No escalation triggers have appeared in this conversation. The agent
            screens for them and stops there — it never forms a view on
            someone&apos;s immigration prospects.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {briefing.escalations.map((escalation) => (
              <div key={escalation.escalation_id} className="text-[13px]">
                <div className="flex items-baseline gap-2">
                  <span className="flex-1 font-semibold">
                    {triggerLabel(escalation.trigger)}
                  </span>
                  <StatusChip
                    label="Flagged"
                    background="var(--color-accent-300)"
                    foreground="var(--color-accent-900)"
                  />
                </div>
                <p
                  className="m-0 mt-1 leading-relaxed"
                  style={{ color: "var(--color-neutral-700)" }}
                >
                  {escalation.detail}
                </p>
                <div
                  className="mt-1 text-[11.5px]"
                  style={{ color: "var(--color-neutral-600)" }}
                >
                  {escalation.counsellor_id
                    ? `Routed to ${escalation.counsellor_id}`
                    : "Unassigned queue — no active counsellor owns this country"}
                  {escalation.created_at
                    ? ` · ${formatDate(escalation.created_at)}`
                    : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function FactRowView({
  row,
}: {
  row: ReturnType<typeof buildFactGroups>[number]["rows"][number];
}) {
  const [open, setOpen] = useState(false);
  const style = FACT_STATE_STYLE[row.state];
  const expandable = row.state === "Confirmed";

  return (
    <div>
      <button
        type="button"
        onClick={() => expandable && setOpen((o) => !o)}
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
        className="flex w-full items-baseline gap-[10px] rounded-sm text-left text-[13px] disabled:cursor-default"
      >
        <span
          className="w-[118px] flex-none"
          style={{ color: "var(--color-neutral-600)" }}
        >
          {row.label}
        </span>
        <span className="flex-1">{row.value}</span>
        <span
          className="rounded-pill px-[9px] py-[2px] text-[9.5px] uppercase tracking-[0.05em]"
          style={{ background: style.background, color: style.foreground }}
        >
          {row.state}
        </span>
      </button>

      {open ? (
        <div
          className="ml-[128px] mt-1.5 rounded-sm px-[10px] py-2 text-[12px] leading-relaxed"
          style={{
            background: "var(--color-neutral-100)",
            border: "1px solid var(--color-divider)",
          }}
        >
          {row.quote ? (
            <>
              <span style={{ color: "var(--color-neutral-700)" }}>
                Their words:
              </span>{" "}
              <q>{row.quote}</q>
              <div
                className="mt-1 text-[11px]"
                style={{ color: "var(--color-neutral-600)" }}
              >
                {row.quoteSource === "audit trail"
                  ? "Recovered from the audit trail."
                  : row.quoteSource === "this session"
                    ? "Captured from the conversation in this browser session."
                    : "From the seed record."}
              </div>
            </>
          ) : (
            <span style={{ color: "var(--color-neutral-700)" }}>
              The quote is not recoverable here. The backend validated one when
              it accepted this fact — it rejects any write whose words are not
              in the student&apos;s messages — but fact writes are not written
              to the audit trail, so the sentence is not readable back after
              the conversation. The fact is shown as recorded, not as
              evidenced.
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}
