/** Tenant configuration for the demo agency.
 *
 * `tenant_id` in the seed data is "northbound-demo". Keys here are display
 * placeholders — nothing in this lab issues or validates a widget key, and
 * Rotate is inert and labelled as such on the Setup surface.
 *
 * Fixture, not live data. There is no tenant endpoint.
 */
import type { TenantConfig } from "../types";

export const TENANT: TenantConfig = {
  name: "Northbound Demo Agency",
  city: "Colombo",
  catalogue_country: "UK, Australia, Canada and Germany",
  public_key: "pk_live_nbd_8f2c41",
  secret_key_masked: "sk_live_••••••••••4b7e",
  allowed_origins: ["northbound.example", "www.northbound.example"],
  last_used: "2 minutes ago",
  widget: {
    accent: "#c67139",
    greeting:
      "Evening — the office is closed, but I can start your assessment now.",
    position: "right",
  },
};

/** The four brand colours the widget offers.
 *
 *  These are the only literal hex values outside styles/organic.css, and they
 *  are deliberate: a tenant's brand colour is DATA the agency chose, not a
 *  design-system token. It travels to a script tag on their own site, so it
 *  cannot be a `var(--…)` reference into a stylesheet that will not be there.
 *
 *  The first two happen to equal --color-accent and --color-accent-2, which
 *  is why the default widget looks like the rest of the console. */
export const WIDGET_ACCENTS = ["#c67139", "#7a8a5e", "#3f5c7a", "#8a5e7a"];

export function embedSnippet(publicKey: string, position: "left" | "right") {
  return `<script src="https://cdn.northbound.app/w.js"
        data-key="${publicKey}"
        data-position="bottom-${position}" async><\/script>`;
}
