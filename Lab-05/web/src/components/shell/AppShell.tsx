/** The console frame: a fixed sidebar, a top bar, and a scrolling main pane.
 *
 * Desktop-first, exactly as the reference is — `main` holds a 1180px floor
 * and the whole shell scrolls horizontally below that. These are dense
 * operator surfaces (a lead list beside a four-tab detail pane, a five-column
 * rule grid) and squeezing them onto a phone would mean designing a different
 * product, not a narrower one.
 *
 * The student widget is the exception. It is an embeddable panel a real
 * student opens on a real phone, so its route opts out of the floor AND out
 * of the chrome: a student on an agency's website must never see the agency's
 * own navigation.
 *
 * The rail lists the six surfaces that exist. The reference design shows ten
 * — Students, Applications, Universities, Countries, Tasks, Calendar, Reports
 * — and seven of those have no route behind them. Shipping them would be
 * seven links that navigate nowhere, which is worse than a shorter rail.
 */
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  OrganizationSwitcher,
  Show,
  UserButton,
  useOrganization,
} from "@clerk/react";
import type { ReactNode } from "react";

import {
  ChatIcon,
  GraduationIcon,
  GridIcon,
  InstitutionIcon,
  PeopleIcon,
  SettingsIcon,
  SparkIcon,
} from "@/components/ui/icons";
import { repo } from "@/data/repo";

import { GlobalSearch } from "./GlobalSearch";

interface RailEntry {
  to: string;
  title: string;
  icon: ReactNode;
}

const RAIL: RailEntry[] = [
  { to: "/leads", title: "Dashboard", icon: <GridIcon size={18} /> },
  { to: "/counsellors", title: "Counsellors", icon: <PeopleIcon size={18} /> },
  { to: "/widget", title: "Student widget", icon: <ChatIcon size={18} /> },
  { to: "/assistant", title: "Assistant", icon: <SparkIcon size={18} /> },
  { to: "/catalogue", title: "Catalogue", icon: <InstitutionIcon size={18} /> },
  { to: "/setup", title: "Settings", icon: <SettingsIcon size={18} /> },
];

export function AppShell() {
  const location = useLocation();
  // The widget renders a simulated agency site edge to edge; the console
  // surfaces need the width floor so their grids do not collapse.
  const isWidget = location.pathname.startsWith("/widget");

  return (
    // `console-shell` carries the tokens and the ground but NOT the console's
    // typography. It wraps every route, including the ones still drawn in
    // Organic, and a font-family here would restyle all of them as a side
    // effect of adding a sidebar. The chrome opts into the type by carrying
    // `console` itself.
    <div
      className="console-shell"
      style={{ overflowX: isWidget ? "hidden" : "auto" }}
    >
      <aside className="console console-rail-nav">
        <Brand />

        <nav className="console-nav" aria-label="Northbound surfaces">
          {RAIL.map((entry) => (
            // NavLink marks the active route with aria-current="page", which
            // is the correct value for a link (the prototype's rail was
            // buttons, where "true" was right). The stylesheet matches both.
            <NavLink key={entry.to} to={entry.to} className="console-nav-item">
              <span className="console-nav-icon" aria-hidden="true">
                {entry.icon}
              </span>
              {entry.title}
            </NavLink>
          ))}
        </nav>

        <TenantCard />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Not above the sidebar, but beside it. The brand stays at the top
            of its own column, which is what makes the sidebar read as the
            product and the bar as the page's controls. */}
        {isWidget ? null : (
          <header className="console console-topbar">
            <GlobalSearch />
            <div className="ml-auto flex items-center gap-2">
              {/* Clerk owns the account menu and the org switcher. Both carry
                  sign-out, membership and profile management, which is a lot
                  of surface not worth rebuilding to save a theming pass.

                  No notification bell. The reference has one with an unread
                  dot on it and there is nothing in the product that raises a
                  notification, so the dot would be decoration claiming to be
                  a count. */}
              <Show when="signed-in">
                <OrganizationSwitcher
                  hidePersonal
                  afterCreateOrganizationUrl="/setup"
                  afterSelectOrganizationUrl="/leads"
                />
                <UserButton />
              </Show>
              <Show when="signed-out">
                <Link className="console-btn" data-variant="secondary" to="/login">
                  Sign in
                </Link>
              </Show>
            </div>
          </header>
        )}

        <main
          className="nb-scroll relative min-h-0 flex-1 overflow-auto"
          style={{ minWidth: isWidget ? 0 : 1180 }}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="console-brand">
      <div className="console-brand-mark" aria-hidden="true">
        N
      </div>
      <div className="min-w-0">
        <div className="console-brand-name">Northbound</div>
        <div className="console-brand-sub">Student consultancy CRM</div>
      </div>
    </div>
  );
}

/** The agency, at the foot of the rail.
 *
 * The reference puts a marketing card here — "Helping students find a brighter
 * future". This keeps the shape and the mortarboard and spends the space on
 * which agency you are signed into and how big it is, because that is the
 * question somebody with two browser profiles open actually has.
 */
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
    <div className="console-tenant">
      <GraduationIcon size={22} className="console-tenant-icon" />

      {/* Core 3 replaced <SignedIn>/<SignedOut> with <Show when={...}>. */}
      <Show when="signed-out">
        <div className="console-tenant-name">Not signed in</div>
        <div className="console-tenant-sub">
          <Link to="/login">Sign in</Link> to load your agency.
        </div>
      </Show>

      <Show when="signed-in">
        <div className="console-tenant-name">
          {isLoaded ? (organization?.name ?? "No agency selected") : "…"}
        </div>
        <div className="console-tenant-sub">
          {counsellorCount === null
            ? line
            : `${counsellorCount} counsellors · ${line}`}
        </div>
      </Show>
    </div>
  );
}
