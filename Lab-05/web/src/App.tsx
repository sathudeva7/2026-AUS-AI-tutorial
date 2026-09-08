import { useEffect } from "react";
import { useAuth } from "@clerk/react";
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
} from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { setTokenProvider } from "@/api/client";
import { queryClient } from "@/api/queryClient";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { SessionProvider } from "@/data/SessionProvider";
import { AppShell } from "@/components/shell/AppShell";
import { WidgetRoute } from "@/routes/WidgetRoute";
import { DashboardRoute } from "@/routes/DashboardRoute";
import { AssistantRoute } from "@/routes/AssistantRoute";
import { CounsellorsRoute } from "@/routes/CounsellorsRoute";
import { CatalogueRoute } from "@/routes/CatalogueRoute";
import { ProgrammeEditorRoute } from "@/routes/ProgrammeEditorRoute";
import { SetupRoute } from "@/routes/SetupRoute";
import { LoginRoute } from "@/routes/LoginRoute";
import { SignupRoute } from "@/routes/SignupRoute";
import { CreateAgencyRoute } from "@/routes/CreateAgencyRoute";

/** Routing carries surface state so a counsellor can deep-link a lead and
 *  survive a refresh on it. The prototype held this in a `surface` field;
 *  that is fine for a click-through and wrong for an operator tool. */
/** Hands Clerk's `getToken` to the API client.
 *
 * `api/client.ts` is a plain module and cannot call a hook, so the token has
 * to arrive from inside the tree. Rendered once, above the routes, so it is
 * registered before any surface fetches.
 *
 * `getToken` returns null when signed out rather than throwing, which is what
 * keeps the student widget working: it runs on the agency's own site with no
 * Clerk session, and its endpoints are public.
 */
function AuthBridge() {
  const { getToken } = useAuth();
  useEffect(() => {
    setTokenProvider(() => getToken());
  }, [getToken]);
  return null;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthBridge />
        <Routes>
          {/* Outside the shell: no rail, because no agency is known yet.
            Splat paths are required — Clerk routes its own sub-steps
            (verification code, OAuth return, SSO callback) under these
            prefixes, and without the `/*` a refresh mid-flow 404s. */}
          <Route path="/login/*" element={<LoginRoute />} />
          <Route path="/signup/*" element={<SignupRoute />} />
          <Route path="/create-agency/*" element={<CreateAgencyRoute />} />

          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/widget" replace />} />

            {/* Public, and it must stay that way. The widget is the student
              surface — it renders on the agency's own website, where the
              visitor is a prospective student and never a Clerk user.
              Wrapping the whole shell in RequireAuth would lock students out
              of the product. Its backend endpoints (/api/run, POST
              /api/leads) are correspondingly public; they get their own
              boundary later, keyed on the tenant's widget key rather than on
              a user session. */}
            <Route path="/widget" element={<WidgetRoute />} />

            {/* Everything below is the counsellor console. The real boundary is
              require_auth in student_agent/auth.py; this only decides what a
              browser is shown on the way there. */}
            <Route
              element={
                <RequireAuth>
                  <SessionProvider>
                    <Outlet />
                  </SessionProvider>
                </RequireAuth>
              }
            >
              <Route path="/leads" element={<DashboardRoute />} />
              <Route path="/leads/:leadId" element={<DashboardRoute />} />
              <Route path="/assistant" element={<AssistantRoute />} />
              <Route path="/counsellors" element={<CounsellorsRoute />} />
              <Route
                path="/counsellors/:counsellorId"
                element={<CounsellorsRoute />}
              />
              <Route path="/catalogue" element={<CatalogueRoute />} />
              <Route path="/catalogue/new" element={<ProgrammeEditorRoute />} />
              <Route
                path="/catalogue/:programmeId"
                element={<ProgrammeEditorRoute />}
              />
              <Route path="/setup" element={<SetupRoute />} />
            </Route>

            <Route path="*" element={<Navigate to="/widget" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
