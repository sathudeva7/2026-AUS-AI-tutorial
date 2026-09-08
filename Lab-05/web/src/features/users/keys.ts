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
  detail: (userId: string) => [...usersKeys.all, "detail", userId] as const,
  availability: (userId: string) =>
    [...usersKeys.all, "availability", userId] as const,
};

/** Leads live in another feature, but deactivating someone moves their open
 *  leads to the unassigned queue — so a users mutation has to invalidate a
 *  leads query. Named here so that cross-feature link is visible rather than
 *  a bare string appearing in a mutation nobody associates with leads. */
export const leadsKeyRoot = ["leads"] as const;
