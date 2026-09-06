/** The frame both unauthenticated screens sit in.
 *
 * These two pages are the only ones outside the console shell — no rail, no
 * tenant card, because neither is known yet. Asymmetric split as the Organic
 * system asks for: a sand panel carrying the argument on the left, the form
 * on the cream ground at the right, generous whitespace between them.
 *
 * The left panel stays put while a long form scrolls beside it.
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

export function AuthLayout({
  children,
  aside,
  image,
}: {
  children: ReactNode;
  /** The pitch beside the form. Differs between signing up and signing in. */
  aside: ReactNode;
  /** Optional illustration filling the aside behind the copy. */
  image?: string;
}) {
  return (
    <div
      className="min-h-screen w-full lg:grid lg:grid-cols-[minmax(0,42%)_minmax(0,58%)]"
      style={{ background: "var(--color-bg)" }}
    >
      <aside
        className={cn(
          "relative isolate flex flex-col gap-8 overflow-hidden px-8 py-10 lg:sticky lg:top-0 lg:h-screen lg:px-12 lg:py-14",
        )}
        style={{ background: "var(--color-surface)" }}
      >
        {image ? (
          <>
            {/* Decorative. The headline beside it already says what it says,
                so announcing "illustration of a student on a road" would only
                add noise for a screen reader.

                Shown from lg up only. The artwork is composed for a tall
                panel; in the stacked layout the aside is short and wide, so
                `cover` crops to the dark rock at the foot of the picture and
                the copy lands unreadable on top of it. A fragment that
                defeats the text is worse than the plain sand ground. */}
            <img
              src={image}
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 -z-20 hidden h-full w-full select-none object-cover object-bottom lg:block"
            />
            {/* The copy sits over the top half, which the illustration fills
                with sky — but a short viewport crops that away and slides the
                hills up under the text. The scrim makes the text zone
                independent of where the crop lands: near-opaque behind the
                words, gone by the time it reaches the figure. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 -z-10 hidden lg:block"
              style={{
                background:
                  "linear-gradient(180deg," +
                  " var(--color-surface) 0%," +
                  " color-mix(in srgb, var(--color-surface) 94%, transparent) 32%," +
                  " color-mix(in srgb, var(--color-surface) 68%, transparent) 50%," +
                  " color-mix(in srgb, var(--color-surface) 22%, transparent) 64%," +
                  " transparent 74%)",
              }}
            />
          </>
        ) : null}

        <Brand />
        {/* With an illustration the copy sits directly under the brand, over
            the scrimmed top of the picture. Without one it centres in the
            panel instead — pinned to the foot of an empty field it just looks
            like something failed to load. */}
        <div className={cn("max-w-[46ch]", !image && "my-auto")}>{aside}</div>
      </aside>

      <main className="flex justify-center px-6 py-10 lg:px-14 lg:py-14">
        <div className="w-full max-w-[560px]">
          {children}
          <p
            className="mb-0 mt-8 text-[11.5px]"
            style={{ color: "var(--color-neutral-600)" }}
          >
            Northbound is multi-tenant. Your catalogue, your requirement rules,
            your counsellor roster and your country ownership stay yours — no
            query ever crosses a tenant boundary.
          </p>
        </div>
      </main>
    </div>
  );
}

function Brand() {
  return (
    <Link
      to="/widget"
      className="flex items-center gap-[10px] no-underline"
      style={{ color: "var(--color-text)" }}
    >
      <span
        className="grid h-[34px] w-[34px] place-items-center rounded-pill font-heading text-[17px]"
        style={{
          background: "var(--color-accent-200)",
          color: "var(--color-accent-800)",
        }}
        aria-hidden="true"
      >
        N
      </span>
      <span>
        <span className="block font-heading text-[19px] leading-none">
          Northbound
        </span>
        <span
          className="block text-[10.5px] uppercase tracking-[0.07em]"
          style={{ color: "var(--color-neutral-600)" }}
        >
          v1 prototype
        </span>
      </span>
    </Link>
  );
}

/** The notice that keeps these screens honest.
 *
 * There is no auth backend: no password is stored, nothing is checked, and
 * signing in protects nothing. A login form that silently accepts any input
 * is a trap for whoever demos it next, so it says so on the page rather than
 * in a comment. */
export function NoAuthNotice({ action }: { action: "sign in" | "sign up" }) {
  return (
    <div
      className="mb-6 rounded-md px-4 py-3 text-[12.5px] leading-relaxed"
      style={{
        background: "var(--color-accent-100)",
        border: "1px solid var(--color-accent-300)",
        color: "var(--color-accent-800)",
      }}
      role="note"
    >
      <strong className="font-semibold">
        No authentication backend is connected.
      </strong>{" "}
      This screen is UI only — nothing you type is sent anywhere, no password
      is stored, and no credential is checked. Choosing “{action}” records an
      account in this browser tab so the flow can be walked end to end. It
      protects nothing, and the console is reachable without it.
    </div>
  );
}

/** Section heading inside an auth form. */
export function AuthSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="m-0 font-heading text-[20px] leading-tight">{title}</h2>
        {description ? (
          <p
            className="m-0 mt-1 max-w-[62ch] text-[12.5px] leading-relaxed"
            style={{ color: "var(--color-neutral-700)" }}
          >
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
