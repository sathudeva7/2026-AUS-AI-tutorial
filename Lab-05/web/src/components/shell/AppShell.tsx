/** The console frame: a fixed rail and a scrolling main pane.
 *
 * Desktop-first, exactly as the reference is — `main` holds a 1180px floor
 * and the whole shell scrolls horizontally below that. These are dense
 * operator surfaces (a lead list beside a four-tab detail pane, a five-column
 * rule grid) and squeezing them onto a phone would mean designing a different
 * product, not a narrower one.
 *
 * The student widget is the exception. It is an embeddable panel a real
 * student opens on a real phone, so its route opts out of the floor.
 */
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  OrganizationSwitcher,
  Show,
  UserButton,
  useOrganization,
} from "@clerk/react";
import { repo } from "@/data/repo";

interface RailEntry {
  to: string;
  title: string;
  sub: string;
}

const RAIL: RailEntry[] = [
  { to: "/widget", title: "Student widget", sub: "Intake, shortlist, booking" },
  { to: "/leads", title: "Counsellor dashboard", sub: "Leads, profile, briefing" },
  { to: "/assistant", title: "Counsellor assistant", sub: "Ask across your leads" },
  { to: "/counsellors", title: "Counsellors", sub: "Roster, coverage, load" },
  { to: "/catalogue", title: "Catalogue console", sub: "Programmes, rules, freshness" },
  { to: "/setup", title: "Tenant setup", sub: "Keys, widget, embed" },
];

export function AppShell() {
  const location = useLocation();
  // The widget renders a simulated agency site edge to edge; the console
  // surfaces need the width floor so their grids do not collapse.
  const isWidget = location.pathname.startsWith("/widget");

  return (
    <div
      className="flex h-screen overflow-y-hidden"
      style={{
        background: "var(--color-bg)",
        overflowX: isWidget ? "hidden" : "auto",
      }}
    >
      <aside
        className="flex w-[252px] min-w-[252px] flex-none flex-col gap-[22px] px-[18px] py-6"
        style={{
          borderRight: "1px solid var(--color-divider)",
          background: "var(--color-neutral-100)",
        }}
      >
        <Brand />
        <nav
          className="flex flex-col gap-[5px]"
          aria-label="Northbound surfaces"
        >
          {RAIL.map((entry) => (
            // NavLink marks the active route with aria-current="page", which
            // is the correct value for a link (the prototype's rail was
            // buttons, where "true" was right). app.css matches both.
            <NavLink key={entry.to} to={entry.to} className="nb-rail-item">
              <span className="block text-sm">{entry.title}</span>
              <span className="nb-rail-sub block text-[11px]">{entry.sub}</span>
            </NavLink>
          ))}
        </nav>
        <TenantCard />
      </aside>

      <main className="nb-scroll relative flex-1 overflow-auto" style={{ minWidth: isWidget ? 0 : 1180 }}>
        <Outlet />
      </main>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-[10px] px-1.5">
      <div
        className="grid h-[34px] w-[34px] place-items-center rounded-pill font-heading text-[17px]"
        style={{
          background: "var(--color-accent-200)",
          color: "var(--color-accent-800)",
        }}
        aria-hidden="true"
      >
        N
      </div>
      <div>
        <div className="font-heading text-[19px] leading-none">Northbound</div>
        <div
          className="text-[10.5px] uppercase tracking-[0.07em]"
          style={{ color: "var(--color-neutral-600)" }}
        >
          v1 prototype
        </div>
      </div>
    </div>
  );
}

function TenantCard() {
  const [counsellorCount, setCounsellorCount] = useState<number | null>(null);
  const [line, setLine] = useState<string>("");
  // The agency name now comes from the Clerk Organization rather than a
  // fixture: the org IS the tenant. Everything below it is still fixture
  // data, and will stay that way until the API is tenant-aware.
  const { organization, isLoaded } = useOrganization();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [counsellors, tenant] = await Promise.all([
        repo.listCounsellors(),
        repo.getTenant(),
      ]);
      if (cancelled) return;
      setCounsellorCount(counsellors.length);
      setLine(`${tenant.city} · ${tenant.catalogue_country} catalogue`);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      className="mt-auto rounded-md p-[14px]"
      style={{ background: "var(--color-neutral-200)" }}
    >
      <div
        className="text-[10.5px] uppercase tracking-[0.07em]"
        style={{ color: "var(--color-neutral-600)" }}
      >
        Agency
      </div>

      {/* Core 3 replaced <SignedIn>/<SignedOut> with <Show when={...}>. */}
      <Show when="signed-out">
        <div className="font-heading text-[15px] leading-tight">
          Not signed in
        </div>
        <div
          className="mt-1 text-[11.5px]"
          style={{ color: "var(--color-neutral-700)" }}
        >
          <Link to="/login">Sign in</Link> to load your agency. The console is
          still reachable — the API has no auth yet.
        </div>
      </Show>

      <Show when="signed-in">
        <div className="font-heading text-[15px] leading-tight">
          {isLoaded ? (organization?.name ?? "No agency selected") : "…"}
        </div>
        <div
          className="mt-1 text-[11.5px]"
          style={{ color: "var(--color-neutral-700)" }}
        >
          {counsellorCount === null
            ? line
            : `${counsellorCount} counsellors · ${line}`}
        </div>

        <div
          className="mt-3 flex items-center gap-2 pt-3"
          style={{ borderTop: "1px solid var(--color-divider)" }}
        >
          {/* Clerk owns the account menu and the org switcher. Both carry
              sign-out, membership and profile management, which is a lot of
              surface not worth rebuilding to save a theming pass. */}
          <UserButton />
          <OrganizationSwitcher
            hidePersonal
            afterCreateOrganizationUrl="/setup"
            afterSelectOrganizationUrl="/leads"
          />
        </div>
      </Show>
    </div>
  );
}
