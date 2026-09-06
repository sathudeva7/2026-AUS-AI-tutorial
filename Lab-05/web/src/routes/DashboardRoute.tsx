/** The counsellor dashboard: the lead book beside one lead's file.
 *
 * Fully live. `GET /api/leads` for the column, `GET /api/briefing` for the
 * detail. Nothing on this surface is invented — where the record is empty the
 * UI says so rather than filling it in.
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button, StatusChip } from "@/components/ui";
import { Tabs, TabPanel } from "@/components/ui/Tabs";
import { FailureCard, LoadingNote } from "@/components/ui/States";
import { ProfileTab } from "@/components/dashboard/ProfileTab";
import { BriefingTab } from "@/components/dashboard/BriefingTab";
import { TranscriptTab } from "@/components/dashboard/TranscriptTab";
import { ShortlistTab } from "@/components/dashboard/ShortlistTab";
import {
  LEAD_STATUS_STYLE,
  profileCompleteness,
  wantLine,
} from "@/components/dashboard/facts";
import { repo } from "@/data/repo";
import { triggerLabel } from "@/lib/verdict";
import { humanise } from "@/lib/format";
import type { Briefing, Lead } from "@/data/types";

type TabValue = "profile" | "briefing" | "transcript" | "shortlist";

const TABS = [
  { value: "profile" as const, label: "Profile" },
  { value: "briefing" as const, label: "AI briefing" },
  { value: "transcript" as const, label: "Transcript" },
  { value: "shortlist" as const, label: "Shortlist" },
];

export function DashboardRoute() {
  const { leadId } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as TabValue) ?? "profile";

  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void repo
      .listLeads()
      .then((rows) => {
        if (cancelled) return;
        setLeads(rows);
        // Land on a lead rather than an empty pane, but only when the URL
        // did not already name one.
        if (!leadId && rows.length) {
          navigate(`/leads/${rows[0].lead_id}`, { replace: true });
        }
      })
      .catch((e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [leadId, navigate, reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  if (error) {
    return (
      <div className="p-8">
        <FailureCard error={error} onRetry={retry} />
      </div>
    );
  }

  return (
    <div className="flex h-screen">
      <div
        className="flex w-[312px] flex-none flex-col"
        style={{ borderRight: "1px solid var(--color-divider)" }}
      >
        <div className="px-5 pb-3.5 pt-[22px]">
          <h3 className="m-0 text-[21px]">Lead book</h3>
          <p
            className="m-0 mt-1 text-[12.5px]"
            style={{ color: "var(--color-neutral-700)" }}
          >
            {leads
              ? summarise(leads)
              : "Reading the lead book…"}
          </p>
        </div>
        <div className="nb-scroll flex flex-col gap-1.5 overflow-y-auto px-3 pb-4">
          {leads?.map((lead) => (
            <LeadButton
              key={lead.lead_id}
              lead={lead}
              selected={lead.lead_id === leadId}
              onSelect={() => navigate(`/leads/${lead.lead_id}?tab=${tab}`)}
            />
          ))}
        </div>
      </div>

      <div className="nb-scroll flex-1 overflow-y-auto px-8 pb-10 pt-[26px]">
        {leadId ? (
          <LeadDetail
            leadId={leadId}
            tab={tab}
            onTabChange={(next) => setParams({ tab: next })}
          />
        ) : leads?.length === 0 ? (
          <LoadingNote>
            The lead book is empty. Open the student widget and send a message —
            the first turn creates a lead.
          </LoadingNote>
        ) : null}
      </div>
    </div>
  );
}

function summarise(leads: Lead[]): string {
  const escalated = leads.filter((l) => l.status === "escalated").length;
  const unassigned = leads.filter((l) => !l.assigned_counsellor_id).length;
  return (
    `${leads.length} lead${leads.length === 1 ? "" : "s"}` +
    (escalated ? ` · ${escalated} escalated` : "") +
    (unassigned ? ` · ${unassigned} unassigned` : "")
  );
}

function LeadButton({
  lead,
  selected,
  onSelect,
}: {
  lead: Lead;
  selected: boolean;
  onSelect: () => void;
}) {
  const status = LEAD_STATUS_STYLE[lead.status] ?? LEAD_STATUS_STYLE.active;
  const escalated = lead.status === "escalated";

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className="cursor-pointer rounded-md px-3 py-2.5 text-left"
      style={{
        background: selected ? "var(--color-bg)" : "transparent",
        border: `1px solid ${
          selected
            ? "var(--color-accent)"
            : escalated
              ? "var(--color-accent-300)"
              : "var(--color-divider)"
        }`,
      }}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-[13.5px] font-semibold">
          {lead.name ?? lead.email}
        </span>
        <span
          className="ml-auto text-[10.5px]"
          style={{ color: "var(--color-neutral-600)" }}
        >
          {Object.keys(lead.facts).length}/7
        </span>
      </div>
      <div
        className="mt-[3px] text-[12px]"
        style={{ color: "var(--color-neutral-700)" }}
      >
        {wantLine(lead.facts)}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <StatusChip
          label={humanise(lead.status)}
          background={status.background}
          foreground={status.foreground}
        />
        <span
          className="text-[10.5px]"
          style={{ color: "var(--color-neutral-600)" }}
        >
          {lead.assigned_counsellor_id ?? "unassigned queue"}
        </span>
      </div>
    </button>
  );
}

function LeadDetail({
  leadId,
  tab,
  onTabChange,
}: {
  leadId: string;
  tab: TabValue;
  onTabChange: (next: TabValue) => void;
}) {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    setBriefing(null);
    setError(null);
    void repo
      .getBriefing(leadId)
      .then((b) => !cancelled && setBriefing(b))
      .catch((e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  if (error) return <FailureCard error={error} />;
  if (!briefing) return <LoadingNote>Reading the file…</LoadingNote>;

  const escalation = briefing.escalations[0];

  return (
    <>
      <div className="mb-[18px] flex items-start gap-4">
        <div>
          <h2 className="m-0 text-[30px]">{briefing.name ?? leadId}</h2>
          <p
            className="m-0 mt-1.5 max-w-[70ch] text-[13px]"
            style={{ color: "var(--color-neutral-700)" }}
          >
            {wantLine(briefing.facts)} · profile{" "}
            {profileCompleteness(briefing)}% complete ·{" "}
            {briefing.assigned_counsellor_id
              ? `assigned to ${briefing.assigned_counsellor_id}`
              : "in the unassigned queue — no active counsellor owns this destination"}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary">Assign</Button>
          <Button variant="primary">
            {escalation ? "Take the callback" : "Open the conversation"}
          </Button>
        </div>
      </div>

      {escalation ? (
        <div
          className="mb-[18px] rounded-md p-4"
          style={{
            border: "1px solid var(--color-accent-300)",
            background: "var(--color-accent-100)",
          }}
        >
          <div
            className="font-heading text-[15px]"
            style={{ color: "var(--color-accent-800)" }}
          >
            Escalated — {triggerLabel(escalation.trigger).toLowerCase()}
          </div>
          {/* The agent's own detail, verbatim. Rewording a handover note
              loses the thing the counsellor needs: what was already
              established, so they do not re-investigate it. */}
          <p
            className="m-0 mt-1.5 text-[13px] leading-relaxed"
            style={{ color: "var(--color-accent-800)" }}
          >
            {escalation.detail}
          </p>
        </div>
      ) : null}

      <Tabs
        items={TABS}
        value={tab}
        onChange={onTabChange}
        label="Lead detail sections"
        className="mb-[18px]"
      />

      <TabPanel value={tab}>
        {tab === "profile" ? <ProfileTab briefing={briefing} /> : null}
        {tab === "briefing" ? <BriefingTab briefing={briefing} /> : null}
        {tab === "transcript" ? <TranscriptTab leadId={leadId} /> : null}
        {tab === "shortlist" ? <ShortlistTab briefing={briefing} /> : null}
      </TabPanel>
    </>
  );
}
