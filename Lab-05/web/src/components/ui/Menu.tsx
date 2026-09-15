/** A small dropdown menu, for the ··· at the end of a row.
 *
 * Hand-rolled rather than adding `@radix-ui/react-dropdown-menu`. Only the
 * dialog primitive is installed today, and this needs a fraction of what a
 * menu package brings: no submenus, no checkable items, no typeahead.
 *
 * What it does keep is the part people notice when it is missing — Escape
 * closes, a click outside closes, arrow keys move, Enter chooses, and focus
 * returns to the trigger afterwards so the keyboard does not get dumped at
 * the top of the page.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  /** Renders in the danger colour and sits below a divider. */
  danger?: boolean;
}

export function Menu({
  items,
  label,
  trigger,
}: {
  items: MenuItem[];
  /** Accessible name for the trigger — "Actions for MSc Data Science", not
   *  "Actions", because a table of fifteen rows otherwise has fifteen
   *  identically named buttons. */
  label: string;
  trigger: ReactNode;
}) {
  const id = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function close({ restoreFocus = true } = {}) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  function choose(item: MenuItem) {
    // Close BEFORE running the action. Several of these navigate or open a
    // dialog, and a menu still mounted over the thing it just opened is both
    // a focus trap and a visual one.
    close({ restoreFocus: false });
    item.onSelect();
  }

  return (
    <div className="console-menu" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className="console-icon-btn"
        data-variant="ghost"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          setActive(0);
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "Enter") {
            e.preventDefault();
            setActive(0);
            setOpen(true);
          }
        }}
      >
        {trigger}
      </button>

      {open ? (
        <div className="console-menu-list" id={id} role="menu">
          {items.map((item, i) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="console-menu-item"
              data-danger={item.danger ? "true" : undefined}
              data-active={i === active ? "true" : undefined}
              // autoFocus on the active item so the keyboard lands inside the
              // menu rather than staying on the trigger behind it.
              autoFocus={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(item)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  close();
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => (a + 1) % items.length);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => (a - 1 + items.length) % items.length);
                }
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
