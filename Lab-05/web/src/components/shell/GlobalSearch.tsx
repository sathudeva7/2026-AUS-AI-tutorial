/** Search across the three things this console holds records of.
 *
 * Counsellors, programmes and leads. Those are the surfaces that exist, so
 * those are the surfaces searched — the reference design's placeholder reads
 * "students, applications, universities" and two of those three are not
 * things the product has. A box that offers to find applications would be the
 * one control on screen that lies about what the app contains.
 *
 * Every result links somewhere real: a counsellor to their record, a
 * programme to its editor, a lead to its dashboard. Nothing is listed that
 * cannot be opened.
 *
 * The three reads are gated behind `enabled` until the box is first focused.
 * Mounted in the shell, they would otherwise fetch the roster, the catalogue
 * and the lead book on every route in the app, including the student widget,
 * to populate a dropdown most visits never open.
 */
import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { SearchIcon } from "@/components/ui/icons";
import { repo } from "@/data/repo";
import { leadsKeyRoot, usersKeys } from "@/features/users/keys";
import { listUsers } from "@/features/users/api";
import { countryNames, displayName } from "@/features/users/display";

interface Hit {
  id: string;
  group: string;
  title: string;
  detail: string;
  to: string;
}

/** Fold to something a person would plausibly type: lowercase, accents
 *  stripped. The same normalisation `Select` uses, for the same reason —
 *  "Cote" should find "Côte d'Ivoire". */
function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

const PER_GROUP = 4;

export function GlobalSearch() {
  const navigate = useNavigate();
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // Flipped on first focus and never back. Until then the shell fetches
  // nothing on behalf of a dropdown nobody has opened.
  const [armed, setArmed] = useState(false);

  // The roster with no status filter, matching what CounsellorsRoute asks for
  // by default, so opening search on the roster page is a cache hit.
  const users = useQuery({
    queryKey: usersKeys.list({}),
    queryFn: () => listUsers({}),
    enabled: armed,
  });
  const programmes = useQuery({
    queryKey: ["catalogue", "programmes"],
    queryFn: () => repo.listProgrammes(),
    enabled: armed,
  });
  const leads = useQuery({
    queryKey: leadsKeyRoot,
    queryFn: () => repo.listLeads(),
    enabled: armed,
  });

  const needle = fold(query.trim());
  const hits: Hit[] = needle
    ? [
        ...(users.data?.users ?? [])
          .filter((u) =>
            [u.name, u.email, ...u.countries].some(
              (f) => f && fold(f).includes(needle),
            ),
          )
          .slice(0, PER_GROUP)
          .map((u) => ({
            id: `user-${u.id}`,
            group: "Counsellors",
            title: displayName(u),
            detail: u.countries.length
              ? countryNames(u.countries)
              : "No countries",
            to: `/counsellors/${u.id}`,
          })),
        ...(programmes.data ?? [])
          .filter((p) =>
            [p.name, p.institution, p.country, p.city, p.field].some((f) =>
              fold(f).includes(needle),
            ),
          )
          .slice(0, PER_GROUP)
          .map((p) => ({
            id: `programme-${p.programme_id}`,
            group: "Programmes",
            title: p.name,
            detail: `${p.institution} · ${p.country}`,
            to: `/catalogue/${p.programme_id}`,
          })),
        ...(leads.data ?? [])
          .filter((l) =>
            [l.name, l.email, l.country_of_residence].some(
              (f) => f && fold(f).includes(needle),
            ),
          )
          .slice(0, PER_GROUP)
          .map((l) => ({
            id: `lead-${l.lead_id}`,
            group: "Leads",
            title: l.name ?? l.email,
            detail: l.country_of_residence ?? l.email,
            to: `/leads/${l.lead_id}`,
          })),
      ]
    : [];

  // Clamped rather than reset, so typing another letter does not throw away
  // the caller's place in a list that mostly did not change.
  const activeIndex = Math.min(active, Math.max(hits.length - 1, 0));

  useEffect(() => {
    function onDocumentPointerDown(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onDocumentPointerDown);
    return () =>
      document.removeEventListener("pointerdown", onDocumentPointerDown);
  }, []);

  function choose(hit: Hit) {
    navigate(hit.to);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!hits.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (i + 1) % hits.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (i - 1 + hits.length) % hits.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(hits[activeIndex]);
    }
  }

  const showing = open && Boolean(needle);

  return (
    <div className="console-topsearch" ref={wrapRef}>
      <SearchIcon size={16} className="console-search-icon" />
      <input
        className="console-input"
        type="search"
        value={query}
        placeholder="Search counsellors, programmes, leads…"
        aria-label="Search the console"
        role="combobox"
        aria-expanded={showing}
        aria-controls={listId}
        aria-autocomplete="list"
        onFocus={() => {
          setArmed(true);
          setOpen(true);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />

      {showing ? (
        <div className="console-results" id={listId} role="listbox">
          {hits.length === 0 ? (
            <p className="console-meta m-0 px-3 py-3">
              {users.isPending || programmes.isPending || leads.isPending
                ? "Searching…"
                : `Nothing matches “${query.trim()}”.`}
            </p>
          ) : (
            hits.map((hit, i) => (
              <button
                key={hit.id}
                type="button"
                role="option"
                aria-selected={i === activeIndex}
                className="console-result"
                data-active={i === activeIndex ? "true" : undefined}
                // pointerdown, not click: the input's blur would close the
                // dropdown before a click ever landed on the row.
                onPointerDown={(e) => {
                  e.preventDefault();
                  choose(hit);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="min-w-0 flex-1">
                  <span className="console-result-title truncate">
                    {hit.title}
                  </span>
                  <span className="console-result-detail truncate">
                    {hit.detail}
                  </span>
                </span>
                {/* The group on every row rather than as a sticky header.
                    Results are few and mixed; a header for one row costs more
                    lines than it saves. */}
                <span className="console-result-group flex-none">
                  {hit.group}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
