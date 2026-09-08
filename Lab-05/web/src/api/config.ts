/** Where the API lives.
 *
 * Its own module so `errors.ts` can name the URL in a message without
 * importing the client, and the client can import the errors — a cycle that
 * would otherwise leave one of them undefined at module-eval time.
 */
export const AGENT_BASE_URL =
  import.meta.env.VITE_AGENT_URL ?? "http://localhost:8001";
