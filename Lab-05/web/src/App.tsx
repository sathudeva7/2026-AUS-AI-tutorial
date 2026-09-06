import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
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
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Outside the shell: no rail, because no agency is known yet.
            Splat paths are required — Clerk routes its own sub-steps
            (verification code, OAuth return, SSO callback) under these
            prefixes, and without the `/*` a refresh mid-flow 404s.

            These are not yet a security boundary: the API has no auth, so a
            frontend gate would only look like one. Once FastAPI verifies the
            Clerk session, the console routes get gated for real. */}
        <Route path="/login/*" element={<LoginRoute />} />
        <Route path="/signup/*" element={<SignupRoute />} />
        <Route path="/create-agency/*" element={<CreateAgencyRoute />} />

        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/widget" replace />} />
          <Route path="/widget" element={<WidgetRoute />} />
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
          <Route path="*" element={<Navigate to="/widget" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
