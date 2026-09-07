/** The console's front door.
 *
 * This is UX, not security. A route guard stops navigation; it stops nobody
 * with devtools or curl. The boundary that matters is `require_auth` in
 * student_agent/auth.py, which refuses the request itself — this only decides
 * what a browser is shown on the way there.
 *
 * It exists anyway for three reasons: a signed-out visitor should not be
 * looking at an empty console shell, live surfaces now throw on 401 and a
 * redirect reads better than a failure card, and the fixture-backed screens
 * become real endpoints later.
 *
 * Note what this does NOT wrap: /widget. That is the student surface, and a
 * student is never a Clerk user. Gating the whole shell would lock them out
 * of the product.
 */
import type { ReactNode } from "react";
import { useAuth } from "@clerk/react";
import { Navigate, useLocation } from "react-router-dom";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, orgId } = useAuth();
  const location = useLocation();

  // Clerk resolves asynchronously. Rendering the signed-out branch before it
  // loads would bounce every signed-in user through /login for a frame.
  if (!isLoaded) return <ConsoleLoading />;

  if (!isSignedIn) {
    // Carry where they were going, so signing in returns them there rather
    // than dumping everyone on the same landing page.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  // Signed in, but no organization is active — they authenticated and never
  // finished creating an agency. Sending them to /login would loop: they are
  // already signed in, so Clerk would send them straight back here.
  //
  // The backend says the same thing in its own language: 403
  // `no_active_organization` from require_auth.
  if (!orgId) return <Navigate to="/create-agency" replace />;

  return <>{children}</>;
}

/** Deliberately quiet. This shows for a few hundred milliseconds at most, and
 *  a spinner that flashes is worse than a still frame. */
function ConsoleLoading() {
  return (
    <div
      className="grid h-screen place-items-center"
      style={{ background: "var(--color-bg)" }}
    >
      <p className="text-[13px]" style={{ color: "var(--color-neutral-600)" }}>
        Loading your agency…
      </p>
    </div>
  );
}
