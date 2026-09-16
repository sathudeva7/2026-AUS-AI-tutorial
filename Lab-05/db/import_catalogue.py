"""Load the seed catalogue into the tables 005 created.

`mocks/seeds/programmes.json` predates tenants, ISO country codes and minor
units. It holds fifteen programmes in one flat dict with no `tenant_id` at
all, countries written as "UK" and "Australia", fees as floats, and a single
`application_deadline` shared by every intake a programme offers. This script
is where those become rows.

    student_agent/.venv/bin/python db/import_catalogue.py --list
    student_agent/.venv/bin/python db/import_catalogue.py --tenant org_xxx
    student_agent/.venv/bin/python db/import_catalogue.py --tenant org_xxx \
        --verified-by priya@agency.test

Everything happens in ONE transaction. A half-imported catalogue is worse than
no catalogue: the console would show a university with two of its four courses
and nothing on screen would say why.

WHO VERIFIED THESE?

The seed carries a `verified_at` date and no person, and the schema will not
take one without the other — `programmes_verified_pair`, and behind it the
foreign key into `users`. That is the constraint doing its job rather than
getting in the way: nobody at this agency has actually checked these figures,
and an import that manufactured a verification would put a real person's name
on a claim they never made.

So the default is drafts. `--verified-by` is the deliberate act of somebody
saying "these are mine", and it records who.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "student_agent"))

from sqlalchemy import text  # noqa: E402

from db import engine  # noqa: E402
from services.geo import resolve_country  # noqa: E402
from services.money import to_minor  # noqa: E402

SEED = ROOT / "mocks" / "seeds" / "programmes.json"


def list_tenants(conn) -> None:
    rows = conn.execute(text("""
        select t.id, t.name,
               (select count(*) from users u where u.tenant_id = t.id) as users,
               (select count(*) from programmes p where p.tenant_id = t.id) as progs
        from tenants t order by users desc, t.name
    """)).all()
    if not rows:
        print("no tenants — sign in once to create one")
        return
    print("\n  tenant                                   name            users  programmes")
    for r in rows:
        print(f"  {r.id:<40} {r.name:<15} {r.users:>5}  {r.progs:>10}")
    print()


def resolve_verifier(conn, tenant: str, who: str) -> tuple[str, str]:
    """A users row in THIS tenant, by email or id. Never by matching a domain
    — CLAUDE.md: membership, not domain, defines the agency."""
    row = conn.execute(
        text("""
            select id, email, name from users
            where tenant_id = :t and (email = :who or id::text = :who)
        """),
        {"t": tenant, "who": who},
    ).first()
    if not row:
        raise SystemExit(
            f"no user {who!r} in {tenant}. "
            f"They must be a member of this agency to verify its catalogue."
        )
    return row.id, (row.name or row.email)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--tenant", help="Clerk org id the catalogue belongs to")
    ap.add_argument("--verified-by", help="email or user id of the person publishing these")
    ap.add_argument("--replace", action="store_true",
                    help="delete this tenant's existing programmes first")
    ap.add_argument("--list", action="store_true", help="show tenants and exit")
    args = ap.parse_args()

    eng = engine()

    if args.list or not args.tenant:
        with eng.begin() as conn:
            list_tenants(conn)
        if args.list:
            return 0
        print("pass --tenant <id> to import into one")
        return 1

    seed = json.loads(SEED.read_text(encoding="utf-8"))
    programmes = [seed[k] for k in sorted(seed)]

    with eng.begin() as conn:
        if not conn.execute(
            text("select 1 from tenants where id = :t"), {"t": args.tenant}
        ).first():
            raise SystemExit(f"no tenant {args.tenant!r}. Run with --list.")

        verifier_id = verifier_name = None
        if args.verified_by:
            verifier_id, verifier_name = resolve_verifier(
                conn, args.tenant, args.verified_by
            )

        existing = conn.execute(
            text("select count(*) from programmes where tenant_id = :t"),
            {"t": args.tenant},
        ).scalar_one()
        if existing:
            if not args.replace:
                raise SystemExit(
                    f"{args.tenant} already has {existing} programme(s). "
                    f"Pass --replace to delete them and import again."
                )
            # Intakes and requirements cascade; institutions are left alone so
            # a re-import does not renumber them.
            conn.execute(
                text("delete from programmes where tenant_id = :t"),
                {"t": args.tenant},
            )
            print(f"removed {existing} existing programme(s)")

        institutions: dict[str, str] = {}
        mapping: list[tuple[str, str, str]] = []
        intake_rows = requirement_rows = 0

        for p in programmes:
            country = resolve_country(p["country"])

            key = p["institution"].strip().lower()
            if key not in institutions:
                institutions[key] = conn.execute(
                    text("""
                        insert into institutions (tenant_id, name, country)
                        values (:t, :name, :country)
                        on conflict do nothing
                        returning id
                    """),
                    {"t": args.tenant, "name": p["institution"].strip(),
                     "country": country},
                ).scalar() or conn.execute(
                    text("""
                        select id from institutions
                        where tenant_id = :t and lower(name) = :key
                    """),
                    {"t": args.tenant, "key": key},
                ).scalar_one()

            programme_id = conn.execute(
                text("""
                    insert into programmes (
                        tenant_id, institution_id, name, level, field,
                        country, city, tuition_per_year_minor, currency,
                        duration_months, status, verified_at, verified_by
                    ) values (
                        :t, :inst, :name, :level, :field,
                        :country, :city, :minor, :currency,
                        :months, :status, :verified_at, :verified_by
                    ) returning id
                """),
                {
                    "t": args.tenant,
                    "inst": institutions[key],
                    "name": p["name"],
                    "level": p["level"].strip().lower(),
                    "field": p["field"],
                    "country": country,
                    "city": p["city"],
                    "minor": to_minor(p["tuition_per_year"], p["currency"]),
                    "currency": p["currency"].strip().upper(),
                    "months": p["duration_months"],
                    "status": "published" if verifier_id else "draft",
                    # The seed's own date, not today. Backdating to now would
                    # claim fifteen entries were checked this morning.
                    "verified_at": f"{p['verified_at']}T00:00:00+00" if verifier_id else None,
                    "verified_by": verifier_id,
                },
            ).scalar_one()
            mapping.append((p["programme_id"], programme_id, p["name"]))

            # The old shape had ONE deadline for every intake. Copied to each
            # rather than guessed at: this is what the fixture actually said,
            # and inventing per-intake dates would be worse than repeating a
            # date somebody can now correct per row.
            for intake in p["intakes"]:
                conn.execute(
                    text("""
                        insert into programme_intakes
                            (tenant_id, programme_id, intake, application_deadline)
                        values (:t, :p, :intake, :deadline)
                    """),
                    {"t": args.tenant, "p": programme_id, "intake": intake,
                     "deadline": p["application_deadline"]},
                )
                intake_rows += 1

            for order, req in enumerate(p.get("requirements", [])):
                conn.execute(
                    text("""
                        insert into programme_requirements
                            (tenant_id, programme_id, fact_key, rule,
                             description, mandatory, sort_order)
                        values (:t, :p, :key, :rule, :desc, :mandatory, :order)
                    """),
                    {"t": args.tenant, "p": programme_id, "key": req["key"],
                     "rule": req["rule"], "desc": req["description"],
                     "mandatory": req.get("mandatory", True), "order": order},
                )
                requirement_rows += 1

    print(f"\nimported into {args.tenant}")
    print(f"  {len(institutions):>3} institutions")
    print(f"  {len(mapping):>3} programmes")
    print(f"  {intake_rows:>3} intakes")
    print(f"  {requirement_rows:>3} requirements")

    if verifier_id:
        print(f"\npublished, verified by {verifier_name}, keeping each entry's "
              f"own seed date.")
    else:
        print("\nimported as DRAFTS. `search_programmes` may only read published "
              "rows,\nso the agent will find none of these. To publish them, "
              "somebody has to\nput their name on it:\n"
              f"\n    db/import_catalogue.py --tenant {args.tenant} "
              f"--replace --verified-by <email>")

    print("\nseed id -> row id")
    for old, new, name in mapping:
        print(f"  {old:<10} {new}  {name}")
    print("\nThe agent still reads the JSON store, where those seed ids live.\n"
          "This mapping is what a later step needs to move it across.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
