/** A counsellor's contact details, and editing them in place.
 *
 * `PATCH /api/users/{id}` — name and work phone. Timezone is displayed but not
 * editable yet; it gets its own step alongside the availability grid, because
 * changing a zone reinterprets every hour already stored against it.
 */
import { useState } from "react";

import { FieldValidationError } from "@/api/errors";
import { Button, Card, Field, Input, Kicker } from "@/components/ui";
import { Select, type SelectOption } from "@/components/ui/Select";
import { COUNTRIES } from "@/data/countries";
import { useSession } from "@/data/SessionProvider";

import { usePatchUser } from "../queries";
import { composeE164, splitE164 } from "../phone";
import type { User } from "../types";

const DIAL_OPTIONS: SelectOption[] = COUNTRIES.map((c) => ({
  value: c.code,
  label: `${c.flag} +${c.dial}`,
  hint: c.name,
}));

export function ContactCard({ user }: { user: User }) {
  const { session, can } = useSession();
  const [editing, setEditing] = useState(false);

  // Self, or users.edit. The same rule the endpoint enforces — everyone may
  // edit their own row, which is why this is not a plain permission check.
  //
  // This is UX, not security: the backend re-checks, and a hidden button is
  // not a permission.
  const mayEdit = can("users.edit") || session?.user_id === user.id;

  return (
    <Card className="rounded-md p-4">
      <div className="flex items-start justify-between gap-3">
        <Kicker>Contact</Kicker>
        {mayEdit && !editing ? (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Edit
          </Button>
        ) : null}
      </div>

      {editing ? (
        <ContactForm user={user} onDone={() => setEditing(false)} />
      ) : (
        <ContactView user={user} />
      )}
    </Card>
  );
}

function ContactView({ user }: { user: User }) {
  return (
    <dl className="m-0 mt-3 grid grid-cols-[130px_1fr] gap-y-2 text-[13px]">
      <dt style={{ color: "var(--color-neutral-700)" }}>Name</dt>
      <dd className="m-0">{user.name ?? "Not set"}</dd>

      <dt style={{ color: "var(--color-neutral-700)" }}>Email</dt>
      {/* Identity, and not editable here: it is the link to Clerk and the
          address an invitation was accepted on. */}
      <dd className="m-0">{user.email}</dd>

      <dt style={{ color: "var(--color-neutral-700)" }}>Work phone</dt>
      {/* A product contact, not HR: the number a colleague rings about an
          escalation, which is why every member can see it. */}
      <dd className="m-0">{user.work_phone ?? "Not given"}</dd>

      <dt style={{ color: "var(--color-neutral-700)" }}>Timezone</dt>
      {/* Their zone, not the viewer's. Availability is wall clock read against
          this, so it is a working fact rather than trivia. */}
      <dd className="m-0">{user.timezone}</dd>
    </dl>
  );
}

function ContactForm({ user, onDone }: { user: User; onDone: () => void }) {
  const patch = usePatchUser(user.id);
  const initialPhone = splitE164(user.work_phone);

  const [name, setName] = useState(user.name ?? "");
  const [country, setCountry] = useState(initialPhone.country);
  const [national, setNational] = useState(initialPhone.national);
  const [errors, setErrors] = useState<Record<string, string>>({});

  /** Keeps the box to things a phone number is made of.
   *
   * Letters are dropped as they are typed, so "asdsa" never lands in a field
   * whose only job is to hold a number — the person sees nothing appear, which
   * is the signal. Spaces, dashes and brackets stay, because people paste
   * numbers written that way and stripping them makes the field fight back.
   *
   * A value beginning with + is treated as a whole international number and
   * split across both controls. Otherwise pasting "+94771234567" beside a
   * country already set to Sri Lanka would compose +9494771234567 — a number
   * that is wrong in a way nobody would spot on screen.
   */
  function onPhoneChange(raw: string) {
    if (raw.trimStart().startsWith("+")) {
      const parts = splitE164(raw);
      if (parts.country) setCountry(parts.country);
      setNational(parts.national);
      return;
    }
    setNational(raw.replace(/[^\d\s()-]/g, ""));
  }

  async function save() {
    setErrors({});

    // Only what CHANGED. The endpoint distinguishes a field that was omitted
    // from one sent as null: omitted means leave it, null means clear it.
    // Sending all three every time would mean two people editing the same
    // person overwrite each other on fields neither of them touched.
    const body: { name?: string | null; work_phone?: string | null } = {};

    const nextName = name.trim() || null;
    if (nextName !== (user.name ?? null)) body.name = nextName;

    // Anything in the box that is not a number is refused rather than ignored.
    //
    // Both branches guard the same failure: composeE164 returns null when it
    // cannot build a number, and null is what the API reads as "clear this
    // field". So without these, typing something unusable and pressing Save
    // discards it, reports success, and closes — the worst of the three
    // possible outcomes, because nothing on screen says the input was lost.
    const digits = national.replace(/\D/g, "");
    if (national.trim() && !digits) {
      setErrors({ work_phone: "Enter the number in digits, for example 771234567." });
      return;
    }
    if (digits && !country) {
      setErrors({ work_phone: "Choose the country for this number." });
      return;
    }

    const nextPhone = composeE164({ country, national });
    if (nextPhone !== (user.work_phone ?? null)) body.work_phone = nextPhone;

    if (Object.keys(body).length === 0) {
      onDone();
      return;
    }

    try {
      await patch.mutateAsync(body);
      onDone();
    } catch (e: unknown) {
      // The backend names the field it refused — "work_phone" for a number
      // that is not real in its country — so the complaint lands on the input
      // rather than in a banner above the form.
      if (e instanceof FieldValidationError) setErrors(e.fields);
      else setErrors({ _: (e as Error).message });
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-3">
      <Field label="Name" htmlFor="user-name" error={errors.name}>
        <Input
          id="user-name"
          value={name}
          disabled={patch.isPending}
          aria-invalid={Boolean(errors.name)}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>

      <Field
        label="Work phone"
        htmlFor="user-phone"
        hint="Colleagues ring this about an escalation. Clear it to remove it."
        error={errors.work_phone}
      >
        <div className="flex gap-2">
          <Select
            value={country}
            options={DIAL_OPTIONS}
            onChange={setCountry}
            disabled={patch.isPending}
            invalid={Boolean(errors.work_phone)}
            placeholder="Country"
            ariaLabel="Phone country"
          />
          <Input
            id="user-phone"
            value={national}
            disabled={patch.isPending}
            aria-invalid={Boolean(errors.work_phone)}
            placeholder="771234567"
            inputMode="tel"
            autoComplete="tel-national"
            onChange={(e) => onPhoneChange(e.target.value)}
          />
        </div>
      </Field>

      {errors._ ? (
        <p
          role="alert"
          className="m-0 text-[12.5px]"
          style={{ color: "var(--color-danger)" }}
        >
          {errors._}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button onClick={save} disabled={patch.isPending}>
          {patch.isPending ? "Saving…" : "Save"}
        </Button>
        <Button variant="secondary" disabled={patch.isPending} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
