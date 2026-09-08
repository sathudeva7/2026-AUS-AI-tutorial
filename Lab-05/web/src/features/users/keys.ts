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
 *  **This is a no-op today, and saying so is the point.** DashboardRoute reads
 *  leads with useEffect and repo.listLeads, not through this cache, so nothing
 *  is listening on this key: the invalidation fires and no refetch happens.
 *
 *  It stays because the requirement is real and easy to lose. When leads moves
 *  behind a query it must use THIS key, and then the two mutations that
 *  reference it start working without anyone having to remember why.
 *
 *  There is no `detail` key: the panel reads the person out of the list cache,
 *  so a per-user query does not exist. A key nothing reads reads as coverage
 *  and is not.
 */
export const leadsKeyRoot = ["leads"] as const;
