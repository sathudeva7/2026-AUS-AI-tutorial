/** The conversation, as it happened.
 *
 * The backend persists every message but exposes no endpoint to read them
 * back, so there are two sources and the tab always says which one it is
 * showing. A fixture must never pass as a recorded conversation — a
 * counsellor quoting an illustrative line back to a student in a call would
 * be a genuine harm, and it is exactly the kind of thing an unlabelled
 * placeholder causes.
 */
import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { EmptyNote } from "@/components/ui/States";
import { repo, type Transcript } from "@/data/repo";
import { formatTime } from "@/lib/format";

export function TranscriptTab({ leadId }: { leadId: string }) {
  const [transcript, setTranscript] = useState<Transcript | null>(null);

  useEffect(() => {
    let cancelled = false;
    void repo.getTranscript(leadId).then((t) => {
      if (!cancelled) setTranscript(t);
    });
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  if (!transcript) return null;

  if (!transcript.messages.length) {
    return (
      <EmptyNote>
        No conversation is on record for this lead. Messages are written as the
        agent runs — open this lead in the student widget
        (<code>/widget?lead_id={leadId}</code>) and the exchange appears here.
      </EmptyNote>
    );
  }

  return (
    <div className="flex max-w-[800px] flex-col gap-2">
      <ProvenanceLine live={transcript.live} />
      <Card className="rounded-md p-[18px]">
        <div className="flex flex-col gap-3">
          {transcript.messages.map((message, index) => {
            const isAgent = message.role === "agent";
            return (
              <div key={index} className="flex gap-3">
                <span
                  className="figure w-12 flex-none pt-[13px] text-[11px]"
                  style={{ color: "var(--color-neutral-600)" }}
                >
                  {formatTime(message.timestamp)}
                </span>
                <div className="flex-1">
                  <div
                    className="text-[10.5px] uppercase tracking-[0.06em]"
                    style={{
                      color: isAgent
                        ? "var(--color-accent-700)"
                        : "var(--color-accent-2-700)",
                    }}
                  >
                    {isAgent ? "Agent" : "Student"}
                  </div>
                  <div
                    className="rounded-[14px] px-[13px] py-[10px] text-[13.5px] leading-relaxed"
                    style={{
                      background: isAgent
                        ? "var(--color-neutral-200)"
                        : "var(--color-accent-2-100)",
                    }}
                  >
                    {message.content}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function ProvenanceLine({ live }: { live: boolean }) {
  return (
    <div
      className="flex items-center gap-2 text-[12.5px]"
      style={{ color: "var(--color-neutral-700)" }}
    >
      <span
        className="rounded-pill px-[9px] py-[3px] text-[10.5px]"
        style={
          live
            ? {
                background: "var(--color-accent-2-200)",
                color: "var(--color-accent-2-800)",
              }
            : {
                background: "var(--color-neutral-300)",
                color: "var(--color-neutral-900)",
              }
        }
      >
        {live ? "Recorded" : "Illustrative"}
      </span>
      <span>
        {live
          ? "The real exchange, captured as the agent ran in this browser session."
          : "A seed lead. This exchange illustrates the file — it is not a recorded conversation, and it is not what the student was told."}
      </span>
    </div>
  );
}
