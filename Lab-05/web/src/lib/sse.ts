/** SSE client over fetch + ReadableStream.
 *
 * The browser's native `EventSource` only speaks GET; `/api/run` is a POST
 * with a JSON body, so we read the streamed response and parse frames by
 * hand.
 *
 * Frame format (https://html.spec.whatwg.org/multipage/server-sent-events.html):
 *   event: <type>\n
 *   data: <payload>\n
 *   \n
 * The backend emits single-line JSON per event, so multi-line `data:` is
 * joined but never structurally relied on.
 */

export interface SseFrame {
  event: string;
  data: unknown;
}

/** Read `response.body` to exhaustion, calling `onFrame` per complete frame. */
export async function readSse(
  response: Response,
  onFrame: (frame: SseFrame) => void,
): Promise<void> {
  if (!response.body) {
    throw new Error("response has no body to stream");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    // The spec allows \r\n, \r or \n; sse-starlette emits strict \r\n.
    // Normalising as we go lets us split on \n\n regardless of server.
    buffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");

    let sep = buffer.indexOf("\n\n");
    while (sep !== -1) {
      handleFrame(buffer.slice(0, sep), onFrame);
      buffer = buffer.slice(sep + 2);
      sep = buffer.indexOf("\n\n");
    }
  }

  // A partial read at EOF still carries a whole frame often enough to matter.
  if (buffer.trim()) handleFrame(buffer, onFrame);
}

function handleFrame(frame: string, onFrame: (frame: SseFrame) => void): void {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) continue; // comment / keepalive ping
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return;
  try {
    onFrame({ event, data: JSON.parse(dataLines.join("\n")) });
  } catch {
    // An unparseable frame is a backend bug, not something to render. Drop it
    // rather than tearing down a live conversation over one bad line.
  }
}
