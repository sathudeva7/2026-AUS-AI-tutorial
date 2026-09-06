/** Clerk's prebuilt components, dressed in the Organic design system.
 *
 * Clerk owns the markup for sign-in, sign-up and organization creation. It
 * handles verification codes, OAuth round-trips, breached-password checks and
 * bot protection — all things that are tedious and easy to get subtly wrong
 * by hand. What we control is how it looks, through `appearance`.
 *
 * ── Why there are literal hex values here ──────────────────────────────────
 * Everywhere else in this codebase, colour comes from `var(--color-*)` in
 * styles/organic.css, and CLAUDE.md forbids hard-coding a hex the tokens
 * carry. This file is the documented exception, for a mechanical reason:
 * Clerk derives whole tonal ramps from `colorPrimary` (hover, active,
 * disabled), which means it has to PARSE the value. Hand it `var(--…)` and it
 * cannot read a colour to scale, so the derived states break.
 *
 * These values are copied from organic.css and must be kept in step with it.
 * If a token changes there, change it here. There is no way around the
 * duplication short of dropping Clerk's components.
 */
import type { ClerkProviderProps } from "@clerk/react";

/** Clerk does not export `Appearance` from the package root, and reaching
 *  into its internal type files would break on any patch release. Deriving
 *  from the provider's own prop keeps this correct by construction. */
type Appearance = NonNullable<ClerkProviderProps["appearance"]>;

const organic = {
  bg: "#f5ead8",
  surface: "#ebddc5",
  text: "#201e1d",
  accent: "#c67139",
  accent600: "#b2622d",
  accent700: "#8c491a",
  accent2_600: "#728157",
  neutral100: "#f9f4ed",
  neutral200: "#eee7db",
  neutral700: "#645c50",
  // --color-divider is color-mix(#201e1d 16%, transparent); Clerk needs a
  // parseable colour, so it is written out as rgba.
  divider: "rgba(32, 30, 29, 0.16)",
  shadow: "rgba(46, 43, 37, 0.16)",
} as const;

export const clerkAppearance: Appearance = {
  variables: {
    colorPrimary: organic.accent,
    colorPrimaryForeground: organic.bg,
    colorBackground: organic.neutral100,
    colorForeground: organic.text,
    colorMuted: organic.neutral200,
    colorMutedForeground: organic.neutral700,
    colorInput: organic.surface,
    colorInputForeground: organic.text,
    colorBorder: organic.divider,
    colorRing: organic.accent,
    colorShadow: organic.shadow,
    // Organic has no red. Terracotta already carries "attention" across the
    // console — the escalation banner, the stale-catalogue pill — so errors
    // read in the same language rather than importing a foreign hue.
    colorDanger: organic.accent700,
    colorWarning: organic.accent600,
    colorSuccess: organic.accent2_600,
    colorModalBackdrop: "rgba(46, 43, 37, 0.5)",

    fontFamily: '"Figtree", system-ui, sans-serif',
    // Buttons take the display face, matching `.btn` in organic.css.
    fontFamilyButtons: '"Caprasimo", system-ui, sans-serif',
    fontSize: "14px",

    // One base radius has to serve cards and controls, and Organic wants
    // different values for each: 16px surfaces, pill controls. The base is
    // set for surfaces and the controls are pushed to pills in `elements`.
    borderRadius: "16px",
  },

  elements: {
    // Clerk sizes its root to its own default measure (~263px), which looks
    // starved inside the 560px form column. These three force it to fill the
    // column so the fields line up with the rest of the console's forms.
    rootBox: "w-full",
    // Clerk's card is dropped into a page that already has a heading and a
    // ground colour, so its own chrome is removed rather than nested.
    cardBox: "shadow-none border-none w-full max-w-none",
    card: "bg-transparent shadow-none border-none p-0 w-full max-w-none",
    // Our page supplies the title in Caprasimo; Clerk's would duplicate it.
    header: "hidden",
    footer: "bg-transparent",
    footerActionText: "text-[13px]",
    footerActionLink: "text-[13px]",

    // Pills, per the Organic rounded-frame rule.
    formButtonPrimary:
      "rounded-pill normal-case tracking-normal text-[14px] shadow-none",
    formFieldInput: "rounded-pill",
    socialButtonsBlockButton: "rounded-pill border-[color:var(--color-divider)]",
    socialButtonsBlockButtonText: "text-[14px] font-body",

    dividerLine: "bg-[color:var(--color-divider)]",
    dividerText: "text-[12px]",
    formFieldLabel: "text-[12px]",
  },

  // Core 3 renamed `layout` to `options`.
  options: {
    // A logo would sit directly under our own brand lockup in the panel.
    logoPlacement: "none",
    socialButtonsPlacement: "top",
    socialButtonsVariant: "blockButton",
    // Clerk renders footer links for these when set. Left unset until real
    // pages exist — a link to a missing policy is worse than no link.
  },
};
