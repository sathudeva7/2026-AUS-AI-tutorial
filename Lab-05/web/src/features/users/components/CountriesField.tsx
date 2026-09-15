/** Which destinations this person owns, and changing the set.
 *
 * `PUT /api/users/{id}/countries` — a REPLACE, not a diff. Adding one country
 * sends the whole set, which is why every write here is built from
 * `user.countries` rather than from a list this component accumulates: two
 * managers editing the same person otherwise overwrite each other with
 * whatever their tab happened to be holding.
 *
 * Ownership is not decoration. It decides which leads this person can see and
 * which leads the agent will route to them, so the empty state says what the
 * consequence is instead of just noting the absence.
 *
 * A field inside the contact card rather than a card of its own — see
 * ContactCard. It keeps the contact card's label column so the term lines up
 * with Name, Email and the rest.
 */
import { useState } from "react";

import { Select, type SelectOption } from "@/components/ui/Select";
import { COUNTRIES } from "@/data/countries";
import { useSession } from "@/data/SessionProvider";

import { countryName } from "../display";
import { useSetUserCountries } from "../queries";
import type { User } from "../types";
import { CloseIcon, GlobeIcon, PlusIcon } from "@/components/ui/icons";

export function CountriesField({ user }: { user: User }) {
  const { can } = useSession();
  const setCountries = useSetUserCountries(user.id);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Not self-editable, unlike contact details and hours. Country ownership is
  // a routing decision for the agency, not a personal setting — someone
  // quietly granting themselves the busiest destination is the thing this
  // permission exists to stop. Backend enforces it; this only hides the
  // control.
  const mayEdit = can("users.countries.manage");

  // Already-owned countries are not offered. Sending a duplicate would either
  // be refused or silently collapse, and neither is worth finding out from a
  // dropdown.
  const options: SelectOption[] = COUNTRIES.filter(
    (c) => !user.countries.includes(c.code),
  ).map((c) => ({
    value: c.code,
    label: c.name,
    prefix: c.flag,
    detail: c.code,
    keywords: c.code,
  }));

  async function write(next: string[]) {
    setError(null);
    try {
      await setCountries.mutateAsync(next);
      setAdding(false);
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <dl className="console-dl" data-variant="icons">
        <dt>
          <GlobeIcon className="console-dl-icon" />
          Countries
        </dt>
        <dd>
          {user.countries.length ? (
            <div className="flex flex-wrap items-center gap-1.5">
              {user.countries.map((country) => (
                <span
                  key={country}
                  className="console-country"
                  data-removable={mayEdit ? "true" : undefined}
                  // The code is what the column stores and what the write
                  // sends; the tooltip keeps it reachable for anyone checking
                  // against the API, without making people decode the screen.
                  title={country}
                >
                  {countryName(country)}
                  {mayEdit ? (
                    <button
                      type="button"
                      className="console-country-remove"
                      disabled={setCountries.isPending}
                      aria-label={`Remove ${countryName(country)}`}
                      onClick={() =>
                        void write(user.countries.filter((c) => c !== country))
                      }
                    >
                      <CloseIcon size={11} />
                    </button>
                  ) : null}
                </span>
              ))}
              {mayEdit && !adding ? <AddChip onClick={() => setAdding(true)} /> : null}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span>No countries assigned</span>
              {mayEdit && !adding ? <AddChip onClick={() => setAdding(true)} /> : null}
            </div>
          )}

          {/* The consequence, not just the absence. A counsellor owning
              nothing is how the unassigned queue fills, which is a fact about
              routing rather than a gap to tidy away. */}
          {user.countries.length === 0 ? (
            <p className="console-hint">
              Leads for a destination nobody owns join the unassigned queue,
              where everyone can see them. The agent will not route a lead to
              someone who does not cover the country.
            </p>
          ) : null}
        </dd>
      </dl>

      {adding ? (
        <div className="mt-3 flex max-w-[380px] items-center gap-2">
          <Select
            value=""
            options={options}
            placeholder="Choose a country…"
            ariaLabel="Country to add"
            disabled={setCountries.isPending}
            onChange={(code) => void write([...user.countries, code])}
          />
          <button
            type="button"
            className="console-btn"
            data-variant="secondary"
            disabled={setCountries.isPending}
            onClick={() => {
              setAdding(false);
              setError(null);
            }}
          >
            Cancel
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="console-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

function AddChip({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="console-chip-add" onClick={onClick}>
      <PlusIcon size={12} />
      Add country
    </button>
  );
}
