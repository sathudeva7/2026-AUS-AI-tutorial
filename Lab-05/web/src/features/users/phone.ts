/** Moving between E.164 and the two boxes a person actually fills in.
 *
 * `users.work_phone` stores one string, "+94771234567". The form asks for a
 * country and a number, the way the agency details form does — nobody should
 * have to know what E.164 is to type their own phone number.
 *
 * Pure functions, kept out of the component so the awkward part — splitting a
 * stored number back apart — can be reasoned about on its own.
 */
import { COUNTRIES, COUNTRY_BY_CODE } from "@/data/countries";

/** Dial codes are not unique. +1 covers 25 countries in this list, +44 four,
 *  +61 three. A stored E.164 therefore does NOT say which country it came
 *  from, and any split is a guess.
 *
 *  It is a safe guess in one specific sense: the form recomposes dial +
 *  national, so the value written back is byte-identical to the one read
 *  regardless of which sibling country the picker landed on. Only the flag
 *  beside the box can be wrong, never the stored number.
 *
 *  This map makes that guess the likely one instead of "whichever country
 *  sorts first alphabetically", which is how +1 415 ends up flying the flag
 *  of American Samoa.
 */
const PREFERRED_FOR_DIAL: Record<string, string> = {
  "1": "US",
  "7": "RU",
  "39": "IT",
  "44": "GB",
  "47": "NO",
  "61": "AU",
  "212": "MA",
  "262": "RE",
  "358": "FI",
  "590": "GP",
  "599": "CW",
};

/** Longest first, so +94 is tried before +9 would be. */
const DIALS_LONGEST_FIRST = [...new Set(COUNTRIES.map((c) => c.dial))].sort(
  (a, b) => b.length - a.length,
);

export interface PhoneParts {
  /** ISO 3166-1 alpha-2, or "" when there is no number to split. */
  country: string;
  /** Digits only, no dial code. */
  national: string;
}

export function splitE164(phone: string | null | undefined): PhoneParts {
  if (!phone) return { country: "", national: "" };
  const digits = phone.replace(/\D/g, "");
  if (!digits) return { country: "", national: "" };

  for (const dial of DIALS_LONGEST_FIRST) {
    if (!digits.startsWith(dial)) continue;
    const country =
      PREFERRED_FOR_DIAL[dial] ??
      COUNTRIES.find((c) => c.dial === dial)?.code ??
      "";
    return { country, national: digits.slice(dial.length) };
  }

  // A number whose dial code is not in the list. Show it whole in the national
  // box rather than dropping it: it is somebody's real phone number, and
  // silently blanking the field on open would delete it on the next save.
  return { country: "", national: digits };
}

/** Back to what the API stores, or null to clear it.
 *
 *  Null and "" mean the same thing here — an emptied box is a cleared number,
 *  which the column allows. A counsellor who no longer wants to be rung about
 *  escalations should be able to remove it.
 */
export function composeE164(parts: PhoneParts): string | null {
  const national = parts.national.replace(/\D/g, "");
  if (!national) return null;
  const dial = COUNTRY_BY_CODE[parts.country]?.dial;
  if (!dial) return null;
  return `+${dial}${national}`;
}
