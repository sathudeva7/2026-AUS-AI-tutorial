/// <reference types="vite/client" />

/** The agent's base URL, so a deployment can point the console at something
 *  other than a local uvicorn. Defaults to http://localhost:8001. */
interface ImportMetaEnv {
  readonly VITE_AGENT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
