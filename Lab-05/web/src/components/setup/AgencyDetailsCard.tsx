/** Agency phone and address, edited by an owner.
 *
 * Deliberately here rather than at signup. CreateAgencyRoute asks only for a
 * name — everything else is configuration and belongs in the console, where
 * there is an agency to attach it to and context for what the fields are for.
 *
 * The name is displayed, never edited. `tenants.name` is a cache of Clerk's
 * organization name; a field writing it here would drift until the next sync
 * overwrote whatever was typed. Renaming goes through Clerk.
 *
 * Non-owners see the details read-only. That is presentation, not protection —
 * PATCH /api/tenant re-checks `tenant.settings` server-side, because a hidden
 * form is still reachable with curl.
 */
import { useEffect, useState } from "react";
import { Button, Card, CardTitle, Field, Input, Select } from "@/components/ui";
import type { SelectOption } from "@/components/ui";
import { useSession } from "@/data/SessionProvider";
import { COUNTRIES, COUNTRY_BY_CODE } from "@/data/countries";
import {
  fetchTenant,
  FieldValidationError,
  patchTenant,
  type Tenant,
} from "@/data/live";

interface Draft {
  /** The phone's COUNTRY, not its dialling code.
   *
   *  Storing the dial code here was a bug: eleven codes are shared between
   *  countries, so "44" cannot say whether the user picked the UK or Guernsey,
   *  and the picker rendered whichever came first alphabetically. The ISO code
   *  is unique, which also gives the option list unique React keys. The dial
   *  code is looked up from it when building E.164. */
  phoneCountry: string;
  national: string;
  address_line1: string;
  address_line2: string;
  city: string;
  region: string;
  postal_code: string;
  country: string;
}

const EMPTY: Draft = {
  phoneCountry: "",
  national: "",
  address_line1: "",
  address_line2: "",
  city: "",
  region: "",
  postal_code: "",
  country: "",
};

/** The address country. Flag as prefix, name as label. */
const COUNTRY_OPTIONS: SelectOption[] = COUNTRIES.map((c) => ({
  value: c.code,
  label: c.name,
  prefix: c.flag,
  detail: c.code,
}));

/** Dialling codes, keyed by ISO country code so every option is distinct.
 *  The dial code rides along as the trailing detail and is searchable, so
 *  typing "94", "+94", "lk" or "sri" all find Sri Lanka. */
const DIAL_OPTIONS: SelectOption[] = COUNTRIES.map((c) => ({
  value: c.code,
  label: c.name,
  prefix: c.flag,
  detail: `+${c.dial}`,
  keywords: c.code,
}));

function toDraft(t: Tenant): Draft {
  return {
    // Both resolved server-side by libphonenumber; no prefix-guessing here.
    phoneCountry: t.phone_country ?? "",
    national: t.phone_national ?? "",
    address_line1: t.address_line1 ?? "",
    address_line2: t.address_line2 ?? "",
    city: t.city ?? "",
    region: t.region ?? "",
    postal_code: t.postal_code ?? "",
    country: t.country ?? "",
  };
}

export function AgencyDetailsCard() {
  const { can } = useSession();
  const editable = can("tenant.settings");

  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchTenant()
      .then((t) => {
        if (cancelled) return;
        setTenant(t);
        setDraft(toDraft(t));
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setSaved(false);
    // Clear this field's complaint the moment it is touched — leaving it under
    // an input someone is actively fixing reads as "still wrong".
    setErrors((e) => {
      const next = { ...e };
      delete next[key as string];
      if (key === "national" || key === "phoneCountry") delete next.phone;
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setErrors({});
    setSaved(false);
    const national = draft.national.replace(/\D/g, "");
    const dial = COUNTRY_BY_CODE[draft.phoneCountry]?.dial;
    try {
      const updated = await patchTenant({
        phone: national && dial ? `+${dial}${national}` : null,
        address_line1: draft.address_line1 || null,
        address_line2: draft.address_line2 || null,
        city: draft.city || null,
        region: draft.region || null,
        postal_code: draft.postal_code || null,
        country: draft.country || null,
      });
      setTenant(updated);
      setDraft(toDraft(updated));
      setSaved(true);
    } catch (e: unknown) {
      if (e instanceof FieldValidationError) setErrors(e.fields);
      else setErrors({ _: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <Card className="rounded-md p-[18px]">
        <CardTitle className="mb-3">Agency details</CardTitle>
        <p className="m-0 text-[13px]" style={{ color: "var(--color-accent-800)" }}>
          {loadError}
        </p>
      </Card>
    );
  }

  if (!tenant) {
    return (
      <Card className="rounded-md p-[18px]">
        <CardTitle className="mb-3">Agency details</CardTitle>
        <p className="m-0 text-[13px]" style={{ color: "var(--color-neutral-600)" }}>
          Loading…
        </p>
      </Card>
    );
  }

  const locked = !editable || saving;

  return (
    <Card className="rounded-md p-[18px]">
      <CardTitle className="mb-1">Agency details</CardTitle>
      <p
        className="m-0 mb-3 max-w-[60ch] text-[12.5px]"
        style={{ color: "var(--color-neutral-700)" }}
      >
        Shown to students in the widget and used on follow-up emails.{" "}
        <strong>{tenant.name}</strong> comes from your Clerk organization —
        rename it there and it updates here.
      </p>

      {!tenant.complete ? (
        <p
          className="mb-4 rounded-md px-3 py-2 text-[12.5px]"
          style={{
            background: "var(--color-accent-100)",
            border: "1px solid var(--color-accent-300)",
            color: "var(--color-accent-800)",
          }}
          role="note"
        >
          Not finished yet — a phone number, street address, city and country
          make the agency look real to a student deciding whether to trust it.
        </p>
      ) : null}

      <div className="flex flex-col gap-3.5">
        <Field
          label="Phone"
          htmlFor="agency-phone"
          error={errors.phone}
          hint="Pick the country, then the number without its leading zero."
        >
          <div className="flex gap-2">
            <Select
              className="w-[190px] flex-none"
              value={draft.phoneCountry}
              options={DIAL_OPTIONS}
              onChange={(v) => set("phoneCountry", v)}
              placeholder="Country code"
              ariaLabel="Dialling code"
              disabled={locked}
              invalid={Boolean(errors.phone)}
            />
            <Input
              id="agency-phone"
              className="flex-1"
              inputMode="tel"
              placeholder="742405977"
              value={draft.national}
              disabled={locked}
              aria-invalid={Boolean(errors.phone)}
              style={
                errors.phone ? { borderColor: "var(--color-danger)" } : undefined
              }
              onChange={(e) => set("national", e.target.value)}
            />
          </div>
        </Field>

        <Field label="Address" htmlFor="agency-a1" error={errors.address_line1}>
          <Input
            id="agency-a1"
            value={draft.address_line1}
            disabled={locked}
            aria-invalid={Boolean(errors.address_line1)}
            onChange={(e) => set("address_line1", e.target.value)}
          />
        </Field>

        <Field label="Address line 2" htmlFor="agency-a2" error={errors.address_line2}>
          <Input
            id="agency-a2"
            value={draft.address_line2}
            disabled={locked}
            onChange={(e) => set("address_line2", e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="City" htmlFor="agency-city" error={errors.city}>
            <Input
              id="agency-city"
              value={draft.city}
              disabled={locked}
              aria-invalid={Boolean(errors.city)}
              style={
                errors.city
                  ? { borderColor: "var(--color-danger)" }
                  : undefined
              }
              onChange={(e) => set("city", e.target.value)}
            />
          </Field>
          <Field label="Region or province" htmlFor="agency-region" error={errors.region}>
            <Input
              id="agency-region"
              value={draft.region}
              disabled={locked}
              onChange={(e) => set("region", e.target.value)}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Postal code" htmlFor="agency-postal" error={errors.postal_code}>
            <Input
              id="agency-postal"
              value={draft.postal_code}
              disabled={locked}
              onChange={(e) => set("postal_code", e.target.value)}
            />
          </Field>
          <Field label="Country" error={errors.country}>
            <Select
              value={draft.country}
              options={COUNTRY_OPTIONS}
              onChange={(v) => set("country", v)}
              placeholder="Select a country"
              ariaLabel="Country"
              disabled={locked}
              invalid={Boolean(errors.country)}
            />
          </Field>
        </div>
      </div>

      {errors._ ? (
        <p
          className="mt-3 mb-0 text-[12.5px]"
          style={{ color: "var(--color-accent-800)" }}
          role="alert"
        >
          {errors._}
        </p>
      ) : null}

      {editable ? (
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save details"}
          </Button>
          {saved ? (
            <span
              className="text-[12.5px]"
              style={{ color: "var(--color-accent-2-600)" }}
              role="status"
            >
              Saved
            </span>
          ) : null}
        </div>
      ) : (
        <p
          className="mt-4 mb-0 text-[12px]"
          style={{ color: "var(--color-neutral-600)" }}
        >
          Only an owner can change these.
        </p>
      )}
    </Card>
  );
}
