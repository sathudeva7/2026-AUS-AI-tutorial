/** The lead book, behind react-query.
 *
 * Keyed on `leadsKeyRoot`, which `features/users/keys.ts` reserved for exactly
 * this. Its comment there said the key was a no-op because nothing read leads
 * through the cache — this is the first reader, so the invalidations that
 * `useSetUserCountries` and `useDeactivateUser` already fire now actually do
 * something. Country ownership decides which leads a person sees, and
 * deactivating somebody moves their open leads to the unassigned queue; both
 * make a list rendered from this key wrong until it refetches.
 */
import { useQuery } from "@tanstack/react-query";

import { repo } from "@/data/repo";
import { leadsKeyRoot } from "@/features/users/keys";

export function useLeads() {
  return useQuery({
    queryKey: leadsKeyRoot,
    queryFn: () => repo.listLeads(),
  });
}
