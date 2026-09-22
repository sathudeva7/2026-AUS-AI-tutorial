/** How adding a programme begins.
 *
 * Not a mode picker. The url box is usable the second the page opens,
 * because the common case is a counsellor with the university's course page
 * in the next tab; typing forty fields out by hand is the slower road and it
 * sits underneath, one click away, at the weight it deserves.
 *
 * Both roads end in the same form. Reading a page does not open a different
 * editor — it fills the one that was going to be filled anyway, and attaches
 * the line each figure came from so a person can check it.
 *
 * NO STAGE READOUT. An earlier version ticked five legs off a list —
 * fetching, identity, fees, requirements, intakes — and they were timers,
 * not progress. The server does two things behind one request and cannot
 * report the boundary, so a staged bar here would be an animation pretending
 * to be information. The student widget shows the agent's REAL tool calls as
 * they run; inventing progress on the counsellor's side would be the one
 * place this product lied about what it was doing.
 */
import { useState } from "react";

import {
  ApiRequestError,
  FieldValidationError,
  NotAuthenticatedError,
} from "@/api/errors";
import { LinkIcon } from "@/components/ui/icons";
import type { Extraction } from "../extraction";
import { useReadProgrammePage } from "../queries";

/** What went wrong, in the server's own words.
 *
 * The server knows what happened and this component does not, so its
 * sentence is shown as written. A refusal against the `url` field is the
 * counsellor's to fix — a dead page, a prospectus instead of a course — and
 * arrives as `FieldValidationError`; a 401, a 403 or any other refusal
 * carries a sentence just as good.
 *
 * An earlier version showed only the url case and gave everything else one
 * invented line about the reader being unavailable. A permission refusal
 * then reached the screen as an outage, which was untrue twice over: the
 * reader was fine, and the retry it invited could never have worked.
 *
 * Only a request that never landed has no server sentence to show, and that
 * is the single case the fallback is left for.
 *
 * `aboutUrl` decides whether the box is marked wrong. A perfectly good link
 * refused for a permission must not be given a red border.
 */
interface Problem {
  text: string;
  aboutUrl: boolean;
}

function problemFrom(error: unknown): Problem {
  if (error instanceof FieldValidationError && error.fields.url) {
    return { text: error.fields.url, aboutUrl: true };
  }
  if (
    error instanceof NotAuthenticatedError ||
    error instanceof ApiRequestError ||
    error instanceof FieldValidationError
  ) {
    return { text: error.message, aboutUrl: false };
  }
  return {
    text: "Could not reach the server. Try again in a moment, or fill the form in by hand.",
    aboutUrl: false,
  };
}

export function ProgrammeStart({
  onRead,
  onManual,
}: {
  onRead: (extraction: Extraction) => void;
  onManual: () => void;
}) {
  const [url, setUrl] = useState("");
  const [problem, setProblem] = useState<Problem | null>(null);
  const read = useReadProgrammePage();

  function start() {
    const trimmed = url.trim();
    if (!trimmed) return;

    /* Checked here rather than after a seven-second wait. The reader needs a
       host to fetch, and "msc data science manchester" is a search, not a
       page — saying so straight away is kinder than reading nothing. The
       server checks it again; this is courtesy, not the boundary. */
    const withScheme = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    try {
      new URL(withScheme);
    } catch {
      setProblem({
        text: "That is not a web address. Paste the link to the course page.",
        aboutUrl: true,
      });
      return;
    }

    setProblem(null);
    read.mutate(withScheme, {
      onSuccess: onRead,
      onError: (error) => setProblem(problemFrom(error)),
    });
  }

  if (read.isPending) {
    return (
      <div className="console-start">
        <div className="console-review-title">
          Reading{" "}
          <span className="console-review-src">
            {url.replace(/^https?:\/\//i, "")}
          </span>
        </div>
        <div className="console-readout" aria-live="polite">
          <div className="console-readout-line" data-state="running">
            Fetching the page and reading what it says. This takes a few
            seconds.
          </div>
        </div>
        <div className="console-start-alt">
          <span>Nothing is saved until you have checked what it found.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="console-start">
      <div className="console-review-title">Start from the course page</div>
      <p className="console-review-sub">
        Paste the university&apos;s own page for this programme. We read it and
        fill the form in with what it says, quoting the line every figure came
        from. Nothing goes in front of a student until you have confirmed each
        one.
      </p>
      <div className="console-start-row">
        <input
          className="console-input"
          type="url"
          value={url}
          aria-label="Course page address"
          aria-invalid={problem?.aboutUrl ? true : undefined}
          placeholder="https://"
          onChange={(e) => {
            setUrl(e.target.value);
            if (problem) setProblem(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") start();
          }}
        />
        <button
          type="button"
          className="console-btn"
          data-variant="primary"
          disabled={!url.trim()}
          onClick={start}
        >
          <LinkIcon size={15} />
          Read page
        </button>
      </div>
      {problem ? <p className="console-error">{problem.text}</p> : null}

      <div className="console-start-alt">
        <span>No page to paste?</span>
        <button type="button" className="console-start-link" onClick={onManual}>
          Fill it in by hand
        </button>
      </div>
    </div>
  );
}
