/** One form field, plus the line on the page its value came from.
 *
 * Wraps a field rather than replacing it, so the manual road renders through
 * exactly the same inputs as before — pass no `source` and this component is
 * a passthrough. That is the whole point of the flow: there are not two
 * forms, there is one form with two ways of being filled.
 *
 * Confirming is not a formality. Until somebody confirms it, a value here is
 * a machine's reading of a webpage, and this product does not let the agent
 * state a fact on that footing either.
 */
import type { ReactNode } from "react";

import { AlertIcon, CheckIcon } from "@/components/ui/icons";
import type { Sourced } from "../extraction";

export function SourcedField({
  source,
  confirmed,
  onToggle,
  children,
}: {
  /** Absent on the manual road, and for any field the reader did not fill. */
  source?: Sourced<string>;
  confirmed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  if (!source) return <>{children}</>;

  /* The page did not mention it. No rule, no quote — this is an ordinary
     empty box and dressing it up as a finding would be a lie about where the
     value has to come from. The note says so where the blank is. */
  if (source.evidence === "absent") {
    return (
      <div>
        {children}
        <p className="console-notfound">
          Not on that page. Type it in, or leave it for now.
        </p>
      </div>
    );
  }

  return (
    <div
      className="console-sourced"
      data-state={confirmed ? "confirmed" : "unconfirmed"}
    >
      {children}
      <p className="console-quote">
        <span className="console-quote-words">{source.quote}</span>{" "}
        {source.section ? (
          <span className="console-quote-where">— {source.section}</span>
        ) : null}
      </p>
      <div className="console-sourced-foot">
        <button
          type="button"
          className="console-confirm"
          data-done={confirmed || undefined}
          onClick={onToggle}
        >
          {confirmed ? (
            <>
              <CheckIcon size={13} />
              Confirmed
            </>
          ) : (
            "Looks right"
          )}
        </button>
        {/* Said once, on the row it belongs to. The page supports something
            here but not this exact figure — a fee band, a month with no
            year — and that is a different job from confirming a clean read. */}
        {!confirmed && source.evidence === "unclear" ? (
          <span className="console-unclear">
            <AlertIcon size={13} />
            The page is not specific — check this one
          </span>
        ) : null}
      </div>
    </div>
  );
}
