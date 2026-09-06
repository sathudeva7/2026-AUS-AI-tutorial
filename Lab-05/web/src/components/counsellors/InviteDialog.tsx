/** Invite a counsellor.
 *
 * The form is mostly routing configuration, and the copy exists to make one
 * thing unmissable: routing is explicit. Pick no destination and this person
 * is never handed a lead — the agent will not quietly give them one to
 * balance load. The summary line says exactly that while the field is empty.
 *
 * Role drives the defaults (cap, escalations, permissions) rather than
 * hiding them: a junior counsellor is capped and never receives escalations,
 * and the form says why instead of silently disabling a control.
 */
import { useMemo, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Button, Field, Input, Kicker, Pill, Toggle } from "@/components/ui";
import {
  INVITE_DESTINATIONS,
  INVITE_LANGUAGES,
  INVITE_SPECIALISATIONS,
} from "@/data/fixtures/counsellors";

export interface InviteDraft {
  name: string;
  email: string;
  role: RoleName;
  destinations: string[];
  specialisations: string[];
  languages: string[];
  cap: number;
  escalations: boolean;
  permissions: Record<PermissionKey, boolean>;
}

type RoleName =
  | "Senior counsellor"
  | "Counsellor"
  | "Junior counsellor"
  | "Branch manager";

type PermissionKey = "transcripts" | "catalogue" | "refresh" | "keys";

const ROLES: { label: RoleName; note: string }[] = [
  {
    label: "Senior counsellor",
    note: "Full routing, receives escalations, may edit the catalogue.",
  },
  {
    label: "Counsellor",
    note: "Full routing within their destinations and specialisations.",
  },
  {
    label: "Junior counsellor",
    note: "Supervised. Caseload capped at 12, never receives escalations.",
  },
  {
    label: "Branch manager",
    note: "Administration only. Excluded from the routing pool.",
  },
];

const PERMISSIONS: {
  key: PermissionKey;
  label: string;
  note: string;
  locked?: boolean;
  defaultFor: (role: RoleName) => boolean;
}[] = [
  {
    key: "transcripts",
    label: "View student transcripts",
    note: "Full conversation history for assigned leads",
    // Not negotiable: a counsellor cannot advise on a conversation they
    // cannot read.
    locked: true,
    defaultFor: () => true,
  },
  {
    key: "catalogue",
    label: "Edit the catalogue",
    note: "Programmes, fees, deadlines and entry requirements",
    defaultFor: (role) =>
      role === "Senior counsellor" || role === "Branch manager",
  },
  {
    key: "refresh",
    label: "Approve refresh items",
    note: "Accept or reject changes the overnight job proposes",
    defaultFor: (role) => role === "Branch manager",
  },
  {
    key: "keys",
    label: "Rotate API keys",
    note: "Regenerate the widget key for this tenant",
    defaultFor: (role) => role === "Branch manager",
  },
];

function capFor(role: RoleName): number {
  if (role === "Junior counsellor") return 12;
  if (role === "Branch manager") return 0;
  return 24;
}

export function InviteDialog({
  open,
  onOpenChange,
  onInvite,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvite: (draft: InviteDraft) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<RoleName>("Counsellor");
  const [destinations, setDestinations] = useState<string[]>([]);
  const [specialisations, setSpecialisations] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [cap, setCap] = useState<number | null>(null);
  const [escalations, setEscalations] = useState(false);
  const [perms, setPerms] = useState<Partial<Record<PermissionKey, boolean>>>({});

  const effectiveCap = cap ?? capFor(role);
  // A junior counsellor never receives escalations, whatever the toggle says.
  const effectiveEscalations = role === "Junior counsellor" ? false : escalations;
  const adminOnly = role === "Branch manager";

  // The domain check that used to live here is gone, and deliberately.
  //
  // It refused any address outside the tenant's own domain, which breaks the
  // customers this product is for: small agencies run on Gmail, and an agency
  // with branches in two countries has two domains. It was also a weak
  // control — anyone who could guess an address on the domain was inside.
  //
  // Clerk's invitation replaces it and is strictly stronger: the invitation
  // is minted for ONE address, delivered to it, and only the person holding
  // that mail can accept. Membership, not domain, is what makes someone part
  // of the agency.
  const emailBad = email.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const ready =
    name.trim().length > 2 &&
    !emailBad &&
    email.length > 0 &&
    (destinations.length > 0 || adminOnly);

  const summary = useMemo(() => {
    if (adminOnly) {
      return "Administrative account — excluded from routing, so no destinations are needed.";
    }
    if (!destinations.length) {
      return "Select at least one destination, or this counsellor will never be routed a lead. The agent does not round-robin to fill a gap.";
    }
    return (
      `Routed leads for ${destinations.join(", ")} · cap ${effectiveCap}` +
      (effectiveEscalations ? " · receives escalations" : "")
    );
  }, [adminOnly, destinations, effectiveCap, effectiveEscalations]);

  function toggle(list: string[], value: string): string[] {
    return list.includes(value)
      ? list.filter((v) => v !== value)
      : [...list, value];
  }

  function selectRole(next: RoleName) {
    setRole(next);
    setCap(null);
    setEscalations(next === "Senior counsellor");
    setPerms({});
  }

  function send() {
    if (!ready) return;
    onInvite({
      name: name.trim(),
      email,
      role,
      destinations,
      specialisations,
      languages,
      cap: effectiveCap,
      escalations: effectiveEscalations,
      permissions: Object.fromEntries(
        PERMISSIONS.map((p) => [
          p.key,
          p.locked ? true : (perms[p.key] ?? p.defaultFor(role)),
        ]),
      ) as Record<PermissionKey, boolean>,
    });
    setName("");
    setEmail("");
    setDestinations([]);
    setSpecialisations([]);
    setLanguages([]);
    setCap(null);
    setPerms({});
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Invite a counsellor"
      description="They receive an email invitation. Nothing is routed to them until they accept and set their availability."
      footer={
        <>
          <span
            className="flex-1 text-[12.5px]"
            style={{ color: "var(--color-neutral-700)" }}
          >
            {summary}
          </span>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={send}
            disabled={!ready}
            aria-disabled={!ready}
          >
            Send invitation
          </Button>
        </>
      }
    >
      <Steps />

      <section>
        <Kicker>Identity</Kicker>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Field label="Full name" htmlFor="invite-name">
            <Input
              id="invite-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Work email" htmlFor="invite-email">
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={emailBad || undefined}
            />
          </Field>
        </div>
        <div
          className="mt-2 text-[11.5px]"
          style={{
            color: emailBad
              ? "var(--color-accent-800)"
              : "var(--color-neutral-700)",
          }}
        >
          {emailBad
            ? "That does not look like an email address."
            : "The invitation is sent to this address, and only the person who receives it can accept."}
        </div>
      </section>

      <section>
        <Kicker>Role</Kicker>
        <div className="mt-2 flex flex-col gap-2" role="radiogroup" aria-label="Role">
          {ROLES.map((option) => {
            const on = role === option.label;
            return (
              <button
                key={option.label}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => selectRole(option.label)}
                className="flex cursor-pointer gap-3 rounded-md border p-3 text-left font-body"
                style={{
                  background: on
                    ? "var(--color-accent-2-100)"
                    : "var(--color-neutral-100)",
                  borderColor: on
                    ? "var(--color-accent-2-500)"
                    : "var(--color-divider)",
                }}
              >
                <span
                  className="mt-0.5 h-4 w-4 flex-none rounded-pill border-2"
                  style={{
                    background: on ? "var(--color-accent-2-600)" : "transparent",
                    borderColor: on
                      ? "var(--color-accent-2-600)"
                      : "var(--color-neutral-400)",
                  }}
                  aria-hidden="true"
                />
                <span className="flex-1">
                  <span className="block text-[13.5px] font-semibold">
                    {option.label}
                  </span>
                  <span
                    className="mt-0.5 block text-[12px]"
                    style={{ color: "var(--color-neutral-700)" }}
                  >
                    {option.note}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <Kicker>Routing</Kicker>
        <p
          className="mb-3 mt-2 max-w-[70ch] text-[12.5px]"
          style={{ color: "var(--color-neutral-700)" }}
        >
          The agent routes a lead to the first counsellor matching every rule
          with capacity left. A destination with no active owner sends leads to
          the unassigned queue — it never picks someone else to fill the gap.
        </p>

        <PillGroup
          label="Destinations"
          options={INVITE_DESTINATIONS}
          selected={destinations}
          onToggle={(v) => setDestinations((s) => toggle(s, v))}
          disabled={adminOnly}
        />
        <PillGroup
          label="Specialisations"
          options={INVITE_SPECIALISATIONS}
          selected={specialisations}
          onToggle={(v) => setSpecialisations((s) => toggle(s, v))}
        />
        <PillGroup
          label="Languages"
          options={INVITE_LANGUAGES}
          selected={languages}
          onToggle={(v) => setLanguages((s) => toggle(s, v))}
        />
      </section>

      <section>
        <Kicker>Capacity &amp; escalations</Kicker>
        <div className="mb-1.5 mt-2 flex items-center gap-3.5">
          <label
            htmlFor="invite-cap"
            className="w-[150px] flex-none text-[13px]"
          >
            Active caseload cap
          </label>
          <input
            id="invite-cap"
            type="range"
            className="nb-range"
            min={0}
            max={40}
            step={1}
            value={effectiveCap}
            onChange={(e) => setCap(Number(e.target.value))}
          />
          <span className="figure w-[76px] text-right text-[12.5px]">
            {effectiveCap} leads
          </span>
        </div>
        <p
          className="mb-3.5 mt-0 text-[11.5px]"
          style={{ color: "var(--color-neutral-700)" }}
        >
          {role === "Junior counsellor"
            ? "Junior counsellors are capped at 12 while supervised — the agent stops routing above the cap."
            : "The agent stops routing to this counsellor once their active caseload reaches the cap."}
        </p>

        <div
          className="flex items-start gap-3 rounded-md border p-3"
          style={{
            background: effectiveEscalations
              ? "var(--color-accent-2-100)"
              : "var(--color-neutral-100)",
            borderColor: effectiveEscalations
              ? "var(--color-accent-2-500)"
              : "var(--color-divider)",
          }}
        >
          <Toggle
            on={effectiveEscalations}
            onToggle={() => setEscalations((e) => !e)}
            label="Receive escalated leads"
            locked={role === "Junior counsellor"}
          />
          <span className="flex-1">
            <span className="block text-[13.5px] font-semibold">
              Receive escalated leads
            </span>
            <span
              className="mt-0.5 block text-[12px]"
              style={{ color: "var(--color-neutral-700)" }}
            >
              {role === "Junior counsellor"
                ? "Unavailable for junior counsellors. A declared visa refusal always routes to a senior counsellor."
                : "Leads that trip an escalation trigger — a declared refusal, a fee dispute, a request for a person — stop the agent and route here."}
            </span>
          </span>
        </div>
      </section>

      <section>
        <Kicker>Permissions</Kicker>
        <div className="mt-2 flex flex-col gap-2">
          {PERMISSIONS.map((permission) => {
            const on = permission.locked
              ? true
              : (perms[permission.key] ?? permission.defaultFor(role));
            return (
              <div
                key={permission.key}
                className="flex items-center gap-3 rounded-md px-3.5 py-[11px]"
                style={{ background: "var(--color-neutral-100)" }}
              >
                <span className="flex-1">
                  <span className="block text-[13px]">{permission.label}</span>
                  <span
                    className="block text-[11.5px]"
                    style={{ color: "var(--color-neutral-700)" }}
                  >
                    {permission.note}
                  </span>
                </span>
                <Toggle
                  on={on}
                  locked={permission.locked}
                  label={permission.label}
                  onToggle={() =>
                    setPerms((p) => ({ ...p, [permission.key]: !on }))
                  }
                />
              </div>
            );
          })}
        </div>
        <p
          className="m-0 mt-2.5 text-[11.5px]"
          style={{ color: "var(--color-neutral-700)" }}
        >
          {adminOnly
            ? "Branch managers hold every permission and are excluded from the routing pool."
            : "Transcript access is always on — a counsellor cannot advise on a conversation they cannot read."}
        </p>
      </section>
    </Dialog>
  );
}

function Steps() {
  const steps = [
    { n: "1", label: "Details", active: true },
    { n: "2", label: "They accept", active: false },
    { n: "3", label: "They set availability", active: false },
  ];
  return (
    <ol className="m-0 flex list-none items-center gap-4 p-0">
      {steps.map((step) => (
        <li key={step.n} className="flex items-center gap-2">
          <span
            className="grid h-[22px] w-[22px] place-items-center rounded-pill text-[11px]"
            style={{
              background: step.active
                ? "var(--color-accent)"
                : "var(--color-neutral-300)",
              color: step.active
                ? "var(--color-bg)"
                : "var(--color-neutral-900)",
            }}
          >
            {step.n}
          </span>
          <span
            className="text-[12.5px]"
            style={{
              color: step.active
                ? "var(--color-text)"
                : "var(--color-neutral-700)",
            }}
          >
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function PillGroup({
  label,
  options,
  selected,
  onToggle,
  disabled,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mb-4">
      <div
        className="mb-[7px] text-[12px]"
        style={{ color: "var(--color-neutral-700)" }}
        id={`group-${label}`}
      >
        {label}
      </div>
      <div
        className="flex flex-wrap gap-[7px]"
        role="group"
        aria-labelledby={`group-${label}`}
      >
        {options.map((option) => (
          <Pill
            key={option}
            role="checkbox"
            label={option}
            selected={selected.includes(option)}
            disabled={disabled}
            onClick={() => onToggle(option)}
          />
        ))}
      </div>
    </div>
  );
}
