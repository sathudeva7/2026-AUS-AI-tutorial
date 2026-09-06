/** Step one of two: create the account.
 *
 * Clerk owns this form. Google, email + password, verification codes,
 * breached-password checks and bot protection all come from `<SignUp />`;
 * rebuilding any of it by hand would be work with a worse result.
 *
 * What signup asks for is deliberately almost nothing — name, email, done.
 * The agency comes next, and everything else (destinations, counsellors,
 * widget colour) is configuration that belongs in the console once there is
 * an agency to attach it to.
 *
 * Notably absent, and on purpose:
 *   Work email domain  Small agencies run on Gmail. Gating on a domain would
 *                      turn away real customers, and it breaks for agencies
 *                      with branches on several domains. Clerk's per-address
 *                      invitations do the job the domain was standing in for.
 *   Timezone           A tenant does not have one timezone if it has branches
 *                      in several countries. Times render in the viewer's own
 *                      zone instead — see lib/format.ts.
 */
import { SignUp } from "@clerk/react";
import { AuthLayout } from "@/components/auth/AuthLayout";

export function SignupRoute() {
  return (
    <AuthLayout
      image="/signup.webp"
      aside={
        <>
          <h1 className="m-0 text-[38px] leading-[1.08]">
            Your catalogue. Your rules. Your counsellors.
          </h1>
          <p
            className="mt-4 text-[14px] leading-relaxed"
            style={{ color: "var(--color-neutral-800)" }}
          >
            Load your programmes and entry requirements, set who owns which
            destination, and the agent answers from those and nothing else. It
            never states a fee, a deadline or a requirement that did not come
            from your catalogue, and it hands a student to a person the moment
            your escalation rules say so.
          </p>
          <ul
            className="mt-5 flex list-none flex-col gap-2 p-0 text-[13px]"
            style={{ color: "var(--color-neutral-800)" }}
          >
            {[
              "Answers inquiries outside office hours",
              "Escalates visa history to a human, always",
              "Every answer traceable to a tool call",
            ].map((line) => (
              <li key={line} className="flex items-baseline gap-2">
                <span
                  aria-hidden="true"
                  style={{ color: "var(--color-accent-2-600)" }}
                >
                  ●
                </span>
                {line}
              </li>
            ))}
          </ul>
        </>
      }
    >
      <StepHeader
        step={1}
        title="Create your account"
        blurb="Then you'll name your agency. Two steps, and you're in."
      />

      <SignUp
        // Path-based routing so Clerk's multi-step states (verification code,
        // OAuth return) get real URLs and survive a refresh.
        routing="path"
        path="/signup"
        signInUrl="/login"
        // Straight to step two. A brand-new user has no agency yet, and
        // dropping them on the console before they have one would show an
        // empty shell with nothing to explain it.
        forceRedirectUrl="/create-agency"
      />
    </AuthLayout>
  );
}

export function StepHeader({
  step,
  title,
  blurb,
}: {
  step: 1 | 2;
  title: string;
  blurb: string;
}) {
  return (
    <div className="mb-6">
      <ol className="m-0 mb-4 flex list-none items-center gap-3 p-0">
        {[1, 2].map((n) => {
          const active = n === step;
          const done = n < step;
          return (
            <li key={n} className="flex items-center gap-2">
              <span
                className="grid h-[22px] w-[22px] place-items-center rounded-pill text-[11px]"
                style={{
                  background:
                    active || done
                      ? "var(--color-accent)"
                      : "var(--color-neutral-300)",
                  color:
                    active || done
                      ? "var(--color-bg)"
                      : "var(--color-neutral-900)",
                }}
              >
                {done ? "✓" : n}
              </span>
              <span
                className="text-[12.5px]"
                style={{
                  color: active
                    ? "var(--color-text)"
                    : "var(--color-neutral-700)",
                }}
              >
                {n === 1 ? "Your account" : "Your agency"}
              </span>
              {n === 1 ? (
                <span
                  aria-hidden="true"
                  className="ml-1 h-px w-6"
                  style={{ background: "var(--color-divider)" }}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
      <h1 className="m-0 text-[32px]">{title}</h1>
      <p
        className="m-0 mt-1.5 max-w-[54ch] text-[13.5px]"
        style={{ color: "var(--color-neutral-700)" }}
      >
        {blurb}
      </p>
    </div>
  );
}
