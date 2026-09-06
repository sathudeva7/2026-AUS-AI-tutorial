/** The counsellor roster and one counsellor's coverage.
 *
 * Routing is by owned country, and this surface exists to make the
 * consequences of that legible: who owns what, who is near capacity, and
 * which destinations have no active owner at all. That last one is not an
 * error state to be tidied away — it is how the unassigned queue fills, and
 * a manager needs to see it.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Button,
  Card,
  Kicker,
  ProgressBar,
  StatusChip,
  Table,
  Tag,
} from "@/components/ui";
import { FailureCard, EmptyNote } from "@/components/ui/States";
import { InviteDialog, type InviteDraft } from "@/components/counsellors/InviteDialog";
import { repo } from "@/data/repo";
import { initials } from "@/lib/format";
import type { Counsellor, CounsellorProfile } from "@/data/types";

const STATUS_STYLE: Record<
  CounsellorProfile["status"],
  { background: string; foreground: string }
> = {
  Accepting: {
    background: "var(--color-accent-2-200)",
    foreground: "var(--color-accent-2-800)",
  },
  Supervised: {
    background: "var(--color-accent-200)",
    foreground: "var(--color-accent-800)",
  },
  "On leave": {
    background: "var(--color-neutral-300)",
    foreground: "var(--color-neutral-900)",
  },
  "Admin only": {
    background: "var(--color-neutral-300)",
    foreground: "var(--color-neutral-900)",
  },
  Invited: {
    background: "var(--color-accent-200)",
    foreground: "var(--color-accent-800)",
  },
};

interface Row {
  counsellor: Counsellor;
  profile: CounsellorProfile;
}

export function CounsellorsRoute() {
  const { counsellorId } = useParams();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const counsellors = await repo.listCounsellors();
        const profiles = await Promise.all(
          counsellors.map((c) => repo.getCounsellorProfile(c.counsellor_id)),
        );
        if (cancelled) return;
        const built = counsellors.flatMap((counsellor, i) => {
          const profile = profiles[i];
          return profile ? [{ counsellor, profile }] : [];
        });
        setRows(built);
        if (!counsellorId && built.length) {
          navigate(`/counsellors/${built[0].counsellor.counsellor_id}`, {
            replace: true,
          });
        }
      } catch (e) {
        if (!cancelled) setError(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [counsellorId, navigate]);

  const selected = useMemo(
    () => rows?.find((r) => r.counsellor.counsellor_id === counsellorId),
    [rows, counsellorId],
  );

  // Destinations the catalogue covers that nobody active owns. This is the
  // unassigned queue in advance, and it belongs at the top of the roster.
  const [uncovered, setUncovered] = useState<string[]>([]);
  useEffect(() => {
    if (!rows) return;
    void repo.listProgrammes().then((programmes) => {
      const owned = new Set(
        rows
          .filter((r) => r.counsellor.active)
          .flatMap((r) => r.counsellor.countries),
      );
      const catalogued = new Set(programmes.map((p) => p.country));
      setUncovered([...catalogued].filter((c) => !owned.has(c)).sort());
    });
  }, [rows]);

  function addInvited(draft: InviteDraft) {
    setRows((current) => {
      if (!current) return current;
      const id = `inv_${current.length + 1}`;
      const counsellor: Counsellor = {
        counsellor_id: id,
        name: draft.name,
        email: draft.email,
        countries: draft.destinations,
        active: false,
      };
      const profile: CounsellorProfile = {
        counsellor_id: id,
        initials: initials(draft.name),
        role: `${draft.role}${draft.destinations[0] ? ` · ${draft.destinations[0]}` : ""}`,
        status: "Invited",
        subhead: `Invitation sent to ${draft.email} · awaiting acceptance. No leads are routed until they accept and set their availability.`,
        caseload: {
          active: 0,
          cap: draft.cap,
          note: `Cap set to ${draft.cap} leads. Routing begins once the invitation is accepted.`,
        },
        stats: [
          { label: "consultations", value: "—" },
          { label: "new leads", value: "—" },
          { label: "median reply", value: "—" },
        ],
        specialisations: draft.specialisations.concat(
          draft.escalations ? ["Visa escalations"] : [],
        ),
        routing: [
          {
            label: "Priority",
            value: "Inactive until the invitation is accepted",
          },
          {
            label: "Languages",
            value: draft.languages.length ? draft.languages.join(", ") : "Not set",
          },
          { label: "Overflow to", value: "Unassigned queue" },
        ],
        availability: ["Mon", "Tue", "Wed", "Thu", "Fri"].map((day) => ({
          day,
          hours: null,
          startPct: 0,
          widthPct: 0,
        })),
        availabilityNote:
          "The counsellor sets their own availability when they accept. Until then the widget offers no slots with them.",
        permissions: [
          { label: "View student transcripts", state: "Allowed" },
          {
            label: "Edit the catalogue",
            state: draft.permissions.catalogue ? "Pending" : "Denied",
          },
          {
            label: "Approve refresh items",
            state: draft.permissions.refresh ? "Pending" : "Denied",
          },
          {
            label: "Rotate API keys",
            state: draft.permissions.keys ? "Pending" : "Denied",
          },
        ],
        assigned: [],
      };
      navigate(`/counsellors/${id}`);
      return [...current, { counsellor, profile }];
    });
    setInviting(false);
  }

  if (error) {
    return (
      <div className="p-8">
        <FailureCard error={error} />
      </div>
    );
  }

  return (
    <div className="flex h-screen">
      <div
        className="flex w-[300px] flex-none flex-col"
        style={{ borderRight: "1px solid var(--color-divider)" }}
      >
        <div className="px-5 pb-3.5 pt-[22px]">
          <h3 className="m-0 text-[21px]">Counsellors</h3>
          <p
            className="m-0 mt-1 text-[12.5px]"
            style={{ color: "var(--color-neutral-700)" }}
          >
            {rows
              ? `${rows.filter((r) => r.counsellor.active).length} active of ${rows.length} · routing is by owned country, then load.`
              : "Reading the roster…"}
          </p>
        </div>

        <div className="nb-scroll flex flex-col gap-1.5 overflow-y-auto px-3 pb-4">
          {rows?.map(({ counsellor, profile }) => {
            const selectedRow = counsellor.counsellor_id === counsellorId;
            const status = STATUS_STYLE[profile.status];
            return (
              <button
                key={counsellor.counsellor_id}
                type="button"
                onClick={() => navigate(`/counsellors/${counsellor.counsellor_id}`)}
                aria-current={selectedRow ? "true" : undefined}
                className="cursor-pointer rounded-md px-3 py-2.5 text-left"
                style={{
                  background: selectedRow ? "var(--color-bg)" : "transparent",
                  border: `1px solid ${selectedRow ? "var(--color-accent)" : "var(--color-divider)"}`,
                }}
              >
                <div className="flex items-center gap-[10px]">
                  <span
                    className="grid h-[30px] w-[30px] flex-none place-items-center rounded-pill text-[11px]"
                    style={{
                      background: "var(--color-accent-200)",
                      color: "var(--color-accent-800)",
                    }}
                  >
                    {profile.initials}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-semibold">
                      {counsellor.name}
                    </span>
                    <span
                      className="block text-[11.5px]"
                      style={{ color: "var(--color-neutral-700)" }}
                    >
                      {profile.role}
                    </span>
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <StatusChip
                    label={profile.status}
                    background={status.background}
                    foreground={status.foreground}
                  />
                  <span
                    className="text-[10.5px]"
                    style={{ color: "var(--color-neutral-700)" }}
                  >
                    {profile.caseload.active} / {profile.caseload.cap} leads
                  </span>
                </div>
              </button>
            );
          })}

          <Button
            variant="secondary"
            className="mt-1.5"
            onClick={() => setInviting(true)}
          >
            Invite a counsellor
          </Button>
        </div>
      </div>

      <div className="nb-scroll flex-1 overflow-y-auto px-8 pb-10 pt-[26px]">
        {uncovered.length ? (
          <div
            className="mb-5 rounded-md p-4"
            style={{
              border: "1px solid var(--color-accent-300)",
              background: "var(--color-accent-100)",
            }}
          >
            <div
              className="font-heading text-[15px]"
              style={{ color: "var(--color-accent-800)" }}
            >
              {uncovered.join(", ")}{" "}
              {uncovered.length === 1 ? "has" : "have"} no active owner
            </div>
            <p
              className="m-0 mt-1.5 text-[13px] leading-relaxed"
              style={{ color: "var(--color-accent-800)" }}
            >
              The catalogue carries programmes for{" "}
              {uncovered.length === 1 ? "this destination" : "these destinations"}{" "}
              but no active counsellor owns{" "}
              {uncovered.length === 1 ? "it" : "them"}. Those leads join the
              unassigned queue — the agent will not route them to someone who
              does not cover the country.
            </p>
          </div>
        ) : null}

        {selected ? <Detail {...selected} /> : null}
      </div>

      <InviteDialog
        open={inviting}
        onOpenChange={setInviting}
        onInvite={addInvited}
      />
    </div>
  );
}

function Detail({ counsellor, profile }: Row) {
  const loadPct = profile.caseload.cap
    ? (profile.caseload.active / profile.caseload.cap) * 100
    : 0;
  const loadColour =
    loadPct >= 85
      ? "var(--color-accent-500)"
      : loadPct > 0
        ? "var(--color-accent-2-500)"
        : "var(--color-neutral-500)";

  return (
    <>
      <div className="mb-5 flex items-start gap-4">
        <div>
          <h2 className="m-0 text-[30px]">{counsellor.name}</h2>
          <p
            className="m-0 mt-1.5 max-w-[76ch] text-[13px]"
            style={{ color: "var(--color-neutral-700)" }}
          >
            {profile.subhead}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary">
            {counsellor.active ? "Pause assignments" : "Resume assignments"}
          </Button>
          <Button variant="primary">Edit routing</Button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-3">
        <Card className="rounded-md p-4">
          <Kicker>This week</Kicker>
          <div className="flex gap-[26px]">
            {profile.stats.map((stat) => (
              <div key={stat.label}>
                <div className="font-heading text-[28px] leading-tight">
                  {stat.value}
                </div>
                <div
                  className="text-[11.5px]"
                  style={{ color: "var(--color-neutral-700)" }}
                >
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <div className="mb-1.5 flex items-baseline gap-2">
              <span
                className="text-[12px]"
                style={{ color: "var(--color-neutral-700)" }}
              >
                Active caseload
              </span>
              <span className="figure ml-auto text-[11.5px]">
                {profile.caseload.active} / {profile.caseload.cap}
              </span>
            </div>
            <ProgressBar
              percent={loadPct}
              colour={loadColour}
              label={`Caseload: ${profile.caseload.active} of ${profile.caseload.cap}`}
            />
            <div
              className="mt-[7px] text-[11.5px]"
              style={{ color: "var(--color-neutral-700)" }}
            >
              {profile.caseload.note}
            </div>
          </div>
        </Card>

        <Card className="rounded-md p-4">
          <Kicker>Routing rules</Kicker>
          <p
            className="m-0 mb-3 text-[12.5px]"
            style={{ color: "var(--color-neutral-700)" }}
          >
            The agent hands a lead to the first counsellor matching all rules
            with capacity left.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {counsellor.countries.map((country) => (
              <Tag key={country} tone="accent" className="text-[11px]">
                {country}
              </Tag>
            ))}
            {profile.specialisations.map((spec) => (
              <Tag key={spec} tone="accent-2" className="text-[11px]">
                {spec}
              </Tag>
            ))}
          </div>
          <div className="mt-3.5 flex flex-col gap-2">
            {profile.routing.map((rule) => (
              <div
                key={rule.label}
                className="flex items-baseline gap-[10px] text-[12.5px]"
              >
                <span
                  className="w-[130px] flex-none"
                  style={{ color: "var(--color-neutral-600)" }}
                >
                  {rule.label}
                </span>
                <span className="flex-1">{rule.value}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="rounded-md p-4">
          <Kicker>Availability</Kicker>
          <div className="flex flex-col gap-[7px]">
            {profile.availability.map((day) => (
              <div
                key={day.day}
                className="flex items-center gap-[10px] text-[12.5px]"
              >
                <span
                  className="w-11 flex-none"
                  style={{ color: "var(--color-neutral-600)" }}
                >
                  {day.day}
                </span>
                <span
                  className="relative h-2 flex-1 overflow-hidden rounded-pill"
                  style={{ background: "var(--color-neutral-300)" }}
                >
                  {day.hours ? (
                    <span
                      className="absolute bottom-0 top-0 rounded-pill"
                      style={{
                        left: `${day.startPct}%`,
                        width: `${day.widthPct}%`,
                        background: "var(--color-accent-2-500)",
                      }}
                    />
                  ) : null}
                </span>
                <span
                  className="w-[112px] text-right text-[11.5px]"
                  style={{ color: "var(--color-neutral-700)" }}
                >
                  {day.hours ?? "Unavailable"}
                </span>
              </div>
            ))}
          </div>
          <div
            className="mt-3 text-[11.5px]"
            style={{ color: "var(--color-neutral-700)" }}
          >
            {profile.availabilityNote}
          </div>
        </Card>

        <Card className="rounded-md p-4">
          <Kicker>Permissions</Kicker>
          <div className="flex flex-col gap-[9px]">
            {profile.permissions.map((permission) => (
              <div
                key={permission.label}
                className="flex items-center gap-[10px] text-[12.5px]"
              >
                <span className="flex-1">{permission.label}</span>
                <StatusChip
                  label={permission.state}
                  background={
                    permission.state === "Allowed"
                      ? "var(--color-accent-2-200)"
                      : "var(--color-neutral-300)"
                  }
                  foreground={
                    permission.state === "Allowed"
                      ? "var(--color-accent-2-800)"
                      : "var(--color-neutral-900)"
                  }
                />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="max-w-[1080px] overflow-hidden rounded-md p-0">
        <div className="px-4 py-3.5 font-heading text-[16px]">
          Assigned leads
        </div>
        {profile.assigned.length ? (
          <Table head={["Student", "Interest", "Stage", "Next step"]}>
            {profile.assigned.map((row) => (
              <tr key={row.name}>
                <td className="font-semibold">{row.name}</td>
                <td>{row.want}</td>
                <td>
                  <StatusChip
                    label={row.stage}
                    background="var(--color-neutral-300)"
                    foreground="var(--color-neutral-900)"
                  />
                </td>
                <td>{row.next}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <div className="p-4">
            <EmptyNote>
              No leads are assigned to this counsellor.
            </EmptyNote>
          </div>
        )}
      </Card>
    </>
  );
}
