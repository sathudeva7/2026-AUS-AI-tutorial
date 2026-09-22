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
 */
import { useEffect, useRef, useState } from "react";

import { CheckIcon, LinkIcon } from "@/components/ui/icons";
import { READ_STAGES, type Extraction } from "../extraction";
import { readPage, ReadStopped } from "../readPage";

export function ProgrammeStart({
  onRead,
  onManual,
}: {
  onRead: (extraction: Extraction) => void;
  onManual: () => void;
}) {
  const [url, setUrl] = useState("");
  const [reading, setReading] = useState(false);
  const [done, setDone] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const handle = useRef<ReturnType<typeof readPage> | null>(null);

  // A read in flight when the route unmounts would keep firing timers into a
  // component that is gone.
  useEffect(() => () => handle.current?.stop(), []);

  function start() {
    const trimmed = url.trim();
    if (!trimmed) return;

    /* Checked here rather than after a four-second wait. The reader needs a
       host to fetch, and "msc data science manchester" is a search, not a
       page — saying so straight away is kinder than reading nothing. */
    const withScheme = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    try {
      new URL(withScheme);
    } catch {
      setProblem("That is not a web address. Paste the link to the course page.");
      return;
    }

    setProblem(null);
    setDone([]);
    setReading(true);
    const h = readPage(withScheme, (id) => setDone((d) => [...d, id]));
    handle.current = h;
    h.done
      .then((extraction) => {
        setReading(false);
        onRead(extraction);
      })
      .catch((error) => {
        setReading(false);
        if (error instanceof ReadStopped) return;
        setProblem("That page could not be read. Check the link, or fill it in by hand.");
      });
  }

  function stop() {
    handle.current?.stop();
    handle.current = null;
    setReading(false);
    setDone([]);
  }

  if (reading) {
    const runningIndex = done.length;
    return (
      <div className="console-start">
        <div className="console-review-title">
          Reading{" "}
          <span className="console-review-src">
            {url.replace(/^https?:\/\//i, "")}
          </span>
        </div>
        <div className="console-readout">
          {READ_STAGES.map((stage, i) => {
            const state =
              i < runningIndex
                ? "done"
                : i === runningIndex
                  ? "running"
                  : "pending";
            return (
              <div
                key={stage.id}
                className="console-readout-line"
                data-state={state}
              >
                <span className="console-readout-mark">
                  {state === "done" ? <CheckIcon size={14} /> : null}
                </span>
                {stage.label}
              </div>
            );
          })}
        </div>
        <div className="console-start-alt">
          <span>Nothing is saved until you have checked what it found.</span>
          <button type="button" className="console-start-link" onClick={stop}>
            Stop reading
          </button>
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
          aria-invalid={problem ? true : undefined}
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
      {problem ? <p className="console-error">{problem}</p> : null}

      <div className="console-start-alt">
        <span>No page to paste?</span>
        <button type="button" className="console-start-link" onClick={onManual}>
          Fill it in by hand
        </button>
      </div>
    </div>
  );
}
