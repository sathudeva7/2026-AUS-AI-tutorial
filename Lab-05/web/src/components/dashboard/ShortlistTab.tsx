/** The shortlist, rebuilt from the record.
 *
 * Nothing stores a shortlist. This reads `briefing.tool_calls`, finds the
 * `build_shortlist` rows, and reconstructs what the student was shown — which
 * is CLAUDE.md's "Everything is reconstructable. Every agent decision must be
 * replayable from ToolCall + Message alone" being exercised rather than
 * asserted.
 *
 * It also means revisions come free. A second `build_shortlist` call is a
 * second revision, the earlier one is still on record, and a counsellor can
 * see that a shortlist changed shape after a fact was corrected.
 */
import { EmptyNote } from "@/components/ui/States";
import { ShortlistCard } from "@/components/widget/ShortlistCard";
import { formatTime, numericFact } from "@/lib/format";
import { parseChecks, parseShortlist } from "@/components/widget/timeline";
import type { Briefing, RequirementCheck } from "@/data/types";

export function ShortlistTab({ briefing }: { briefing: Briefing }) {
  const revisions = briefing.tool_calls
    .filter((call) => call.tool === "build_shortlist" && call.ok)
    .map((call) => ({
      shortlist: parseShortlist(call.result),
      at: call.timestamp,
    }))
    .filter((r): r is { shortlist: NonNullable<typeof r.shortlist>; at: string } =>
      Boolean(r.shortlist),
    );

  // Checks recorded at any point for this lead, newest write winning. A
  // check that ran before the latest shortlist still explains its entry.
  const checks: Record<string, RequirementCheck[]> = {};
  for (const call of briefing.tool_calls) {
    if (call.tool !== "check_requirements" || !call.ok) continue;
    const parsed = parseChecks(call.result);
    if (parsed?.programmeId) checks[parsed.programmeId] = parsed.checks;
  }

  const budget = numericFact(briefing.facts.budget_per_year);
  const intake = briefing.facts.intended_intake;
  const intendedIntake = typeof intake === "string" ? intake : undefined;

  if (!revisions.length) {
    return (
      <EmptyNote>
        No shortlist has been built for this lead. `build_shortlist` is the only
        way programmes are presented, so nothing has been shown to this student
        — there is no informal list sitting in the conversation.
      </EmptyNote>
    );
  }

  const current = revisions[revisions.length - 1];
  const superseded = revisions.slice(0, -1);

  return (
    <div className="flex max-w-[920px] flex-col gap-3">
      <div
        className="flex items-center gap-[10px] text-[12.5px]"
        style={{ color: "var(--color-neutral-700)" }}
      >
        <span
          className="rounded-pill px-[10px] py-[3px] text-[10.5px]"
          style={{
            background: "var(--color-neutral-300)",
            color: "var(--color-neutral-900)",
          }}
        >
          Revision {revisions.length}
        </span>
        <span>
          {superseded.length === 0
            ? "The first and only shortlist built for this lead."
            : `Revision ${superseded.length} superseded at ${formatTime(
                current.at,
              )}. Every revision is retained — a shortlist built on an earlier fact stays intact.`}
        </span>
      </div>

      <ShortlistCard
        shortlist={current.shortlist}
        checks={checks}
        budgetPerYear={budget}
        intendedIntake={intendedIntake}
        variant="page"
      />

      {superseded.length ? (
        <details className="mt-2">
          <summary
            className="cursor-pointer text-[12.5px]"
            style={{ color: "var(--color-neutral-700)" }}
          >
            {superseded.length} superseded revision
            {superseded.length === 1 ? "" : "s"}
          </summary>
          <div className="mt-3 flex flex-col gap-4">
            {superseded.map((revision, index) => (
              <div key={revision.at || index}>
                <div
                  className="mb-1.5 text-[11.5px]"
                  style={{ color: "var(--color-neutral-600)" }}
                >
                  Revision {index + 1} · built {formatTime(revision.at)}
                </div>
                <ShortlistCard
                  shortlist={revision.shortlist}
                  checks={checks}
                  budgetPerYear={budget}
                  intendedIntake={intendedIntake}
                  variant="page"
                />
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
