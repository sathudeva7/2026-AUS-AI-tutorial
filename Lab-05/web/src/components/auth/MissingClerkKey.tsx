/** What you see when VITE_CLERK_PUBLISHABLE_KEY is not set.
 *
 * Clerk throws without a key, and an unhandled throw at the root renders a
 * blank page — the same symptom as a dozen unrelated faults. This says which
 * one it is and how to fix it.
 */
export function MissingClerkKey() {
  return (
    <div
      className="flex min-h-screen items-center justify-center p-8"
      style={{ background: "var(--color-bg)", color: "var(--color-text)" }}
    >
      <div
        className="max-w-[62ch] rounded-md p-6"
        style={{
          background: "var(--color-accent-100)",
          border: "1px solid var(--color-accent-300)",
        }}
      >
        <h1
          className="m-0 text-[24px]"
          style={{ color: "var(--color-accent-800)" }}
        >
          Clerk is not configured
        </h1>
        <p
          className="mt-2 text-[13.5px] leading-relaxed"
          style={{ color: "var(--color-accent-800)" }}
        >
          <code>VITE_CLERK_PUBLISHABLE_KEY</code> is missing, so authentication
          cannot start. Add it to <code>Lab-05/web/.env.local</code> and restart
          the dev server:
        </p>
        <pre
          className="figure m-0 mt-3 overflow-x-auto rounded-sm p-3 text-[12px]"
          style={{
            background: "var(--color-neutral-900)",
            color: "var(--color-neutral-100)",
          }}
        >
{`cd Lab-05/web
clerk env pull          # or paste the key from dashboard.clerk.com
npm run dev`}
        </pre>
        <p
          className="mb-0 mt-3 text-[11.5px]"
          style={{ color: "var(--color-neutral-700)" }}
        >
          The publishable key is safe in client code. The secret key is not —
          it belongs in <code>Lab-05/.env</code>, never under <code>web/</code>.
        </p>
      </div>
    </div>
  );
}
