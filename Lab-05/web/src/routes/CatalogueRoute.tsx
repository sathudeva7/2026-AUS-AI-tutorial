/** The catalogue console: programmes, their entry requirements, and the
 *  overnight refresh queue.
 *
 * Everything the agent is allowed to state about a fee, a deadline or a
 * requirement comes from here, which is why every row travels with the date
 * it was last verified and why a stale row says so in words rather than only
 * in colour.
 */
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button, Card, ReadonlyValue, StatusChip, Table } from "@/components/ui";
import { Tabs, TabPanel } from "@/components/ui/Tabs";
import {
  decideRefreshItem,
  useCatalogue,
} from "@/data/catalogueStore";
import {
  formatDate,
  formatMoney,
  isStale,
  verifiedLabel,
} from "@/lib/format";
import type { Programme, RefreshItem } from "@/data/types";

type TabValue = "programmes" | "rules" | "freshness";

const TABS = [
  { value: "programmes" as const, label: "Programmes" },
  { value: "rules" as const, label: "Entry requirements" },
  { value: "freshness" as const, label: "Freshness" },
];

export function CatalogueRoute() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as TabValue) ?? "programmes";
  const navigate = useNavigate();
  const { programmes, refreshItems } = useCatalogue();

  const institutions = new Set(programmes.map((p) => p.institution)).size;
  const countries = new Set(programmes.map((p) => p.country)).size;

  return (
    <div className="px-8 pb-12 pt-[34px]">
      <div className="flex items-start gap-4">
        <div>
          <h2 className="m-0 text-[32px]">Catalogue</h2>
          <p
            className="mt-1.5 max-w-[68ch] text-sm"
            style={{ color: "var(--color-neutral-700)" }}
          >
            {programmes.length} programmes across {institutions} institutions in{" "}
            {countries} countries. Every figure the agent states comes from a
            row here, and travels with the date it was last checked.
          </p>
        </div>
        <Button
          variant="primary"
          className="ml-auto"
          onClick={() => navigate("/catalogue/new")}
        >
          Add a programme
        </Button>
      </div>

      <Tabs
        items={TABS}
        value={tab}
        onChange={(next) => setParams({ tab: next })}
        label="Catalogue sections"
        className="my-5"
      />

      <TabPanel value={tab}>
        {tab === "programmes" ? (
          <ProgrammesTable
            programmes={programmes}
            onOpen={(id) => navigate(`/catalogue/${id}`)}
          />
        ) : null}
        {tab === "rules" ? <RulesTab programmes={programmes} /> : null}
        {tab === "freshness" ? <FreshnessTab items={refreshItems} /> : null}
      </TabPanel>
    </div>
  );
}

function ProgrammesTable({
  programmes,
  onOpen,
}: {
  programmes: Programme[];
  onOpen: (programmeId: string) => void;
}) {
  return (
    <Card className="max-w-[1080px] overflow-hidden rounded-md p-0">
      <Table
        head={[
          "Programme",
          "Institution",
          "Tuition",
          "Deadline",
          "Last verified",
        ]}
      >
        {programmes.map((programme) => {
          const stale = isStale(programme.verified_at);
          return (
            <tr
              key={programme.programme_id}
              className="cursor-pointer"
              onClick={() => onOpen(programme.programme_id)}
            >
              <td className="font-semibold">
                <button
                  type="button"
                  className="text-left"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(programme.programme_id);
                  }}
                >
                  {programme.name}
                </button>
              </td>
              <td>{programme.institution}</td>
              <td className="figure text-[12.5px]">
                {formatMoney(programme.tuition_per_year, programme.currency)}
              </td>
              <td>{formatDate(programme.application_deadline)}</td>
              <td>
                <StatusChip
                  label={
                    programme.draft
                      ? "Draft · not visible"
                      : verifiedLabel(programme.verified_at)
                  }
                  background={
                    programme.draft
                      ? "var(--color-neutral-300)"
                      : stale
                        ? "var(--color-accent-200)"
                        : "var(--color-accent-2-200)"
                  }
                  foreground={
                    programme.draft
                      ? "var(--color-neutral-900)"
                      : stale
                        ? "var(--color-accent-800)"
                        : "var(--color-accent-2-800)"
                  }
                />
              </td>
            </tr>
          );
        })}
      </Table>
    </Card>
  );
}

function RulesTab({ programmes }: { programmes: Programme[] }) {
  const [selectedId, setSelectedId] = useState(
    programmes[0]?.programme_id ?? "",
  );
  const programme =
    programmes.find((p) => p.programme_id === selectedId) ?? programmes[0];
  if (!programme) return null;

  return (
    <div className="max-w-[1000px]">
      <div className="mb-3 flex flex-wrap gap-1.5">
        {programmes.map((p) => (
          <button
            key={p.programme_id}
            type="button"
            onClick={() => setSelectedId(p.programme_id)}
            aria-pressed={p.programme_id === programme.programme_id}
            className="cursor-pointer rounded-pill border px-3 py-1.5 font-body text-[12px]"
            style={{
              background:
                p.programme_id === programme.programme_id
                  ? "var(--color-accent-2-200)"
                  : "var(--color-neutral-100)",
              borderColor:
                p.programme_id === programme.programme_id
                  ? "var(--color-accent-2-500)"
                  : "var(--color-divider)",
            }}
          >
            {p.name}
          </button>
        ))}
      </div>

      <Card className="rounded-md p-[18px]">
        <div className="font-heading text-[17px]">
          {programme.name} — {programme.institution}
        </div>
        <p
          className="mb-4 mt-1.5 max-w-[76ch] text-[12.5px]"
          style={{ color: "var(--color-neutral-700)" }}
        >
          Requirements are data, not prose. The rule engine evaluates each row
          to MET, NOT_MET or INDETERMINATE against the student&apos;s stated
          facts — an unevaluable row is held open pending a document, never
          resolved by guessing in either direction.
        </p>

        <RuleGrid requirements={programme.requirements} />

        <div className="mt-4 flex gap-2">
          <Button variant="secondary" disabled>
            Add requirement
          </Button>
          <Button variant="primary" disabled>
            Save
          </Button>
        </div>
        <p
          className="m-0 mt-2 text-[11.5px]"
          style={{ color: "var(--color-neutral-700)" }}
        >
          Requirements are edited on the programme itself — open it from the
          Programmes tab.
        </p>
      </Card>
    </div>
  );
}

/** The five-column rule grid, shared with the editor. */
export function RuleGrid({
  requirements,
  onRemove,
}: {
  requirements: Programme["requirements"];
  onRemove?: (index: number) => void;
}) {
  return (
    <div className="flex flex-col gap-[9px]">
      {requirements.map((requirement, index) => (
        <div
          key={requirement.requirement_id || index}
          className="grid items-center gap-[9px]"
          style={{
            // The prototype's middle column was 96px, sized for words like
            // "at least". Real rules are expressions — `bachelor_years>=4`,
            // `percentage>=65` — and clipped to `bachelor_years>` at that
            // width, which turns a rule into a different rule. 190px fits the
            // longest in the seed catalogue with room to spare.
            gridTemplateColumns: `180px 190px 1fr ${onRemove ? "36px" : "0px"}`,
          }}
        >
          <ReadonlyValue>{requirement.key.replace(/_/g, " ")}</ReadonlyValue>
          <ReadonlyValue className="figure text-center" title={requirement.rule}>
            {requirement.rule}
          </ReadonlyValue>
          <ReadonlyValue muted>{requirement.description}</ReadonlyValue>
          {onRemove ? (
            <Button
              variant="ghost"
              aria-label={`Remove ${requirement.key} requirement`}
              onClick={() => onRemove(index)}
              style={{ color: "var(--color-neutral-700)" }}
            >
              ×
            </Button>
          ) : (
            <span />
          )}
        </div>
      ))}
      {requirements.length === 0 ? (
        <div
          className="rounded-md p-4 text-[12.5px]"
          style={{
            border: "1px dashed var(--color-neutral-400)",
            color: "var(--color-neutral-700)",
          }}
        >
          No requirements yet. A programme with none matches every student, which
          is rarely what you mean.
        </div>
      ) : null}
    </div>
  );
}

function FreshnessTab({ items }: { items: RefreshItem[] }) {
  const STATE_LABEL: Record<RefreshItem["state"], string> = {
    awaiting: "Awaiting review",
    approved: "Approved · catalogue updated",
    rejected: "Rejected · stored value kept",
    unchanged: "Confirmed unchanged",
  };
  const STATE_STYLE: Record<
    RefreshItem["state"],
    { background: string; foreground: string }
  > = {
    awaiting: {
      background: "var(--color-accent-200)",
      foreground: "var(--color-accent-800)",
    },
    approved: {
      background: "var(--color-accent-2-200)",
      foreground: "var(--color-accent-2-800)",
    },
    rejected: {
      background: "var(--color-neutral-300)",
      foreground: "var(--color-neutral-900)",
    },
    unchanged: {
      background: "var(--color-accent-2-200)",
      foreground: "var(--color-accent-2-800)",
    },
  };

  return (
    <div className="flex max-w-[920px] flex-col gap-3.5">
      <p
        className="m-0 max-w-[74ch] text-[13px]"
        style={{ color: "var(--color-neutral-700)" }}
      >
        The refresh job searches official sources overnight and diffs what it
        finds against the stored values. It never writes to the catalogue
        itself — approving one of these is the only way a retrieved figure
        becomes one the agent is allowed to state.
      </p>

      {items.map((item) => {
        const style = STATE_STYLE[item.state];
        const decided = item.state !== "awaiting";
        return (
          <Card key={item.item_id} className="rounded-md p-4">
            <div className="flex items-baseline gap-3">
              <div className="flex-1">
                <div className="text-sm font-semibold">{item.programme}</div>
                <div
                  className="text-[12px]"
                  style={{ color: "var(--color-neutral-600)" }}
                >
                  {item.field}
                </div>
              </div>
              <StatusChip
                label={STATE_LABEL[item.state]}
                background={style.background}
                foreground={style.foreground}
              />
            </div>

            <div className="figure my-3 flex items-center gap-2.5 text-[12.5px]">
              <span
                className="rounded-pill px-3 py-1.5"
                style={{ background: "var(--color-neutral-200)" }}
              >
                {item.was}
              </span>
              <span style={{ color: "var(--color-neutral-600)" }} aria-label="becomes">
                →
              </span>
              <span
                className="rounded-pill px-3 py-1.5"
                style={{
                  background: "var(--color-accent-2-200)",
                  color: "var(--color-accent-2-800)",
                }}
              >
                {item.now}
              </span>
              <span
                className="font-body text-[11.5px]"
                style={{ color: "var(--color-neutral-600)" }}
              >
                {item.source}
              </span>
            </div>

            {item.state === "unchanged" ? (
              <p
                className="m-0 text-[12px]"
                style={{ color: "var(--color-neutral-700)" }}
              >
                Nothing to decide — the source still says what the catalogue
                says. The verification date moves; the value does not.
              </p>
            ) : (
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  className="text-[12.5px]"
                  disabled={decided}
                  onClick={() => decideRefreshItem(item.item_id, "approved")}
                >
                  Approve
                </Button>
                <Button
                  variant="secondary"
                  className="text-[12.5px]"
                  disabled={decided}
                  onClick={() => decideRefreshItem(item.item_id, "rejected")}
                >
                  Reject
                </Button>
                <Button variant="ghost" className="text-[12.5px]" disabled>
                  Open source
                </Button>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
