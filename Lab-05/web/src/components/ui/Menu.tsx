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
 *
 * THE LIST IS `position: fixed`, and that is not decoration. The table it
 * sits in is `min-width: 1000px` inside a wrapper with `overflow-x: auto`,
 * and CSS turns the other axis to `auto` along with it — one scrollable
 * axis makes both scrollable. An absolutely positioned list was therefore
 * clipped by the wrapper, worst on the LAST row, where the menu opens
 * downward into nothing. A fixed box is laid out against the viewport, so
 * no `overflow` ancestor clips it; the cost is that its position has to be
 * measured rather than inherited, which is what `place` below does.
 *
 * NOT A PORTAL, which is where this went first and why it is worth saying.
 * `document.body` is outside the `.console` subtree, and console.css is
 * explicit that the design tokens live on `.console` and nothing outside it
 * is styled. The portalled list lost `--c-card`, came out with no
 * background at all, and the table showed straight through it. Fixed
 * positioning alone does the whole job — it escapes `overflow` without
 * leaving the subtree — and it only fails under an ancestor with a
 * `transform`, `filter`, `contain` or `will-change`, none of which this
 * table has.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/** Gap between the trigger and the list, and the margin kept from the
 *  window edge when the list has to flip. */
const GAP = 4;

interface Position {
  top: number;
  left: number;
}

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
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [at, setAt] = useState<Position | null>(null);

  /** Put the list under the trigger, or above it when the window is short.
   *
   * Viewport coordinates, because the list is `position: fixed`. The flip
   * tests the WINDOW, not the table: nothing clips a fixed box, so what is
   * left is the ordinary problem of a menu near the bottom of the screen. */
  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const box = trigger.getBoundingClientRect();
    const height = listRef.current?.offsetHeight ?? 0;
    const width = listRef.current?.offsetWidth ?? 0;

    const below = box.bottom + GAP;
    const flip = height > 0 && below + height > window.innerHeight - GAP;

    setAt({
      top: flip ? Math.max(GAP, box.top - GAP - height) : below,
      // Right-aligned to the trigger: the ··· sits at the end of the row
      // and the list hangs back under it rather than off the edge.
      left: Math.max(
        GAP,
        Math.min(box.right - width, window.innerWidth - GAP - width),
      ),
    });
  }, []);

  /** Close, and forget where the list was.
   *
   * One function rather than a bare `setOpen(false)` in four places, because
   * a stale position is a visible bug: reopening the menu would paint it at
   * the last row's coordinates for one frame before the measurement caught
   * up. Clearing it here keeps the list hidden until it has been placed. */
  const dismiss = useCallback(() => {
    setOpen(false);
    setAt(null);
  }, []);

  // Layout effect, not effect: measure and place before the browser paints,
  // or the list is visible for one frame at the top-left of the window.
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  /** Put the keyboard inside the menu, once there is a menu to put it in.
   *
   * This was `autoFocus` on the active item, which stopped working the
   * moment the list began life `visibility: hidden` — a hidden element
   * cannot take focus, the call was dropped, and focus stayed on the
   * trigger behind. Escape and the arrow keys are handled by the item that
   * has focus, so the whole keyboard story went with it.
   *
   * Keyed on `at`, not on `active`: `active` is always 0 when the menu
   * opens, and moving the highlight with the arrow keys must not drag focus
   * along with it — which is what `autoFocus`-on-mount did too. */
  useLayoutEffect(() => {
    if (!open || !at) return;
    listRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
      ?.focus();
  }, [open, at]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) dismiss();
    }
    // A fixed list does not travel with the row it belongs to, so it is
    // re-measured whenever anything moves. Capture, because the scroller is
    // the table wrapper and its scroll event does not bubble to the window.
    //
    // NOT closed on scroll, which is what this did first. Anything that
    // brings an element into view fires a scroll — including the browser's
    // own scrollIntoView when a click targets the menu — so closing here
    // tore the list out from under the click that was choosing from it.
    // Following the row is also the better behaviour: the menu belongs to a
    // row, and a row that moves should take its menu with it.
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, dismiss, place]);

  function close({ restoreFocus = true } = {}) {
    dismiss();
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
          if (open) {
            dismiss();
            return;
          }
          setActive(0);
          setOpen(true);
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
        <div
          ref={listRef}
          className="console-menu-list"
          id={id}
          role="menu"
          // On the list as well as on each item. An item only sees the key
          // when it has focus, and the list is the one thing guaranteed to
          // be an ancestor of whatever does.
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
          }}
          // Hidden until measured. One frame at 0,0 is a flash in the
          // corner of the screen that people notice.
          style={{
            top: at?.top ?? 0,
            left: at?.left ?? 0,
            visibility: at ? undefined : "hidden",
          }}
        >
          {items.map((item, i) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="console-menu-item"
              data-danger={item.danger ? "true" : undefined}
              data-active={i === active ? "true" : undefined}
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
