/** The line icons the console uses.
 *
 * Hand-rolled rather than a dependency. This is two dozen glyphs; the smallest
 * icon package that covers them is an order of magnitude more code than this
 * file, and every one of them would still need the same `aria-hidden` and
 * `currentColor` discipline applied at the call site.
 *
 * Shared rather than per-feature: it started beside the roster, and the moment
 * the app shell needed a search glyph too, a second copy would have been a
 * second set of proportions on one screen.
 *
 * All of them are decorative: an icon here sits beside a label that already
 * says the thing, so none is ever the only carrier of meaning. That is why
 * `aria-hidden` is baked in rather than left to the caller to remember.
 */
interface IconProps {
  /** Pixel size, square. Defaults to 16 — the size beside a line of body text. */
  size?: number;
  className?: string;
}

function svgProps({ size = 16, className }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
    focusable: false as const,
  };
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

/** Three sliders. The conventional "there are more filters behind this". */
export function SlidersIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M4 7h10M18 7h2M4 12h4M12 12h8M4 17h9M17 17h3" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="15" cy="17" r="2" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5M12 16h.01" />
    </svg>
  );
}

export function PersonIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 19.5a7 7 0 0114 0" />
    </svg>
  );
}

export function MailIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="M3.5 7l8.5 6 8.5-6" />
    </svg>
  );
}

export function PhoneIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M7.5 3.5h-2A2.5 2.5 0 003 6c0 8.3 6.7 15 15 15a2.5 2.5 0 002.5-2.5v-2l-4.5-1.5-2 2.5a15.5 15.5 0 01-6.5-6.5L9.5 9 8 4.5z" />
    </svg>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.2l3.2 2" />
    </svg>
  );
}

export function GlobeIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.2 9.5h17.6M3.2 14.5h17.6" />
      <path d="M12 3c-2.4 2.6-3.6 5.6-3.6 9s1.2 6.4 3.6 9c2.4-2.6 3.6-5.6 3.6-9S14.4 5.6 12 3z" />
    </svg>
  );
}

export function PeopleIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <circle cx="9.5" cy="8" r="3.2" />
      <path d="M3.5 19a6 6 0 0112 0" />
      <path d="M16.5 5.2a3.2 3.2 0 010 5.6M17.5 13.4A6 6 0 0121 19" />
    </svg>
  );
}

export function InboxIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M3.5 13h4l1.5 2.5h6L16.5 13h4" />
      <path d="M5.8 4.5h12.4l2.3 8.5v4a2 2 0 01-2 2H5.5a2 2 0 01-2-2v-4z" />
    </svg>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
    </svg>
  );
}

export function PencilIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M4 20h4l10-10a2.8 2.8 0 10-4-4L4 16z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M14.5 5.5L8 12l6.5 6.5" />
    </svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M9.5 5.5L16 12l-6.5 6.5" />
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Navigation and chrome
 * ------------------------------------------------------------------ */

/** Four panes. The conventional "overview" glyph. */
export function GridIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
    </svg>
  );
}

/** The student widget: a chat bubble, because that is what a student sees. */
export function ChatIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M20.5 12.2c0 4-3.8 7.2-8.5 7.2a9.8 9.8 0 01-2.7-.4L4.5 20.5l1.2-3.6a6.9 6.9 0 01-2.2-4.9c0-4 3.8-7.2 8.5-7.2s8.5 3.2 8.5 7.4z" />
    </svg>
  );
}

/** The assistant: a spark, not a robot. It answers across leads; it is not a
 *  second agent with a face. */
export function SparkIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
      <path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
    </svg>
  );
}

/** The catalogue: an institution, since every programme hangs off one. */
export function InstitutionIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M3.5 9.5L12 5l8.5 4.5" />
      <path d="M5.5 10.5v7M9.5 10.5v7M14.5 10.5v7M18.5 10.5v7" />
      <path d="M3.5 19.5h17" />
    </svg>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 14.5a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5v.2a2 2 0 01-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 010-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 014 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1h.2a2 2 0 010 4h-.1a1.6 1.6 0 00-1.5 1z" />
    </svg>
  );
}

/** The mortarboard on the sidebar card. */
export function GraduationIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)}>
      <path d="M2.5 8.5L12 4.5l9.5 4-9.5 4z" />
      <path d="M6.5 10.5v4.7c0 1.4 2.5 2.6 5.5 2.6s5.5-1.2 5.5-2.6v-4.7" />
      <path d="M21.5 8.5v5" />
    </svg>
  );
}
