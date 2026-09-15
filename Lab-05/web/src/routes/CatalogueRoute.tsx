/** The catalogue console: programmes, their entry requirements, and the
 *  overnight refresh queue.
 *
 * Everything the agent is allowed to state about a fee, a deadline or a
 * requirement comes from here, which is why every row travels with the date
 * it was last verified and why a stale row says so in words rather than only
 * in colour.
 *
 * Fixture-backed, and that is not hidden. There is no `GET /api/programmes`
 * and no PUT behind it: `catalogueStore` is a session overlay, so an edit
 * survives navigation and not a reload. Every destructive control here says
 * so at the point of use rather than letting the table imply a catalogue the
 * agent reads has changed.
 */
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Button, Card, StatusChip } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { Menu } from "@/components/ui/Menu";
import { Select } from "@/components/ui/Select";
import {
  ClockIcon,
  CloseIcon,
  GlobeIcon,
  GraduationIcon,
  InstitutionIcon,
  PlusIcon,
  SearchIcon,
  SlidersIcon,
} from "@/components/ui/icons";
import {
  decideRefreshItem,
  deleteProgramme,
  duplicateProgramme,
  useCatalogue,
} from "@/data/catalogueStore";
import { COUNTRY_BY_CODE, toCountryCode } from "@/data/countries";
import { formatDate, formatMoney, verifiedLabel } from "@/lib/format";
import {
  levelLabel,
  orgInitials,
  statusOf,
  STATUS_LABEL,
} from "@/features/catalogue/display";
import type { Programme, RefreshItem } from "@/data/types";

type TabValue = "programmes" | "rules" | "freshness";

const TABS = [
  { value: "programmes" as const, label: "Programmes" },
  { value: "rules" as const, label: "Entry requirements" },
  { value: "freshness" as const, label: "Freshness" },
];

const ROWS_PER_PAGE = [10, 25, 50];

export function CatalogueRoute() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as TabValue) ?? "programmes";
  const navigate = useNavigate();
  const { programmes, refreshItems } = useCatalogue();

  const institutions = new Set(programmes.map((p) => p.institution)).size;
  const countries = new Set(programmes.map((p) => p.country)).size;
  const needsCheck = programmes.filter((p) => statusOf(p) !== "active").length;

  return (
    <div className="console console-sheet-page">
      <nav className="console-crumbs" aria-label="Breadcrumb">
        <span>Catalogue</span>
        <span className="console-crumbs-sep" aria-hidden="true">
          ›
        </span>
        <span style={{ color: "var(--c-ink)" }}>
          {TABS.find((t) => t.value === tab)?.label}
        </span>
      </nav>

      <div className="flex items-start gap-4">
        <div className="min-w-0">
          <h2 className="console-page-title">Programme catalogue</h2>
          <p className="console-page-sub">
            Every figure the agent states about a fee, a deadline or an entry
            requirement comes from a row here, and travels with the date it was
            last verified.
          </p>
        </div>
        <button
          type="button"
          className="console-btn ml-auto flex-none"
          data-variant="primary"
          onClick={() => navigate("/catalogue/new")}
        >
          <PlusIcon size={15} />
          Add programme
        </button>
      </div>

      {/* Four counts, all of them read off the rows in the table below.
          "Needs verification" is the only one anybody acts on, which is why it
          is the only one wearing red. */}
      <div className="console-tiles">
        <Tile
          tone="accent"
          icon={<GraduationIcon size={20} />}
          value={programmes.length}
          label="Total programmes"
        />
        <Tile
          tone="info"
          icon={<InstitutionIcon size={20} />}
          value={institutions}
          label={institutions === 1 ? "Institution" : "Institutions"}
        />
        <Tile
          tone="warn"
          icon={<GlobeIcon size={20} />}
          value={countries}
          label={countries === 1 ? "Country" : "Countries"}
        />
        <Tile
          tone="danger"
          icon={<ClockIcon size={20} />}
          value={needsCheck}
          label="Needs verification"
        />
      </div>

      <div className="console-tabs" role="tablist" aria-label="Catalogue sections">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            className="console-tab"
            aria-selected={t.value === tab}
            onClick={() => setParams({ tab: t.value })}
          >
            {t.label}
            {t.value === "programmes" ? ` (${programmes.length})` : ""}
          </button>
        ))}
      </div>

      {tab === "programmes" ? (
        <ProgrammesTab
          programmes={programmes}
          onOpen={(id) => navigate(`/catalogue/${id}`)}
        />
      ) : null}
      {tab === "rules" ? <RulesTab programmes={programmes} /> : null}
      {tab === "freshness" ? <FreshnessTab items={refreshItems} /> : null}
    </div>
  );
}

function Tile({
  tone,
  icon,
  value,
  label,
}: {
  tone: "accent" | "info" | "warn" | "danger";
  icon: React.ReactNode;
  value: number;
  label: string;
}) {
  return (
    <div className="console-tile" data-tone={tone}>
      <span className="console-tile-icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        <div className="console-tile-value">{value}</div>
        <div className="console-tile-label">{label}</div>
      </div>
    </div>
  );
}

function ProgrammesTab({
  programmes,
  onOpen,
}: {
  programmes: Programme[];
  onOpen: (programmeId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(10);
  const [confirmDelete, setConfirmDelete] = useState<Programme | null>(null);

  const countryOptions = [
    { value: "", label: "All countries" },
    ...[...new Set(programmes.map((p) => p.country))]
      .sort()
      .map((c) => ({ value: c, label: c })),
  ];

  const needle = query.trim().toLowerCase();
  const shown = programmes.filter((p) => {
    if (country && p.country !== country) return false;
    if (status && statusOf(p) !== status) return false;
    if (!needle) return true;
    return [p.name, p.institution, p.country, p.city, p.field, p.level].some(
      (f) => f.toLowerCase().includes(needle),
    );
  });

  // Clamped rather than reset. Filtering down to three rows while on page 4
  // would otherwise show an empty table with no way to tell why.
  const pages = Math.max(1, Math.ceil(shown.length / perPage));
  const current = Math.min(page, pages - 1);
  const from = current * perPage;
  const rows = shown.slice(from, from + perPage);

  return (
    <>
      <div className="console-toolbar">
        <div className="console-search" style={{ maxWidth: 320 }}>
          <SearchIcon size={15} className="console-search-icon" />
          <input
            className="console-input"
            type="search"
            value={query}
            placeholder="Search programmes, institutions…"
            aria-label="Search programmes"
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
        </div>

        <Select
          className="w-[190px]"
          value={country}
          options={countryOptions}
          ariaLabel="Filter by country"
          onChange={(v) => {
            setCountry(v);
            setPage(0);
          }}
        />

        <Select
          className="w-[180px]"
          value={status}
          searchable={false}
          ariaLabel="Filter by status"
          options={[
            { value: "", label: "All statuses" },
            { value: "active", label: "Active" },
            { value: "stale", label: "Needs check" },
            { value: "draft", label: "Draft" },
          ]}
          onChange={(v) => {
            setStatus(v);
            setPage(0);
          }}
        />

        {query || country || status ? (
          <button
            type="button"
            className="console-btn"
            data-variant="secondary"
            onClick={() => {
              setQuery("");
              setCountry("");
              setStatus("");
              setPage(0);
            }}
          >
            <SlidersIcon size={15} />
            Clear filters
          </button>
        ) : null}

        <span className="console-meta ml-auto">
          {shown.length === programmes.length
            ? `${programmes.length} programmes`
            : `${shown.length} of ${programmes.length} programmes`}
        </span>
      </div>

      <div className="console-table-wrap">
        <table className="console-table">
          <thead>
            <tr>
              <th scope="col">Programme</th>
              <th scope="col">Institution</th>
              <th scope="col">Country</th>
              <th scope="col">Tuition</th>
              <th scope="col">Application deadline</th>
              <th scope="col">Last verified</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((programme) => {
              const rowStatus = statusOf(programme);
              const code = toCountryCode(programme.country);
              return (
                <tr
                  key={programme.programme_id}
                  data-clickable="true"
                  onClick={() => onOpen(programme.programme_id)}
                >
                  <td>
                    <div className="console-cell-title">{programme.name}</div>
                    <div className="console-cell-sub">
                      {levelLabel(programme.level)}
                    </div>
                  </td>
                  <td>
                    <span className="flex items-center gap-2.5">
                      <span className="console-org" aria-hidden="true">
                        {orgInitials(programme.institution)}
                      </span>
                      <span className="min-w-0">{programme.institution}</span>
                    </span>
                  </td>
                  <td>
                    <span className="flex items-center gap-2">
                      <span className="console-flag" aria-hidden="true">
                        {COUNTRY_BY_CODE[code]?.flag ?? "🏳"}
                      </span>
                      {programme.country}
                    </span>
                  </td>
                  <td>
                    {formatMoney(
                      programme.tuition_per_year,
                      programme.currency,
                    )}
                  </td>
                  <td>{formatDate(programme.application_deadline)}</td>
                  {/* The date in words, not a bare timestamp: "5 weeks ago" is
                      the thing somebody acts on. */}
                  <td className="console-meta">
                    {programme.draft
                      ? "Never"
                      : verifiedLabel(programme.verified_at)}
                  </td>
                  <td>
                    <span
                      className="console-lead-status"
                      data-status={
                        rowStatus === "active" ? "converted" : "escalated"
                      }
                    >
                      {STATUS_LABEL[rowStatus]}
                    </span>
                  </td>
                  <td
                    style={{ width: 48 }}
                    // The row navigates; the menu must not.
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Menu
                      label={`Actions for ${programme.name}`}
                      trigger={<span aria-hidden="true">···</span>}
                      items={[
                        {
                          label: "Edit",
                          onSelect: () => onOpen(programme.programme_id),
                        },
                        {
                          label: "Duplicate",
                          onSelect: () => {
                            const copy = duplicateProgramme(
                              programme.programme_id,
                            );
                            if (copy) onOpen(copy.programme_id);
                          },
                        },
                        {
                          label: "Delete",
                          danger: true,
                          onSelect: () => setConfirmDelete(programme),
                        },
                      ]}
                    />
                  </td>
                </tr>
              );
            })}

            {rows.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <p className="console-empty m-0 py-6 text-center">
                    {programmes.length === 0
                      ? "No programmes yet. Add one to get started."
                      : "No programmes match these filters."}
                  </p>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="console-pager">
        <span className="console-meta">
          {shown.length === 0
            ? "Nothing to show"
            : `Showing ${from + 1}–${Math.min(from + perPage, shown.length)} of ${shown.length} programmes`}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className="console-page-btn"
            aria-label="Previous page"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            ‹
          </button>
          {Array.from({ length: pages }, (_, i) => (
            <button
              key={i}
              type="button"
              className="console-page-btn"
              aria-label={`Page ${i + 1}`}
              aria-current={i === current ? "true" : undefined}
              onClick={() => setPage(i)}
            >
              {i + 1}
            </button>
          ))}
          <button
            type="button"
            className="console-page-btn"
            aria-label="Next page"
            disabled={current >= pages - 1}
            onClick={() => setPage(current + 1)}
          >
            ›
          </button>
        </div>

        <Select
          className="w-[116px]"
          value={String(perPage)}
          searchable={false}
          ariaLabel="Rows per page"
          options={ROWS_PER_PAGE.map((n) => ({
            value: String(n),
            label: `${n} rows`,
          }))}
          onChange={(v) => {
            setPerPage(Number(v));
            setPage(0);
          }}
        />
      </div>

      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
        title="Delete this programme?"
        description={
          confirmDelete
            ? `${confirmDelete.name} — ${confirmDelete.institution}. The agent will stop matching students against it.`
            : undefined
        }
        footer={
          <>
            <button
              type="button"
              className="console-btn"
              data-variant="secondary"
              onClick={() => setConfirmDelete(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="console-btn"
              data-variant="primary"
              style={{ background: "var(--c-danger)" }}
              onClick={() => {
                if (confirmDelete) deleteProgramme(confirmDelete.programme_id);
                setConfirmDelete(null);
              }}
            >
              Delete
            </button>
          </>
        }
      >
        {/* Said plainly, because the opposite assumption is the dangerous one.
            Somebody who believes this wrote to a shared catalogue will not
            check afterwards. */}
        <p className="console-hint m-0">
          This catalogue is demo data held for the current session only — there
          is no programmes endpoint behind it yet. The row disappears from this
          table and comes back when the page reloads.
        </p>
      </Dialog>
    </>
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

/** The rule grid, shared with the editor.
 *
 * Both call sites now sit inside `.console`, so it is drawn in the console's
 * type rather than Organic's.
 */
export function RuleGrid({
  requirements,
  onRemove,
}: {
  requirements: Programme["requirements"];
  onRemove?: (index: number) => void;
}) {
  return (
    <div className="console-rules">
      {requirements.map((requirement, index) => (
        <div
          key={requirement.requirement_id || index}
          className="console-rule"
          style={{
            // The rule column is sized to its CONTENT, not to a number.
            //
            // It was 96px in the prototype, then 190px here — both guesses at
            // how long an expression gets, and both wrong for
            // `tuition_per_year<=budget_per_year`. Truncating is not the
            // answer either: a rule clipped to `bachelor_years>` is a
            // different rule, and this column is the one place on the screen
            // where the exact characters are the point.
            //
            // max-content measures the widest rule across every row, so the
            // column fits the longest one and the description takes what is
            // left. Nothing to re-tune when a longer rule is added.
            gridTemplateColumns: `180px max-content minmax(0, 1fr) ${
              onRemove ? "34px" : "0px"
            }`,
          }}
        >
          <span className="console-rule-key">
            {requirement.key.replace(/_/g, " ")}
          </span>
          <span className="console-rule-expr" title={requirement.rule}>
            {requirement.rule}
          </span>
          <span className="console-rule-note">{requirement.description}</span>
          {onRemove ? (
            <button
              type="button"
              className="console-icon-btn"
              data-variant="ghost"
              aria-label={`Remove ${requirement.key.replace(/_/g, " ")} requirement`}
              onClick={() => onRemove(index)}
            >
              <CloseIcon size={15} />
            </button>
          ) : (
            <span />
          )}
        </div>
      ))}
      {requirements.length === 0 ? (
        <div className="console-emptybox">
          <div className="console-emptybox-title">No entry requirements</div>
          <p className="console-emptybox-body">
            A programme with none matches every student who reaches the
            catalogue, which is rarely what you mean.
          </p>
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
        finds against the stored values. It never writes to the catalogue itself
        — approving one of these is the only way a retrieved figure becomes one
        the agent is allowed to state.
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
              <span
                style={{ color: "var(--color-neutral-600)" }}
                aria-label="becomes"
              >
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
