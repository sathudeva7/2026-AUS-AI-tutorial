/** Query keys for the catalogue.
 *
 * A factory rather than loose strings so that when a write lands and something
 * has to be invalidated, there is one place to read the shape off — and so a
 * key with the wrong params is a type error rather than a cache that silently
 * never updates.
 */
import type { ProgrammeListParams } from "./types";

export const catalogueKeys = {
  all: ["catalogue"] as const,
  /** The fixture-backed list the coverage banner still uses. */
  fixture: () => [...catalogueKeys.all, "fixture"] as const,
  lists: () => [...catalogueKeys.all, "programmes"] as const,
  list: (params: ProgrammeListParams) =>
    [...catalogueKeys.lists(), params] as const,
  details: () => [...catalogueKeys.all, "programme"] as const,
  detail: (id: string) => [...catalogueKeys.details(), id] as const,
};
