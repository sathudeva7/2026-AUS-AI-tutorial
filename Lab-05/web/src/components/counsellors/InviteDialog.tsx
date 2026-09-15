/** Invite someone to this agency.
 *
 * `POST /api/users/invite` — owner-only, and it takes an address and a role.
 * That is the whole payload, so that is the whole form.
 *
 * What used to be here was a prototype: a full name, four invented role
 * names, destinations, specialisations, languages, a caseload-cap slider, an
 * escalations switch and four permission toggles. One field of the ten
 * reached the API. The rest described a product that does not exist —
 * `users` has no cap column, no specialisation or language columns, and
 * permissions are a code constant plus per-user grants with no invite-time
 * API at all. A form that collects a caseload cap and drops it on submit is
 * worse than one that never asked.
 *
 * Two fields, both real:
 *
 *   email   the invitation is minted for this address and only the person
 *           holding that mail can accept. There is deliberately no domain
 *           check: small agencies run on Gmail and agencies with branches
 *           run on several domains, and anyone able to guess an address on
 *           the domain would be inside. Membership defines the agency
 *           (CLAUDE.md), and Clerk's per-address invitation is what enforces
 *           it.
 *
 *   role    counsellor | manager | owner, exactly as the column stores them.
 *           The notes under each are read off permissions.py rather than
 *           invented, because the difference between a manager and an owner
 *           is the reason somebody is choosing.
 *
 * No name field. The invite knows only an address; the name arrives from
 * Clerk when they accept, and asking for one here would collect something
 * the request cannot carry.
 *
 * No countries either, though routing needs them. Ownership is a second
 * endpoint against an id that does not exist until this call returns, and a
 * two-call submit that half-fails leaves somebody invited with the countries
 * silently dropped. They are assigned on the person's record once they are
 * on the roster, where the failure has somewhere to be reported.
 */
import { useState } from "react";

import { ApiRequestError } from "@/api/errors";
import { Dialog } from "@/components/ui/Dialog";
import { MailIcon } from "@/components/ui/icons";
import { useInviteUser } from "@/features/users/queries";
import type { Role } from "@/features/users/types";

const ROLES: { value: Role; label: string; note: string }[] = [
  {
    value: "counsellor",
    label: "Counsellor",
    note: "Sees the leads for countries they own, plus the unassigned queue. Reads the catalogue and can flag an entry as wrong.",
  },
  {
    value: "manager",
    label: "Manager",
    note: "Everything a counsellor does, across every lead in the agency. Edits and verifies the catalogue, assigns leads, and sets who owns which country.",
  },
  {
    value: "owner",
    label: "Owner",
    note: "Everything a manager does, plus inviting people, switching off access and the agency's own settings.",
  },
];

/** The API's refusals, in words that say what to do next.
 *
 * `code` rather than `message`: the server's prose is decent, but these three
 * are the outcomes a person acts on differently, and the codes are the stable
 * thing to branch on. */
function explain(error: unknown): string {
  if (error instanceof ApiRequestError) {
    switch (error.code) {
      case "ALREADY_A_MEMBER":
        return "That address is already on your roster.";
      case "ALREADY_INVITED":
        // Their invitation stands; sending a second one is not the fix.
        return "That address has already been invited. Their invitation is still valid.";
      case "INVITE_NOT_SENT":
        return "The invitation could not be sent. Nobody has been added — try again in a moment.";
    }
  }
  return (error as Error).message;
}

export function InviteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const invite = useInviteUser();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("counsellor");
  const [error, setError] = useState<string | null>(null);
  /** The address the last successful invitation went to. Shown instead of
   *  closing the sheet: an agency onboarding a branch invites four people in
   *  a row, and a dialog that shuts after each one makes that four trips. */
  const [sent, setSent] = useState<string | null>(null);

  const trimmed = email.trim();
  const emailBad =
    trimmed.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
  const ready = trimmed.length > 0 && !emailBad && !invite.isPending;

  function close() {
    onOpenChange(false);
    // Reset on the way out, not on the way in: reopening should not be
    // holding the last person's address, and clearing here keeps the sheet
    // from flickering blank as it animates away.
    setEmail("");
    setRole("counsellor");
    setError(null);
    setSent(null);
  }

  async function send() {
    if (!ready) return;
    setError(null);
    try {
      await invite.mutateAsync({ email: trimmed, role });
      setSent(trimmed);
      setEmail("");
    } catch (e: unknown) {
      setSent(null);
      setError(explain(e));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title="Invite a counsellor"
      description="They get an email invitation. Nothing is routed to them until they accept, and not then either until somebody gives them a country."
      footer={
        <>
          <button
            type="button"
            className="console-btn"
            data-variant="secondary"
            onClick={close}
          >
            {sent ? "Done" : "Cancel"}
          </button>
          <button
            type="button"
            className="console-btn"
            data-variant="primary"
            onClick={send}
            disabled={!ready}
          >
            {invite.isPending ? "Sending…" : "Send invitation"}
          </button>
        </>
      }
    >
      <div>
        <label className="console-label" htmlFor="invite-email">
          Work email
        </label>
        <input
          id="invite-email"
          className="console-input max-w-[420px]"
          type="email"
          value={email}
          placeholder="name@agency.com"
          autoComplete="off"
          disabled={invite.isPending}
          aria-invalid={emailBad || undefined}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void send();
          }}
        />
        {emailBad ? (
          <p className="console-error" role="alert">
            That does not look like an email address.
          </p>
        ) : (
          <p className="console-hint">
            The invitation is minted for this address, and only the person who
            receives it can accept.
          </p>
        )}
      </div>

      <div>
        <div className="console-label">Role</div>
        <div
          className="flex flex-col gap-2"
          role="radiogroup"
          aria-label="Role"
        >
          {ROLES.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={role === option.value}
              disabled={invite.isPending}
              className="console-choice"
              onClick={() => setRole(option.value)}
            >
              <span className="console-choice-dot" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="console-choice-label">{option.label}</span>
                <span className="console-choice-note">{option.note}</span>
              </span>
            </button>
          ))}
        </div>
        <p className="console-hint">
          A role can be changed later. Owner includes inviting and switching
          off other people, so it is the one worth a second thought.
        </p>
      </div>

      {error ? (
        <p className="console-error m-0" role="alert">
          {error}
        </p>
      ) : null}

      {sent ? (
        <div className="console-sent" role="status">
          <MailIcon size={17} className="console-sent-icon" />
          <span>
            Invitation sent to <strong>{sent}</strong>. They appear on the
            roster as invited until they accept. Invite someone else, or close
            this.
          </span>
        </div>
      ) : null}
    </Dialog>
  );
}
