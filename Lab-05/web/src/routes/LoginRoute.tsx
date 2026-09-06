/** Sign in. Clerk owns the form; the panel beside it is ours.
 *
 * There is no "which agency?" question here. A person's organizations come
 * from their Clerk session, and if they belong to more than one the switcher
 * in the console rail moves between them. Asking up front would mean
 * enumerating tenants to someone who has not authenticated yet.
 */
import { SignIn } from "@clerk/react";
import { AuthLayout } from "@/components/auth/AuthLayout";

export function LoginRoute() {
  return (
    <AuthLayout
      image="/login.webp"
      aside={
        <>
          <h1 className="m-0 text-[38px] leading-[1.08]">
            The first reply, at the hour it arrives.
          </h1>
          <p
            className="mt-4 text-[14px] leading-relaxed"
            style={{ color: "var(--color-neutral-800)" }}
          >
            Inquiries come in around the clock; counsellors answer during
            office hours. Northbound qualifies the student, matches them
            against your catalogue, and hands the lead over when your rules say
            so — so your counsellors&apos; time goes to the students who are
            ready.
          </p>
        </>
      }
    >
      <h1 className="m-0 text-[32px]">Sign in</h1>
      <p
        className="mb-6 mt-1.5 text-[13.5px]"
        style={{ color: "var(--color-neutral-700)" }}
      >
        Use the work address your agency invited you on.
      </p>

      <SignIn
        routing="path"
        path="/login"
        signUpUrl="/signup"
        fallbackRedirectUrl="/leads"
      />
    </AuthLayout>
  );
}
