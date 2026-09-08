/** The programme catalogue.
 *
 * Fixture-backed: there is no `GET /api/programmes` yet. It goes through a
 * query anyway, so the day the endpoint lands only the queryFn changes — and
 * so callers get caching, de-duplication and cancellation now rather than
 * hand-rolling them per screen.
 */
import { useQuery } from "@tanstack/react-query";

import { repo } from "@/data/repo";

// Not exported yet: nothing outside this file invalidates the catalogue. It is
// a factory rather than a bare string so that when something does, there is one
// place to add to rather than a loose key to guess at.
const catalogueKeys = {
  all: ["catalogue"] as const,
  programmes: () => [...catalogueKeys.all, "programmes"] as const,
};

export function useProgrammes() {
  return useQuery({
    queryKey: catalogueKeys.programmes(),
    queryFn: () => repo.listProgrammes(),
    // The catalogue changes when somebody edits it, not between two clicks on
    // the roster.
    staleTime: 5 * 60_000,
  });
}
