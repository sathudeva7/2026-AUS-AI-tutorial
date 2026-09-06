/** The pre-meeting briefing.
 *
 * Composed here, from the record — facts on file, what is still missing, what
 * escalated, what is scheduled, what the agent actually did. It is not an LLM
 * summary, and it does not editorialise about the student's prospects.
 *
 * It still carries a "Generated · unverified" tag, and that tag is not
 * optional. A counsellor reading five paragraphs before a call needs to know
 * which of them a person wrote.
 */
import { Card, Tag } from "@/components/ui";
import { formatDate, formatDateTimeWithZone, humanise } from "@/lib/format";
import { triggerLabel } from "@/lib/verdict";
import { FACT_LABELS, type Briefing } from "@/data/types";
import { profileCompleteness } from "./facts";

interface Section {
  heading: string;
  body: string;
}

function buildSections(briefing: Briefing): Section[] {
  const sections: Section[] = [];
  const complete = profileCompleteness(briefing);

  const wants = [
    briefing.facts.field_of_study,
    briefing.facts.target_country,
    briefing.facts.intended_intake,
  ].filter(Boolean);

  sections.push({
    heading: "Where this stands",
    body: wants.length
      ? `${wants.join(", ")}. Profile ${complete}% complete — ${
          Object.keys(briefing.facts).length
        } of seven facts on file.`
      : "Nothing has been stated yet. The conversation has not reached a destination or a field, and no matching has run.",
  });

  if (briefing.missing.length) {
    sections.push({
      heading: "Still to ask",
      body:
        `${briefing.missing.map((k) => FACT_LABELS[k]).join(", ")}. ` +
        "These are unasked, not unknown — the agent records absence rather than filling the gap, so each one is a question rather than a guess.",
    });
  }

  for (const escalation of briefing.escalations) {
    sections.push({
      heading: "Why this is with you",
      body:
        `${triggerLabel(escalation.trigger)}. ${escalation.detail} ` +
        (escalation.counsellor_id
          ? "Routed to you by destination ownership."
          : "No active counsellor owns this destination, so it sits in the unassigned queue rather than being handed to someone who does not cover it."),
    });
  }

  const undecided = briefing.tool_calls.filter(
    (call) =>
      call.tool === "check_requirements" &&
      call.ok &&
      (call.result as { verdict?: string } | null)?.verdict === "indeterminate",
  );
  if (undecided.length) {
    sections.push({
      heading: "Unresolved",
      body: `${undecided.length} eligibility check${
        undecided.length === 1 ? "" : "s"
      } came back INDETERMINATE — held open pending a document rather than failed. Each one names the paperwork that settles it, and each is usually a two-minute unblock at the top of the call.`,
    });
  }

  if (briefing.followups.length) {
    sections.push({
      heading: "Scheduled",
      body: briefing.followups
        .map(
          (f) =>
            `${humanise(f.kind)} due ${formatDate(f.due_at)} — ${f.reason} (${f.status})`,
        )
        .join(". "),
    });
  }

  if (briefing.slots.length) {
    sections.push({
      heading: "Booked",
      body: briefing.slots
        .map(
          (s) =>
            `${formatDateTimeWithZone(s.starts_at)}, ${s.duration_minutes} minutes with ${s.counsellor_id}.`,
        )
        .join(" "),
    });
  }

  sections.push({
    heading: "What the agent did",
    body: briefing.tool_calls.length
      ? `${briefing.tool_calls.length} tool call${
          briefing.tool_calls.length === 1 ? "" : "s"
        } are on record for this lead. Every figure the student was shown came from one of them; the Shortlist tab is rebuilt from that trail rather than from a stored copy.`
      : "No tool calls are on record. Nothing has been asserted to this student.",
  });

  return sections;
}

export function BriefingTab({ briefing }: { briefing: Briefing }) {
  const sections = buildSections(briefing);

  return (
    <Card className="max-w-[880px] rounded-md p-5">
      <div className="mb-3 flex items-center gap-[10px]">
        <span className="font-heading text-[18px]">Pre-meeting briefing</span>
        <Tag tone="outline" className="text-[10px]">
          Generated · unverified
        </Tag>
      </div>
      <div className="flex flex-col gap-[14px]">
        {sections.map((section) => (
          <div key={section.heading}>
            <div
              className="text-[11px] uppercase tracking-[0.07em]"
              style={{ color: "var(--color-accent-700)" }}
            >
              {section.heading}
            </div>
            <p
              className="m-0 max-w-[78ch] text-sm leading-relaxed"
              style={{ textWrap: "pretty" } as React.CSSProperties}
            >
              {section.body}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}
