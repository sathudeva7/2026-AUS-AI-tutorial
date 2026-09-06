/** Loading, empty and failure.
 *
 * CLAUDE.md: "Prefer failing loudly over degrading gracefully." A surface
 * that cannot reach the agent says so, in the words that fix it. It does not
 * render an empty list, which reads as "no leads" — a false statement about
 * the business — rather than "the backend is down".
 */
import type { ReactNode } from "react";
import { AgentUnreachableError } from "@/data/live";
import { Card, CardTitle } from "./index";

export function FailureCard({
  title = "Something failed, and it is not being hidden",
  error,
  onRetry,
}: {
  title?: string;
  error: unknown;
  onRetry?: () => void;
}) {
  const message =
    error instanceof AgentUnreachableError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error);
  const unreachable = error instanceof AgentUnreachableError;

  return (
    <Card
      className="max-w-[70ch]"
      style={{
        background: "var(--color-accent-100)",
        border: "1px solid var(--color-accent-300)",
      }}
    >
      <CardTitle>
        <span style={{ color: "var(--color-accent-800)" }}>
          {unreachable ? "The agent is not reachable" : title}
        </span>
      </CardTitle>
      <p
        className="m-0 text-[13px] leading-relaxed"
        style={{ color: "var(--color-accent-800)" }}
      >
        {message}
      </p>
      {onRetry ? (
        <div>
          <button
            type="button"
            onClick={onRetry}
            className="btn btn-secondary text-[12.5px]"
          >
            Try again
          </button>
        </div>
      ) : null}
    </Card>
  );
}

export function LoadingNote({ children }: { children: ReactNode }) {
  return (
    <p
      className="text-[13px]"
      style={{ color: "var(--color-neutral-600)" }}
      aria-live="polite"
    >
      {children}
    </p>
  );
}

/** A dashed box for "there is genuinely nothing here", which is different
 *  from a failure and must not look like one. */
export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <div
      className="rounded-md p-4 text-[12.5px]"
      style={{
        border: "1px dashed var(--color-neutral-400)",
        color: "var(--color-neutral-700)",
      }}
    >
      {children}
    </div>
  );
}
