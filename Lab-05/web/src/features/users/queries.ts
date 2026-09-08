/** Hooks over the users endpoints: what to cache, and what to invalidate.
 *
 * The rule every mutation here follows: after a write, invalidate everything
 * the write could have changed — including things on screens the viewer is
 * not currently looking at. That last part is where stale-UI bugs come from,
 * and deactivation is the example: it changes the roster AND the lead list.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { leadsKeyRoot, usersKeys } from "./keys";
import * as api from "./api";
import type { AvailabilityRule, Role } from "./types";

/** The roster. One request draws the whole table: `countries` come back
 *  inline, so there is no per-row follow-up. Hours are deliberately NOT here
 *  — they are fetched when somebody opens a person, not 40 times to render a
 *  list nobody has clicked. */
export function useUsers(
  params: {
    status?: "active" | "invited" | "deactivated" | "all";
    limit?: number;
    offset?: number;
  } = {},
) {
  return useQuery({
    queryKey: usersKeys.list(params),
    queryFn: () => api.listUsers(params),
    // Keeps the current page on screen while the next one loads, instead of
    // blanking the table and jumping the scroll position.
    placeholderData: (previous) => previous,
  });
}

/** One person's week. Enabled only when a user is actually selected, so
 *  opening the roster does not fetch anybody's hours. */
export function useUserAvailability(userId: string | null) {
  return useQuery({
    queryKey: usersKeys.availability(userId ?? "none"),
    queryFn: () => api.getUserAvailability(userId as string),
    enabled: Boolean(userId),
  });
}

export function useInviteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; role: Role }) => api.inviteUser(input),
    onSuccess: () => {
      // The new row lands anywhere in the roster depending on sort and page,
      // so invalidate the lists rather than trying to splice it in.
      void qc.invalidateQueries({ queryKey: usersKeys.lists() });
    },
  });
}

export function usePatchUser(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fields: {
      name?: string | null;
      work_phone?: string | null;
      timezone?: string;
    }) => api.patchUser(userId, fields),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: usersKeys.lists() });
      void qc.invalidateQueries({ queryKey: usersKeys.detail(userId) });
    },
  });
}

export function useSetUserCountries(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (countries: string[]) =>
      api.setUserCountries(userId, countries),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: usersKeys.lists() });
      void qc.invalidateQueries({ queryKey: usersKeys.detail(userId) });
      // Country ownership decides which leads this person SEES. Anything
      // rendering a lead list is now looking at a stale answer.
      void qc.invalidateQueries({ queryKey: leadsKeyRoot });
    },
  });
}

export function useSetUserAvailability(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rules: AvailabilityRule[]) =>
      api.setUserAvailability(userId, rules),
    onSuccess: (saved) => {
      // The response IS the stored week, already ordered by day then start.
      // Writing it straight into the cache avoids a refetch that would return
      // exactly this.
      qc.setQueryData(usersKeys.availability(userId), saved);
    },
  });
}

/** Deactivation. Never optimistic.
 *
 * Two reasons. It is destructive — undoing it means re-inviting the person —
 * and the useful half of the answer is a number only the server knows: how
 * many open leads moved to the unassigned queue. Guessing it would mean
 * telling someone "12 leads moved" when it was three.
 */
export function useDeactivateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.deactivateUser(userId),
    onSuccess: ({ user }) => {
      void qc.invalidateQueries({ queryKey: usersKeys.all });
      // The cross-feature one, and the easiest to forget: their open leads are
      // now in the unassigned queue, so every lead list on every screen is
      // wrong until this runs.
      void qc.invalidateQueries({ queryKey: leadsKeyRoot });
      void qc.removeQueries({ queryKey: usersKeys.availability(user.id) });
    },
  });
}
