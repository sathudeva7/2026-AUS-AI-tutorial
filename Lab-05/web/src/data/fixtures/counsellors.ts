/** The counsellor roster.
 *
 * `COUNSELLORS` is real seed data, ported from
 * `Lab-05/mocks/data/northbound/counsellors.json`. Those four records are what
 * routing actually reads: `countries` decides who owns a lead, and `active`
 * decides whether they are in the pool at all. Stefan Brandt is inactive in
 * the seed, which is why Germany has no owner and German leads land in the
 * unassigned queue — that is a real property of the data, not a gap to fill.
 *
 * `PROFILES` is presentation only. Caseload, availability, permissions and
 * assigned-lead rows are shapes the prototype shows and the Python model has
 * no field for. Nothing here reaches the agent.
 *
 * Fixture, not live data. There is no GET /api/counsellors; see data/repo.ts.
 */
import type { Counsellor, CounsellorProfile } from "../types";

export const COUNSELLORS: Counsellor[] = [
  {
    counsellor_id: "c_001",
    name: "Priya Raman",
    email: "priya.raman@northbound.example",
    countries: ["UK", "Ireland"],
    active: true,
  },
  {
    counsellor_id: "c_002",
    name: "Daniel Okafor",
    email: "daniel.okafor@northbound.example",
    countries: ["Australia", "New Zealand"],
    active: true,
  },
  {
    counsellor_id: "c_003",
    name: "Mei Lin Tan",
    email: "meilin.tan@northbound.example",
    countries: ["Canada"],
    active: true,
  },
  {
    counsellor_id: "c_004",
    name: "Stefan Brandt",
    email: "stefan.brandt@northbound.example",
    countries: ["Germany", "Netherlands"],
    active: false,
  },
];

/** Five weekday rows sized across an 07:00–19:00 window, so a bar's offset
 *  and width read as real hours rather than decoration. */
function week(
  spec: [string, string | null][],
): CounsellorProfile["availability"] {
  const DAY_START = 7;
  const DAY_END = 19;
  const span = DAY_END - DAY_START;
  return spec.map(([day, hours]) => {
    if (!hours) return { day, hours: null, startPct: 0, widthPct: 0 };
    const [from, to] = hours.split("–").map((h) => Number(h.split(":")[0]));
    return {
      day,
      hours,
      startPct: ((from - DAY_START) / span) * 100,
      widthPct: ((to - from) / span) * 100,
    };
  });
}

const STANDARD_WEEK = week([
  ["Mon", "9:00–17:00"],
  ["Tue", "9:00–17:00"],
  ["Wed", "9:00–17:00"],
  ["Thu", "9:00–17:00"],
  ["Fri", "9:00–17:00"],
]);

const SLOT_NOTE =
  "Slots the widget may offer. Bookings outside these hours require a counsellor to accept manually.";

export const PROFILES: Record<string, CounsellorProfile> = {
  c_001: {
    counsellor_id: "c_001",
    initials: "PR",
    role: "Senior counsellor · UK, Ireland",
    status: "Accepting",
    subhead:
      "Senior counsellor, United Kingdom and Ireland · 9 years at Northbound · takes every postgraduate lead with a visa flag",
    caseload: {
      active: 18,
      cap: 24,
      note: "Six slots left this cycle. The agent stops routing to her at 24.",
    },
    stats: [
      { label: "consultations", value: "11" },
      { label: "new leads", value: "7" },
      { label: "median reply", value: "3h" },
    ],
    specialisations: ["Postgraduate", "Data & computing", "Visa escalations"],
    routing: [
      { label: "Priority", value: "First for any escalated lead" },
      { label: "Languages", value: "English, Tamil" },
      { label: "Overflow to", value: "Unassigned queue" },
    ],
    availability: week([
      ["Mon", "9:00–16:00"],
      ["Tue", "9:00–16:00"],
      ["Wed", "11:00–15:00"],
      ["Thu", "9:00–17:00"],
      ["Fri", null],
    ]),
    availabilityNote: SLOT_NOTE,
    permissions: [
      { label: "View student transcripts", state: "Allowed" },
      { label: "Edit the catalogue", state: "Allowed" },
      { label: "Approve refresh items", state: "Allowed" },
      { label: "Rotate API keys", state: "Denied" },
    ],
    assigned: [
      {
        name: "Ananya Sharma",
        want: "MSc Data Science · UK",
        stage: "Shortlisted",
        next: "Awaiting transcript for the 4-year rule",
      },
    ],
  },
  c_002: {
    counsellor_id: "c_002",
    initials: "DO",
    role: "Counsellor · Australia, NZ",
    status: "Accepting",
    subhead:
      "Counsellor, Australia and New Zealand · 4 years at Northbound · business and engineering leads",
    caseload: {
      active: 9,
      cap: 24,
      note: "Well under capacity — currently the default overflow for the UK desk.",
    },
    stats: [
      { label: "consultations", value: "6" },
      { label: "new leads", value: "4" },
      { label: "median reply", value: "5h" },
    ],
    specialisations: ["Undergraduate", "Business & management", "Engineering"],
    routing: [
      { label: "Priority", value: "First for Australia and New Zealand" },
      { label: "Languages", value: "English" },
      { label: "Overflow to", value: "Unassigned queue" },
    ],
    availability: STANDARD_WEEK,
    availabilityNote: SLOT_NOTE,
    permissions: [
      { label: "View student transcripts", state: "Allowed" },
      { label: "Edit the catalogue", state: "Denied" },
      { label: "Approve refresh items", state: "Denied" },
      { label: "Rotate API keys", state: "Denied" },
    ],
    assigned: [
      {
        name: "Kwame Mensah",
        want: "MEng Civil Engineering · Australia",
        stage: "In conversation",
        next: "Live now · profile capture",
      },
    ],
  },
  c_003: {
    counsellor_id: "c_003",
    initials: "MT",
    role: "Counsellor · Canada",
    status: "Accepting",
    subhead:
      "Counsellor, Canada · 6 years at Northbound · the only owner for the Canadian catalogue",
    caseload: {
      active: 21,
      cap: 24,
      note: "Near capacity. Three more leads and the agent will route past her.",
    },
    stats: [
      { label: "consultations", value: "14" },
      { label: "new leads", value: "9" },
      { label: "median reply", value: "2h" },
    ],
    specialisations: ["Postgraduate", "Medicine & public health"],
    routing: [
      { label: "Priority", value: "First for any Canadian lead" },
      { label: "Languages", value: "English, Mandarin" },
      { label: "Overflow to", value: "Unassigned queue" },
    ],
    availability: week([
      ["Mon", "11:00–16:00"],
      ["Tue", "9:00–17:00"],
      ["Wed", "9:00–17:00"],
      ["Thu", "9:00–17:00"],
      ["Fri", "11:00–15:00"],
    ]),
    availabilityNote: SLOT_NOTE,
    permissions: [
      { label: "View student transcripts", state: "Allowed" },
      { label: "Edit the catalogue", state: "Allowed" },
      { label: "Approve refresh items", state: "Denied" },
      { label: "Rotate API keys", state: "Denied" },
    ],
    assigned: [
      {
        name: "Tomás Álvarez",
        want: "Canada · undecided",
        stage: "New",
        next: "Six of seven facts still missing",
      },
    ],
  },
  c_004: {
    counsellor_id: "c_004",
    initials: "SB",
    role: "Counsellor · Germany, Netherlands",
    status: "On leave",
    subhead:
      "Counsellor, Germany and the Netherlands · inactive in the roster · leads for these countries join the unassigned queue rather than being reassigned",
    caseload: {
      active: 0,
      cap: 24,
      note: "Inactive. The agent routes no leads here, and it does not silently hand Germany to someone else — those leads wait in the unassigned queue.",
    },
    stats: [
      { label: "consultations", value: "0" },
      { label: "new leads", value: "0" },
      { label: "median reply", value: "—" },
    ],
    specialisations: ["Engineering", "Postgraduate"],
    routing: [
      { label: "Priority", value: "Excluded — inactive" },
      { label: "Languages", value: "English, German" },
      { label: "Overflow to", value: "Unassigned queue" },
    ],
    availability: week([
      ["Mon", null],
      ["Tue", null],
      ["Wed", null],
      ["Thu", null],
      ["Fri", null],
    ]),
    availabilityNote:
      "No slots are offered to students while a counsellor is inactive.",
    permissions: [
      { label: "View student transcripts", state: "Allowed" },
      { label: "Edit the catalogue", state: "Denied" },
      { label: "Approve refresh items", state: "Denied" },
      { label: "Rotate API keys", state: "Denied" },
    ],
    assigned: [],
  },
};

/** Destinations, specialisations and languages the invite form offers.
 *  Destinations are the countries the catalogue actually covers plus the
 *  ones already owned, so inviting someone for a country with no programmes
 *  is visible as such. */
export const INVITE_DESTINATIONS = [
  "UK",
  "Ireland",
  "Australia",
  "New Zealand",
  "Canada",
  "Germany",
  "Netherlands",
];

export const INVITE_SPECIALISATIONS = [
  "Postgraduate",
  "Undergraduate",
  "Data & computing",
  "Business & management",
  "Engineering",
  "Medicine & public health",
];

export const INVITE_LANGUAGES = [
  "English",
  "Tamil",
  "Mandarin",
  "German",
  "Spanish",
];

