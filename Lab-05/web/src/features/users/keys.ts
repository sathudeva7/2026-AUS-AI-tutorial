/** Cache keys for everything under `users`.
 *
 * A factory rather than strings written at each call site. Loose strings are
 * how invalidation silently misses: one file says ["users"], another says
 * ["users", "list"], a mutation clears the first, and the second renders
 * yesterday's roster with nothing to show anything went wrong.
 *
 * The shape is a tree, so `usersKeys.all` invalidates every users query at
 * once — which is what most mutations here actually want.
 */
export const usersKeys = {
  all: ["users"] as const,
  lists: () => [...usersKeys.all, "list"] as const,
  list: (params: { status?: string; limit?: number; offset?: number }) =>
    [...usersKeys.lists(), params] as const,
  availability: (userId: string) =>
    [...usersKeys.all, "availability", userId] as const,
};

/** Leads live in another feature, but deactivating someone moves their open
 *  leads to the unassigned queue and changing their countries changes which
 *  leads they can see — so a users mutation has to invalidate a leads query.
 *
 *  **`features/leads/queries.ts` is the reader**, so these invalidations do
 *  real work now: the Leads panel on a counsellor's record is rendered from
 *  this key and is wrong the moment either mutation lands.
 *
 *  DashboardRoute still reads leads with useEffect and repo.listLeads, outside
 *  this cache, and is still not refreshed by either. Moving it behind this key
 *  is what finishes the job.
 *
 *  There is no `detail` key: the panel reads the person out of the list cache,
 *  so a per-user query does not exist. A key nothing reads reads as coverage
 *  and is not.
 */
export const leadsKeyRoot = ["leads"] as const;
