/** A counsellor's contact details, and editing them in place.
 *
 * `PATCH /api/users/{id}` — name and work phone. Timezone is displayed but not
 * editable yet; it gets its own step alongside the availability grid, because
 * changing a zone reinterprets every hour already stored against it.
 *
 * Owned countries sit at the bottom of this card rather than in a card of
 * their own. They are one more field of one person's record, and giving them
 * a panel beside this one made the layout the subject — two headed boxes of
 * unequal height for four fields and a row of two-letter chips.
 *
 * They are OUTSIDE the view/form swap on purpose. Countries are written by a
 * different endpoint under a different permission, so they are editable while
 * the name and phone are not, and they must not vanish from the card just
 * because somebody opened the name field.
 *
 * `editing` is owned by the panel above rather than by this card, because the
 * profile header carries an Edit button too and two components each holding
 * their own copy of one boolean is how you get a header saying "Edit" above a
 * card that is already open.
 */
import { useState } from "react";

import { FieldValidationError } from "@/api/errors";
import { Select, type SelectOption } from "@/components/ui/Select";
import { COUNTRIES } from "@/data/countries";

import { usePatchUser } from "../queries";
import { composeE164, splitE164 } from "../phone";
import type { User } from "../types";
import { CountriesField } from "./CountriesField";
import { ClockIcon, MailIcon, PersonIcon, PhoneIcon } from "@/components/ui/icons";

const DIAL_OPTIONS: SelectOption[] = COUNTRIES.map((c) => ({
  value: c.code,
  label: `${c.flag} +${c.dial}`,
  hint: c.name,
}));

export function ContactCard({
  user,
  editing,
  onDone,
}: {
  user: User;
  /** Held by the panel above — see UserDetail. */
  editing: boolean;
  onDone: () => void;
}) {
  return (
    <section className="console-card">
      <div className="console-card-head">
        <h3 className="console-section-title">
          <span className="inline-flex items-center gap-2">
            <PersonIcon size={17} />
            Contact information
          </span>
        </h3>
        {/* No Edit button here, unlike the reference design.
            Name and work phone are the ONLY things about a person this panel
            can edit, so a button on this card and a button in the header
            would open the same form — two controls, one action, and a
            "which one do I press" the screen cannot answer. The header's is
            the one kept, because it is where the design puts the emphasis and
            because it is reachable without scrolling past the tiles.
            When there is a second editable group up here, this comes back. */}
      </div>

      <div className="console-card-body">
        {editing ? (
          <ContactForm user={user} onDone={onDone} />
        ) : (
          <ContactView user={user} />
        )}

        <div className="console-card-split">
          <CountriesField user={user} />
        </div>
      </div>
    </section>
  );
}

function ContactView({ user }: { user: User }) {
  return (
    <dl className="console-dl" data-variant="icons">
      <dt>
        <PersonIcon className="console-dl-icon" />
        Name
      </dt>
      <dd>{user.name ?? "Not set"}</dd>

      <dt>
        <MailIcon className="console-dl-icon" />
        Email
      </dt>
      {/* Identity, and not editable here: it is the link to Clerk and the
          address an invitation was accepted on. */}
      <dd>{user.email}</dd>

      <dt>
        <PhoneIcon className="console-dl-icon" />
        Work phone
      </dt>
      {/* A product contact, not HR: the number a colleague rings about an
          escalation, which is why every member can see it. */}
      <dd>{user.work_phone ?? "Not given"}</dd>

      <dt>
        <ClockIcon className="console-dl-icon" />
        Timezone
      </dt>
      {/* Their zone, not the viewer's. Availability is wall clock read against
          this, so it is a working fact rather than trivia. */}
      <dd>{user.timezone}</dd>
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
      setErrors({
        work_phone: "Enter the number in digits, for example 771234567.",
      });
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
    <div className="flex max-w-[460px] flex-col gap-4">
      <div>
        <label className="console-label" htmlFor="user-name">
          Name
        </label>
        <input
          id="user-name"
          className="console-input"
          value={name}
          disabled={patch.isPending}
          aria-invalid={Boolean(errors.name)}
          onChange={(e) => setName(e.target.value)}
        />
        {errors.name ? (
          <p className="console-error" role="alert">
            {errors.name}
          </p>
        ) : null}
      </div>

      <div>
        <label className="console-label" htmlFor="user-phone">
          Work phone
        </label>
        <div className="flex gap-2">
          <Select
            className="console-dial"
            value={country}
            options={DIAL_OPTIONS}
            onChange={setCountry}
            disabled={patch.isPending}
            invalid={Boolean(errors.work_phone)}
            placeholder="Country"
            ariaLabel="Phone country"
          />
          <input
            id="user-phone"
            className="console-input"
            value={national}
            disabled={patch.isPending}
            aria-invalid={Boolean(errors.work_phone)}
            placeholder="771234567"
            inputMode="tel"
            autoComplete="tel-national"
            onChange={(e) => onPhoneChange(e.target.value)}
          />
        </div>
        {/* The complaint replaces the guidance rather than stacking under it —
            two lines of small print below one input is where people stop
            reading either. */}
        {errors.work_phone ? (
          <p className="console-error" role="alert">
            {errors.work_phone}
          </p>
        ) : (
          <p className="console-hint">
            Colleagues ring this about an escalation. Clear it to remove it.
          </p>
        )}
      </div>

      {errors._ ? (
        <p className="console-error" role="alert">
          {errors._}
        </p>
      ) : null}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          className="console-btn"
          data-variant="primary"
          onClick={save}
          disabled={patch.isPending}
        >
          {patch.isPending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="console-btn"
          data-variant="secondary"
          disabled={patch.isPending}
          onClick={onDone}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
