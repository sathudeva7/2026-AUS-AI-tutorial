/** Tailwind mapped onto the Organic design system.
 *
 * Every value here is a `var(--…)` reference into src/styles/organic.css,
 * which CLAUDE.md names as the source of truth: "All colour, type, spacing
 * and radius values come from the design system's CSS variables; never
 * hard-code a hex or a px value the tokens carry."
 *
 * The tokens are hex and `color-mix()`, not HSL triplets, so there is no
 * `hsl(var(--x))` wrapper here and opacity modifiers (`bg-accent/50`) do NOT
 * work. Reach for a ramp step instead — that is what the 100–900 scales are
 * for, and they are tuned on one shared lightness scale so a step of any role
 * matches the others in visual value.
 *
 * There is no dark mode. The Organic system defines no dark ramp.
 *
 * @type {import('tailwindcss').Config}
 */
const ramp = (name) =>
  Object.fromEntries(
    [100, 200, 300, 400, 500, 600, 700, 800, 900].map((step) => [
      step,
      `var(--color-${name}-${step})`,
    ]),
  );

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--color-bg)",
        surface: "var(--color-surface)",
        text: "var(--color-text)",
        divider: "var(--color-divider)",
        accent: { DEFAULT: "var(--color-accent)", ...ramp("accent") },
        accent2: { DEFAULT: "var(--color-accent-2)", ...ramp("accent-2") },
        neutral: ramp("neutral"),
      },
      fontFamily: {
        heading: "var(--font-heading)",
        body: "var(--font-body)",
      },
      spacing: {
        1: "var(--space-1)",
        2: "var(--space-2)",
        3: "var(--space-3)",
        4: "var(--space-4)",
        6: "var(--space-6)",
        8: "var(--space-8)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        pill: "999px",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "none" },
        },
      },
      animation: {
        // Matches the prototype's `nbIn` easing and duration.
        "fade-in": "fade-in 0.32s cubic-bezier(.2,.8,.2,1) both",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
