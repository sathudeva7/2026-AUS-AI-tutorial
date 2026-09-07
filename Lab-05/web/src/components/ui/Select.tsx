/** A listbox that looks like the rest of the system.
 *
 * A native <select> cannot be styled past its border — the option list is
 * drawn by the operating system, so it arrives in the OS font and the OS
 * colours no matter what the page does. That is why this exists.
 *
 * What a native select DOES give you for free is type-ahead, keyboard
 * navigation and scroll-into-view. Replacing it without those would look
 * better and work worse, especially on a 242-country list — so they are
 * reimplemented here rather than dropped:
 *
 *   type to filter        a search box, focused on open
 *   ArrowDown / ArrowUp   move the active option, wrapping at the ends
 *   Home / End            first / last
 *   Enter                 choose the active option
 *   Escape                close without choosing
 *   click outside         same
 *
 * The trigger reuses `.input` so it lines up with real inputs beside it.
 */
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

/** Fold to something a person would plausibly type: lowercase, accents
 *  stripped, and everything that is not a letter or digit removed — so
 *  spaces, hyphens, apostrophes and dots all stop being obstacles. */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export interface SelectOption {
  value: string;
  label: string;
  /** Rendered before the label in both the trigger and the list — a flag, a
   *  swatch, a status dot. */
  prefix?: ReactNode;
  /** Trailing detail, dimmed. Also searched. */
  detail?: string;
  /** Extra text to match on that is never displayed — an ISO code, an alias,
   *  a former name. Without it, a list whose visible detail is "+94" cannot
   *  be found by typing "LK". */
  keywords?: string;
}

export function Select({
  value,
  options,
  onChange,
  placeholder = "Select…",
  disabled = false,
  invalid = false,
  searchable = true,
  ariaLabel,
  className,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  /** Filter box. Pointless below a dozen options, essential above thirty. */
  searchable?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const wrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  // Normalised on both sides before comparing, which is what makes "srila"
  // find "Sri Lanka" and "cote" find "Côte d'Ivoire". A plain substring test
  // fails both: the space and the accent are in the haystack but not in what
  // anyone types.
  const haystacks = useMemo(
    () =>
      options.map(
        (o) =>
          `${normalise(o.label)} ${normalise(o.value)} ${normalise(o.detail ?? "")} ${normalise(o.keywords ?? "")}`,
      ),
    [options],
  );

  const filtered = useMemo(() => {
    const q = normalise(query);
    if (!q) return options;
    return options.filter((_, i) => haystacks[i].includes(q));
  }, [options, haystacks, query]);

  // Open on the current selection rather than at the top: a list of 242 with
  // "Sri Lanka" chosen should not open at Afghanistan.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    const i = options.findIndex((o) => o.value === value);
    setActive(i >= 0 ? i : 0);
    searchRef.current?.focus();
  }, [open, options, value]);

  // Keep the active option visible while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function choose(i: number) {
    const opt = filtered[i];
    if (!opt) return;
    onChange(opt.value);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % Math.max(filtered.length, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + filtered.length) % Math.max(filtered.length, 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(filtered.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(active);
    }
  }

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <button
        type="button"
        className="input flex items-center gap-2 text-left"
        style={invalid ? { borderColor: "var(--color-danger)" } : undefined}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-label={ariaLabel}
        aria-invalid={invalid}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
      >
        {selected?.prefix ? <span aria-hidden="true">{selected.prefix}</span> : null}
        <span
          className="flex-1 truncate"
          style={
            selected ? undefined : { color: "var(--color-neutral-600)" }
          }
        >
          {selected ? selected.label : placeholder}
        </span>
        {selected?.detail ? (
          <span className="text-[12px]" style={{ color: "var(--color-neutral-600)" }}>
            {selected.detail}
          </span>
        ) : null}
        <Chevron open={open} />
      </button>

      {open ? (
        <div
          className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-md"
          style={{
            background: "var(--color-neutral-100)",
            border: "1px solid var(--color-divider)",
            boxShadow: "0 10px 30px var(--color-shadow, rgba(46,43,37,0.16))",
          }}
        >
          {searchable ? (
            <div className="p-2" style={{ borderBottom: "1px solid var(--color-divider)" }}>
              <input
                ref={searchRef}
                className="input"
                style={{ minHeight: 32 }}
                placeholder="Type to filter…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
              />
            </div>
          ) : null}

          <ul
            ref={listRef}
            id={`${id}-list`}
            role="listbox"
            className="m-0 max-h-[240px] list-none overflow-y-auto p-1"
          >
            {filtered.length === 0 ? (
              <li
                className="px-3 py-2 text-[13px]"
                style={{ color: "var(--color-neutral-600)" }}
              >
                Nothing matches “{query}”.
              </li>
            ) : (
              filtered.map((o, i) => {
                const isActive = i === active;
                const isSelected = o.value === value;
                return (
                  <li
                    key={o.value}
                    data-idx={i}
                    role="option"
                    aria-selected={isSelected}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px]"
                    style={{
                      background: isActive
                        ? "var(--color-accent-100)"
                        : "transparent",
                      color: isSelected
                        ? "var(--color-accent-800)"
                        : "var(--color-text)",
                      fontWeight: isSelected ? 600 : 400,
                    }}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => {
                      // mousedown, not click: the outside-click handler fires
                      // on mousedown and would close before click landed.
                      e.preventDefault();
                      choose(i);
                    }}
                  >
                    {o.prefix ? <span aria-hidden="true">{o.prefix}</span> : null}
                    <span className="flex-1 truncate">{o.label}</span>
                    {o.detail ? (
                      <span
                        className="text-[12px]"
                        style={{ color: "var(--color-neutral-600)" }}
                      >
                        {o.detail}
                      </span>
                    ) : null}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
      style={{
        flex: "none",
        color: "var(--color-neutral-600)",
        transform: open ? "rotate(180deg)" : undefined,
        transition: "transform 120ms ease",
      }}
    >
      <path
        d="M2.5 4.5 6 8l3.5-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
