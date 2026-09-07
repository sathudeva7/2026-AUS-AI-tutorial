/** Organic primitives.
 *
 * Thin wrappers over the component classes in styles/organic.css — `.btn`,
 * `.input`, `.card`, `.tag`, `.table`, `.field`. They exist so a component
 * writes `<Button variant="primary">` instead of remembering which of five
 * class names goes with which, not to introduce a second styling system on
 * top of the first. If a rule belongs to the design system, it goes in
 * organic.css and this file just names it.
 */
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "ghost";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Square 36×36 icon button. */
  icon?: boolean;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant = "secondary", icon, block, className, type, ...rest },
    ref,
  ) {
    return (
      <button
        ref={ref}
        // Buttons inside forms default to submit, which reloads the page.
        // Every button here is an action unless a caller says otherwise.
        type={type ?? "button"}
        className={cn(
          "btn",
          `btn-${variant}`,
          icon && "btn-icon",
          block && "btn-block",
          className,
        )}
        {...rest}
      />
    );
  },
);

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  elevation?: "sm" | "md" | "lg" | "none";
}

export function Card({
  elevation = "sm",
  className,
  ...rest
}: CardProps) {
  return (
    <div
      className={cn(
        "card",
        elevation !== "none" && `elev-${elevation}`,
        className,
      )}
      {...rest}
    />
  );
}

/** The 10.5px uppercase label that opens almost every card in the console. */
export function Kicker({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("kicker", className)}>{children}</div>;
}

/** A card heading in the display face. */
export function CardTitle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("font-heading text-[17px] leading-tight", className)}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tag / Chip
// ---------------------------------------------------------------------------

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: "accent" | "accent-2" | "neutral" | "outline" | "custom";
  /** For verdict and status chips, whose colours are computed. */
  background?: string;
  foreground?: string;
}

export function Tag({
  tone = "neutral",
  background,
  foreground,
  className,
  style,
  ...rest
}: TagProps) {
  const custom: CSSProperties | undefined =
    background || foreground
      ? { background, color: foreground, ...style }
      : style;
  return (
    <span
      className={cn("tag", tone !== "custom" && `tag-${tone}`, className)}
      style={custom}
      {...rest}
    />
  );
}

/** A status chip: uppercase, letter-spaced, colour-carried but never
 *  colour-only — the word is always present. */
export function StatusChip({
  label,
  background,
  foreground,
  className,
}: {
  label: string;
  background: string;
  foreground: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill px-[9px] py-[3px] text-[10px] uppercase tracking-[0.05em]",
        className,
      )}
      style={{ background, color: foreground }}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------

export function Field({
  label,
  hint,
  hintTone,
  error,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: string;
  hintTone?: "muted" | "warning";
  /** A validation message for THIS field. Takes the hint's place while set,
   *  so the guidance and the complaint never stack up under one input, and is
   *  announced (role="alert") rather than only coloured. */
  error?: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  const message = error ?? hint;
  const tone = error ? "warning" : hintTone;
  return (
    <div className={cn("field", className)}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {message ? (
        <div
          className={cn(
            "mt-1 text-[11.5px]",
            error && "flex items-start gap-1.5 font-semibold",
          )}
          role={error ? "alert" : undefined}
          id={error && htmlFor ? `${htmlFor}-error` : undefined}
          style={{
            color: error
              ? "var(--color-danger)"
              : tone === "warning"
                ? "var(--color-accent-800)"
                : "var(--color-neutral-700)",
          }}
        >
          {/* Colour alone is not a signal — it is invisible to anyone who
              cannot distinguish it. The mark and the weight carry the meaning
              too, so the message still reads as a failure in greyscale. */}
          {error ? <AlertMark /> : null}
          <span>{message}</span>
        </div>
      ) : null}
    </div>
  );
}

function AlertMark() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="mt-px flex-none"
    >
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path
        d="M8 4.4v4.2M8 11.2v.6"
        stroke="var(--color-neutral-100)"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cn("input", className)} {...rest} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn("input", className)} {...rest} />;
});

/** A read-only value rendered in an input's shape. The catalogue's rule grid
 *  uses these: the rows are data the editor owns, not free text. */
export function ReadonlyValue({
  children,
  className,
  muted,
  title,
}: {
  children: ReactNode;
  className?: string;
  muted?: boolean;
  title?: string;
}) {
  return (
    <div
      className={cn("input truncate text-[12.5px]", className)}
      title={title}
      style={muted ? { color: "var(--color-neutral-700)" } : undefined}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pill toggles — the multi-select and single-select rows the console uses in
// place of checkboxes and native selects.
// ---------------------------------------------------------------------------

export function Pill({
  label,
  selected,
  onClick,
  disabled,
  role = "button",
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
  /** "checkbox" for multi-select groups, "radio" for single-select. */
  role?: "button" | "checkbox" | "radio";
}) {
  const ariaProps =
    role === "button"
      ? { "aria-pressed": selected }
      : { "aria-checked": selected };
  return (
    <button
      type="button"
      role={role}
      {...ariaProps}
      disabled={disabled}
      onClick={onClick}
      className="cursor-pointer rounded-pill border px-[13px] py-[6px] font-body text-[12px] disabled:cursor-not-allowed disabled:opacity-45"
      style={{
        background: selected
          ? "var(--color-accent-2-200)"
          : "var(--color-neutral-100)",
        color: selected ? "var(--color-accent-2-800)" : "var(--color-text)",
        borderColor: selected
          ? "var(--color-accent-2-500)"
          : "var(--color-divider)",
      }}
    >
      {label}
    </button>
  );
}

/** A switch. `locked` renders it on and inert, for a permission that is not
 *  negotiable — a counsellor cannot advise on a conversation they cannot
 *  read, so transcript access has no off state. */
export function Toggle({
  on,
  onToggle,
  label,
  locked,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
  locked?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-disabled={locked || undefined}
      onClick={() => !locked && onToggle()}
      className={cn(
        "relative h-5 w-[34px] shrink-0 rounded-pill border-0 p-0",
        locked ? "cursor-default" : "cursor-pointer",
      )}
      style={{
        background: on
          ? "var(--color-accent-2-500)"
          : "var(--color-neutral-400)",
      }}
    >
      <span
        className="absolute top-[2px] h-4 w-4 rounded-pill transition-[left] duration-150"
        style={{
          left: on ? "16px" : "2px",
          background: "var(--color-neutral-100)",
        }}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Progress bar — caseload, availability.
// ---------------------------------------------------------------------------

export function ProgressBar({
  percent,
  colour,
  label,
}: {
  percent: number;
  colour: string;
  label: string;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div
      className="h-2 overflow-hidden rounded-pill"
      style={{ background: "var(--color-neutral-300)" }}
      role="meter"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className="h-full rounded-pill"
        style={{ width: `${clamped}%`, background: colour }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export function Table({
  head,
  children,
  className,
}: {
  head: ReactNode[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <table className={cn("table", className)}>
      <thead>
        <tr>
          {head.map((cell, i) => (
            <th key={i} scope="col">
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

export { Select } from "./Select";
export type { SelectOption } from "./Select";
