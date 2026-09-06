/** Step two of two: create the agency.
 *
 * A Clerk Organization IS the tenant. Its id becomes `tenant_id` on every
 * record, and — once the API verifies the session — it arrives from a signed
 * token rather than from anything the client can set. That is what makes
 * CLAUDE.md's "every query filters on tenant_id" enforceable instead of a
 * convention someone has to remember.
 *
 * Only the name is asked for. Destinations, counsellors and widget settings
 * are configuration, and they belong in the console where there is context
 * for them.
 */
import { CreateOrganization, useOrganizationList, useUser } from "@clerk/react";
import { Navigate } from "react-router-dom";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { StepHeader } from "./SignupRoute";

export function CreateAgencyRoute() {
  const { isLoaded: userLoaded, isSignedIn } = useUser();
  const { isLoaded: listLoaded, userMemberships } = useOrganizationList({
    userMemberships: true,
  });

  // Order matters here. `useOrganizationList` only resolves for a signed-in
  // user, so waiting on `listLoaded` before checking `isSignedIn` leaves a
  // signed-out visitor on a permanently blank page instead of redirecting
  // them. Check the user first, then the memberships.
  if (!userLoaded) return null;
  if (!isSignedIn) return <Navigate to="/signup" replace />;
  if (!listLoaded) return null;

  // Someone who already belongs to an agency does not need this screen —
  // they arrive here by bookmark or by going back after finishing.
  const alreadyHasOrg = (userMemberships?.count ?? 0) > 0;
  if (alreadyHasOrg) return <Navigate to="/setup" replace />;

  return (
    <AuthLayout
      image="/signup.webp"
      aside={
        <>
          <h1 className="m-0 text-[38px] leading-[1.08]">
            One workspace per agency.
          </h1>
          <p
            className="mt-4 text-[14px] leading-relaxed"
            style={{ color: "var(--color-neutral-800)" }}
          >
            You will be its first administrator, and the only account that can
            invite counsellors until you add another. Everything your agency
            loads — catalogue, requirement rules, roster, country ownership —
            stays inside this workspace. No query ever crosses it.
          </p>
        </>
      }
    >
      <StepHeader
        step={2}
        title="Name your agency"
        blurb="This is what students see in the widget and what your counsellors sign in to."
      />

      <CreateOrganization
        routing="path"
        path="/create-agency"
        afterCreateOrganizationUrl="/setup"
        // The logo upload is a nice-to-have that does not belong between
        // someone and their first working screen. It is available later in
        // the organization profile.
        skipInvitationScreen
      />
    </AuthLayout>
  );
}
