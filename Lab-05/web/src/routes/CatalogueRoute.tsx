/** The catalogue console: programmes, their entry requirements, and the
 *  overnight refresh queue.
 *
 * Everything the agent is allowed to state about a fee, a deadline or a
 * requirement comes from here, which is why every row travels with the date
 * it was last verified and why a stale row says so in words rather than only
 * in colour.
 *
 * The Programmes tab is LIVE: `GET /api/programmes`, tenant-scoped, with
 * search, filtering and paging done by the server. Archiving and duplicating
 * go through their endpoints too.
 *
 * The other two tabs are still fixtures, and that is not hidden. Entry
 * requirements need a per-programme read (the list deliberately does not carry
 * them — it would be a query per row), and the refresh queue has no backend at
 * all until 006. Both say so on screen rather than implying a catalogue the
 * agent reads has changed.
 */
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { UseQueryResult } from "@tanstack/react-query";

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
import { decideRefreshItem, useCatalogue } from "@/data/catalogueStore";
import { COUNTRY_BY_CODE } from "@/data/countries";
import { formatDate, formatMinorUnits, verifiedLabel } from "@/lib/format";
import {
  levelLabel,
  orgInitials,
  rowStatus,
  STATUS_LABEL,
} from "@/features/catalogue/display";
import {
  useArchiveProgramme,
  useDuplicateProgramme,
  useProgrammeList,
} from "@/features/catalogue/queries";
import type {
  ProgrammeListParams,
  ProgrammeListResult,
  ProgrammeRow,
} from "@/features/catalogue/types";
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

  // Still the fixture, and only for the two tabs that have no endpoint behind
  // them yet: entry requirements need a per-programme read, and the refresh
  // queue is 006. The Programmes tab below is live.
  const { programmes: fixtureProgrammes, refreshItems } = useCatalogue();

  // The filters live HERE rather than in the tab, because the tiles above the
  // table are drawn from the same response. Two components asking separately
  // would be two requests, and worse, two answers that can disagree.
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(10);

  // Typing is not a request per keystroke. Without this every letter in the
  // search box is a round trip, and the answers can arrive out of order.
  const search = useDebounced(query, 250);

  const list = useProgrammeList({
    search,
    country: country || undefined,
    status: (status || undefined) as ProgrammeListParams["status"],
    limit: perPage,
    offset: page * perPage,
  });

  const counts = list.data?.counts;

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

      {/* Counted by the server over the WHOLE catalogue, not over the rows on
          screen. Page one of fifteen knows about one page's universities, and
          a tile that changed as you paged would be answering a different
          question from the one its label asks.

          "Needs verification" is the only one anybody acts on, which is why it
          is the only one wearing red. */}
      <div className="console-tiles">
        <Tile
          tone="accent"
          icon={<GraduationIcon size={20} />}
          value={counts?.all}
          label="Total programmes"
        />
        <Tile
          tone="info"
          icon={<InstitutionIcon size={20} />}
          value={counts?.institutions}
          label={counts?.institutions === 1 ? "Institution" : "Institutions"}
        />
        <Tile
          tone="warn"
          icon={<GlobeIcon size={20} />}
          value={counts?.countries}
          label={counts?.countries === 1 ? "Country" : "Countries"}
        />
        <Tile
          tone="danger"
          icon={<ClockIcon size={20} />}
          value={counts ? counts.stale + counts.draft : undefined}
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
            {t.value === "programmes" && counts ? ` (${counts.all})` : ""}
          </button>
        ))}
      </div>

      {tab === "programmes" ? (
        <ProgrammesTab
          list={list}
          query={query}
          country={country}
          status={status}
          page={page}
          perPage={perPage}
          onQuery={(v) => {
            setQuery(v);
            setPage(0);
          }}
          onCountry={(v) => {
            setCountry(v);
            setPage(0);
          }}
          onStatus={(v) => {
            setStatus(v);
            setPage(0);
          }}
          onPage={setPage}
          onPerPage={(n) => {
            setPerPage(n);
            setPage(0);
          }}
          onOpen={(id) => navigate(`/catalogue/${id}`)}
        />
      ) : null}
      {tab === "rules" ? <RulesTab programmes={fixtureProgrammes} /> : null}
      {tab === "freshness" ? <FreshnessTab items={refreshItems} /> : null}
    </div>
  );
}

/** A value that stops changing once the user stops typing.
 *
 * Here rather than in lib/ until something else needs it — one caller is not
 * a shared utility, it is a local detail of this screen.
 */
function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return settled;
}

function Tile({
  tone,
  icon,
  value,
  label,
}: {
  tone: "accent" | "info" | "warn" | "danger";
  icon: React.ReactNode;
  /** Undefined while the first page is in flight. An em dash rather than 0,
   *  because a zero somebody reads as a fact is worse than a blank. */
  value: number | undefined;
  label: string;
}) {
  return (
    <div className="console-tile" data-tone={tone}>
      <span className="console-tile-icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        <div className="console-tile-value">{value ?? "—"}</div>
        <div className="console-tile-label">{label}</div>
      </div>
    </div>
  );
}

function ProgrammesTab({
  list,
  query,
  country,
  status,
  page,
  perPage,
  onQuery,
  onCountry,
  onStatus,
  onPage,
  onPerPage,
  onOpen,
}: {
  list: UseQueryResult<ProgrammeListResult>;
  query: string;
  country: string;
  status: string;
  page: number;
  perPage: number;
  onQuery: (v: string) => void;
  onCountry: (v: string) => void;
  onStatus: (v: string) => void;
  onPage: (n: number) => void;
  onPerPage: (n: number) => void;
  onOpen: (programmeId: string) => void;
}) {
  const [confirmArchive, setConfirmArchive] = useState<ProgrammeRow | null>(null);
  const archive = useArchiveProgramme();
  const duplicate = useDuplicateProgramme();

  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const staleAfterDays = list.data?.staleAfterDays ?? 30;

  // Every destination in the catalogue, not the ones on this page. Built from
  // the rows on screen this dropdown could not offer the value you were
  // looking for.
  const countryOptions = [
    { value: "", label: "All countries" },
    ...(list.data?.countries ?? []).map((code) => ({
      value: code,
      label: COUNTRY_BY_CODE[code]?.name ?? code,
    })),
  ];

  const pages = Math.max(1, Math.ceil(total / perPage));
  const from = page * perPage;

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
            onChange={(e) => onQuery(e.target.value)}
          />
        </div>

        <Select
          className="w-[190px]"
          value={country}
          options={countryOptions}
          ariaLabel="Filter by country"
          onChange={onCountry}
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
            // Archived rows are hidden by default. Without a way to ask for
            // them, an archived programme is one nobody can ever restore.
            { value: "archived", label: "Archived" },
          ]}
          onChange={onStatus}
        />

        {query || country || status ? (
          <button
            type="button"
            className="console-btn"
            data-variant="secondary"
            onClick={() => {
              onQuery("");
              onCountry("");
              onStatus("");
            }}
          >
            <SlidersIcon size={15} />
            Clear filters
          </button>
        ) : null}

        <span className="console-meta ml-auto">
          {list.isPending ? "Reading the catalogue…" : `${total} programmes`}
        </span>
      </div>

      {/* A failed read must not look like an empty catalogue. CLAUDE.md:
          prefer failing loudly over degrading gracefully — "no programmes" is
          a different claim from "we could not ask". */}
      {list.isError ? (
        <div className="console-notice" data-tone="danger">
          {(list.error as Error).message}
        </div>
      ) : null}

      <div className="console-table-wrap">
        <table className="console-table">
          <thead>
            <tr>
              <th scope="col">Programme</th>
              <th scope="col">Institution</th>
              <th scope="col">Country</th>
              <th scope="col">Tuition</th>
              <th scope="col">Next deadline</th>
              <th scope="col">Last verified</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((programme) => {
              const state = rowStatus(programme, staleAfterDays);
              return (
                <tr
                  key={programme.id}
                  data-clickable="true"
                  onClick={() => onOpen(programme.id)}
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
                      <span className="min-w-0">
                        {programme.institution ?? "—"}
                      </span>
                    </span>
                  </td>
                  <td>
                    <span className="flex items-center gap-2">
                      <span className="console-flag" aria-hidden="true">
                        {programme.country
                          ? (COUNTRY_BY_CODE[programme.country]?.flag ?? "🏳")
                          : "🏳"}
                      </span>
                      {/* The name, not the code. Nobody reads "LK" and thinks
                          Sri Lanka on the first pass. */}
                      {programme.country
                        ? (COUNTRY_BY_CODE[programme.country]?.name ??
                          programme.country)
                        : "—"}
                    </span>
                  </td>
                  <td>
                    {programme.tuition_per_year_minor === null ||
                    !programme.currency
                      ? "—"
                      : formatMinorUnits(
                          programme.tuition_per_year_minor,
                          programme.currency,
                        )}
                  </td>
                  {/* The next intake still OPEN. Once every intake has passed
                      there is no date to act on, and showing last year's would
                      be worse than saying so. */}
                  <td>
                    {programme.next_deadline ? (
                      <>
                        {formatDate(programme.next_deadline)}
                        <div className="console-cell-sub">
                          {programme.next_intake}
                        </div>
                      </>
                    ) : (
                      <span className="console-meta">No open intake</span>
                    )}
                  </td>
                  {/* The date in words, not a bare timestamp: "5 weeks ago" is
                      the thing somebody acts on. */}
                  <td className="console-meta">
                    {programme.verified_at
                      ? verifiedLabel(programme.verified_at, staleAfterDays)
                      : "Never"}
                    {programme.edited_since_verified ? (
                      <div className="console-cell-sub">
                        edited since
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <span
                      className="console-lead-status"
                      data-status={
                        state === "active" ? "converted" : "escalated"
                      }
                    >
                      {STATUS_LABEL[state]}
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
                          onSelect: () => onOpen(programme.id),
                        },
                        {
                          label: "Duplicate",
                          onSelect: () => {
                            duplicate.mutate(programme.id, {
                              onSuccess: (copy) => onOpen(copy.id),
                            });
                          },
                        },
                        {
                          // Archive, not delete. The row is kept because past
                          // tool_calls name it.
                          label: "Archive",
                          danger: true,
                          onSelect: () => setConfirmArchive(programme),
                        },
                      ]}
                    />
                  </td>
                </tr>
              );
            })}

            {rows.length === 0 && !list.isPending && !list.isError ? (
              <tr>
                <td colSpan={8}>
                  <p className="console-empty m-0 py-6 text-center">
                    {query || country || status
                      ? "No programmes match these filters."
                      : "No programmes yet. Add one to get started."}
                  </p>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="console-pager">
        <span className="console-meta">
          {total === 0
            ? "Nothing to show"
            : `Showing ${from + 1}–${Math.min(from + perPage, total)} of ${total} programmes`}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className="console-page-btn"
            aria-label="Previous page"
            disabled={page === 0}
            onClick={() => onPage(page - 1)}
          >
            ‹
          </button>
          {Array.from({ length: pages }, (_, i) => (
            <button
              key={i}
              type="button"
              className="console-page-btn"
              aria-label={`Page ${i + 1}`}
              aria-current={i === page ? "true" : undefined}
              onClick={() => onPage(i)}
            >
              {i + 1}
            </button>
          ))}
          <button
            type="button"
            className="console-page-btn"
            aria-label="Next page"
            disabled={page >= pages - 1}
            onClick={() => onPage(page + 1)}
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
          onChange={(v) => onPerPage(Number(v))}
        />
      </div>

      <Dialog
        open={confirmArchive !== null}
        onOpenChange={(open) => !open && setConfirmArchive(null)}
        title="Archive this programme?"
        description={
          confirmArchive
            ? `${confirmArchive.name} — ${confirmArchive.institution ?? "no institution"}. The agent will stop matching students against it.`
            : undefined
        }
        footer={
          <>
            <button
              type="button"
              className="console-btn"
              data-variant="secondary"
              onClick={() => setConfirmArchive(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="console-btn"
              data-variant="primary"
              style={{ background: "var(--c-danger)" }}
              disabled={archive.isPending}
              onClick={() => {
                if (confirmArchive) archive.mutate(confirmArchive.id);
                setConfirmArchive(null);
              }}
            >
              {archive.isPending ? "Archiving…" : "Archive"}
            </button>
          </>
        }
      >
        {/* Said plainly, because "Delete" is what the button used to say and
            somebody who believes the row is gone will not look for it. */}
        <p className="console-hint m-0">
          Nothing is deleted. Past shortlists name this programme and the
          dashboard rebuilds them from that record, so the row stays in the
          database — it leaves this table, and the Archived filter brings it
          back.
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
/** The least a row needs to be drawn as a rule.
 *
 * Structural rather than `Requirement`, because two callers hold two shapes:
 * the fixture's `Requirement` (with `requirement_id`) and the catalogue
 * API's, whose key is `fact_key` and whose id is a uuid. Widening the prop
 * beats converting one into the other at each call site and beats a second
 * copy of this grid.
 */
export interface RuleRow {
  requirement_id?: string;
  key: string;
  rule: string;
  description: string;
}

export function RuleGrid({
  requirements,
  onRemove,
}: {
  requirements: readonly RuleRow[];
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
