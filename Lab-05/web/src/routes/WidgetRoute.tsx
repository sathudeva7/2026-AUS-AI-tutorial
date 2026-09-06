/** The student widget, on a simulated agency site.
 *
 * The site around it is scenery — it exists so the panel is seen the way a
 * student meets it, at 11pm on a marketing page with the office closed. The
 * panel is the product, and it is the only surface in this console where the
 * agent actually runs.
 *
 * `?lead_id=` resumes an existing lead instead of creating a new one, which
 * is how you point the widget at a seeded student mid-conversation.
 */
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChatPanel } from "@/components/widget/ChatPanel";
import { useConversation } from "@/components/widget/useConversation";
import { repo } from "@/data/repo";
import { TENANT } from "@/data/fixtures/tenant";
import { numericFact } from "@/lib/format";
import { Tag } from "@/components/ui";

export function WidgetRoute() {
  const [params] = useSearchParams();
  const initialLeadId = params.get("lead_id");
  const { leadId, items, running, fatal, send } = useConversation({
    initialLeadId,
  });

  // The lead's stated tuition ceiling separates a Strong match from a
  // Stretch. Read from the lead book rather than guessed — with no budget on
  // file nothing is called a stretch.
  const [budget, setBudget] = useState<number | undefined>(undefined);
  const [intake, setIntake] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!leadId) return;
    let cancelled = false;
    void repo
      .getBriefing(leadId)
      .then((briefing) => {
        if (cancelled) return;
        setBudget(numericFact(briefing.facts.budget_per_year));
        const stated = briefing.facts.intended_intake;
        setIntake(typeof stated === "string" ? stated : undefined);
      })
      .catch(() => {
        // The widget does not fall over because a side lookup failed; it just
        // stops distinguishing stretch from strong until the next turn.
      });
    return () => {
      cancelled = true;
    };
  }, [leadId, items.length]);

  const now = useMemo(
    () =>
      new Intl.DateTimeFormat("en-GB", {
        weekday: "long",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(new Date()),
    [],
  );

  return (
    <div className="flex min-h-full flex-col">
      <div className="px-[26px] pt-4">
        <BrowserChrome url="northbound.example/study-in-the-uk" clock={now} />
      </div>

      <div
        className="relative mx-[26px] flex-1"
        style={{
          border: "1px solid var(--color-divider)",
          borderTop: "none",
          borderRadius: "0 0 var(--radius-md) var(--radius-md)",
          background: "var(--color-neutral-100)",
        }}
      >
        <SiteHeader />
        <Hero />

        {/* Anchored bottom-right on a wide viewport, exactly as an embedded
            widget sits; below 900px it becomes the whole column, because a
            452px panel floating over a phone is not a design, it is a bug. */}
        <div className="px-6 pb-6 lg:absolute lg:bottom-[26px] lg:right-[34px] lg:px-0 lg:pb-0">
          <ChatPanel
            items={items}
            running={running}
            fatal={fatal}
            onSend={(text) => void send(text)}
            greeting={TENANT.widget.greeting}
            accent={TENANT.widget.accent}
            budgetPerYear={budget}
            intendedIntake={intake}
            className="h-[632px] w-full lg:w-[452px]"
          />
        </div>
      </div>
    </div>
  );
}

function BrowserChrome({ url, clock }: { url: string; clock: string }) {
  return (
    <div
      className="flex items-center gap-[10px] px-[14px] py-2"
      style={{
        background: "var(--color-neutral-200)",
        borderRadius: "var(--radius-md) var(--radius-md) 0 0",
        border: "1px solid var(--color-divider)",
        borderBottom: "none",
      }}
      aria-hidden="true"
    >
      <span
        className="h-[9px] w-[9px] rounded-pill"
        style={{ background: "var(--color-accent-400)" }}
      />
      <span
        className="h-[9px] w-[9px] rounded-pill"
        style={{ background: "var(--color-accent-2-400)" }}
      />
      <span
        className="h-[9px] w-[9px] rounded-pill"
        style={{ background: "var(--color-neutral-400)" }}
      />
      <span
        className="ml-[10px] rounded-pill px-3 py-0.5 text-[11.5px]"
        style={{
          background: "var(--color-neutral-100)",
          color: "var(--color-neutral-700)",
        }}
      >
        {url}
      </span>
      <span
        className="ml-auto text-[11.5px]"
        style={{ color: "var(--color-neutral-600)" }}
      >
        {clock} · office closed
      </span>
    </div>
  );
}

function SiteHeader() {
  return (
    <div className="flex flex-wrap items-center gap-[10px] px-10 py-[22px]">
      <div
        className="h-[30px] w-[30px] rounded-pill"
        style={{ background: "var(--color-accent-300)" }}
        aria-hidden="true"
      />
      <span className="font-heading text-[18px]">Northbound Education</span>
      <nav
        className="ml-auto flex min-w-0 flex-wrap gap-x-6 gap-y-2.5 text-sm"
        aria-label="Agency site"
      >
        {["Destinations", "Universities", "Scholarships", "About"].map((l) => (
          <span key={l} style={{ color: "var(--color-neutral-700)" }}>
            {l}
          </span>
        ))}
      </nav>
      <button className="btn btn-primary ml-5" type="button">
        Book a consultation
      </button>
    </div>
  );
}

function Hero() {
  return (
    <div className="max-w-[660px] px-10 pb-10 pt-[52px]">
      <Tag tone="accent-2">January 2027 intake</Tag>
      <h1
        className="mb-[18px] mt-4 max-w-[15ch] text-[52px]"
        style={{ textWrap: "pretty" } as React.CSSProperties}
      >
        Study in the United Kingdom, from Colombo.
      </h1>
      <p
        className="max-w-[46ch] text-[16.5px]"
        style={{ color: "var(--color-neutral-800)" }}
      >
        Twenty-two partner universities. Counsellors who have placed 1,400
        students. Tell us where you want to end up and we will tell you what it
        takes to get there.
      </p>
      <div className="mt-[26px] flex gap-3">
        <button className="btn btn-primary" type="button">
          Start your assessment
        </button>
        <button className="btn btn-secondary" type="button">
          Browse programmes
        </button>
      </div>
      <div className="mt-11 flex gap-[38px]">
        {[
          ["22", "partner universities"],
          ["1,400", "students placed"],
          ["14 yrs", "in Colombo"],
        ].map(([value, label]) => (
          <div key={label}>
            <div className="font-heading text-[30px]">{value}</div>
            <div
              className="text-[12px]"
              style={{ color: "var(--color-neutral-600)" }}
            >
              {label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
