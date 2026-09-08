/** One QueryClient for the app.
 *
 * The defaults below are the ones worth setting deliberately; everything else
 * is left alone.
 */
import { QueryClient } from "@tanstack/react-query";
import { NotAuthenticatedError } from "./errors";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The library's default is 0, which refetches on every remount. With
      // tabbed surfaces that is a request storm for data that barely moves —
      // a roster changes when somebody is invited, not between two clicks.
      staleTime: 30_000,

      // Retrying a 401 or 403 cannot help: the answer will not change until
      // the viewer signs in again or an owner grants something. Retry only
      // what a retry could actually fix.
      retry(failureCount, error) {
        if (error instanceof NotAuthenticatedError) return false;
        return failureCount < 2;
      },

      // Off by default. It is useful on a dashboard someone leaves open all
      // day, and merely surprising on a form they tabbed away from.
      refetchOnWindowFocus: false,
    },
    mutations: {
      // A write that failed is not safely repeatable without knowing why.
      // Deactivation moves leads; inviting sends an email. The caller decides.
      retry: false,
    },
  },
});
