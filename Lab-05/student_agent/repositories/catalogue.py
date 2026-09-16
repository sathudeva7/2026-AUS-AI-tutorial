"""The catalogue tables: institutions, programmes, intakes and requirements.

Every function takes `tenant_id` first and puts it in the WHERE clause. It
comes from the verified token or it does not come at all — a tenant id the
caller can set is not a scope, it is a suggestion.

Returns plain dicts, not models. The API layer decides what reaches the wire;
this layer decides what the database says.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Sequence
from uuid import UUID

from sqlalchemy import text

from db import engine

#: How long a verified figure stays trustworthy without being looked at again.
#:
#: The number lives HERE, and the API reports it to the client, because the
#: console draws a "Needs check" badge from the same rule the server filters
#: by. Two constants would drift, and the disagreement would show up as a row
#: that is badged stale but missing from the stale filter.
STALE_AFTER_DAYS = 30

#: The screen's vocabulary, not the column's.
#:
#: `programmes.status` is draft / published / archived. The console offers
#: Active / Needs check / Draft, and "Needs check" is not a status at all — it
#: is published plus an old `verified_at`. The translation lives here so the
#: endpoint does not have to know how staleness is stored.
#:
#: No null handling on verified_at: `programmes_published_is_verified`
#: guarantees a published row has one.
_STATUS_FILTERS: dict[str | None, str] = {
    "draft": "p.status = 'draft'",
    "active": "p.status = 'published' and p.verified_at >= :stale_before",
    "stale": "p.status = 'published' and p.verified_at < :stale_before",
    "archived": "p.status = 'archived'",
    "all": "true",
    # The default hides archived rows. They are kept because past tool_calls
    # name them, not because anybody wants them in the table.
    None: "p.status <> 'archived'",
}

_FROM = """
      from programmes p
      left join institutions inst
             on inst.tenant_id = p.tenant_id and inst.id = p.institution_id
"""

#: The next intake still open, and when it closes.
#:
#: The table has ONE deadline column and a programme now has several. The
#: earliest is the wrong answer once it has passed — it would show a date
#: nobody can act on — so this takes the soonest that has not. When every
#: intake has closed both columns come back null, which the console renders as
#: "No open intake" rather than inventing one.
_NEXT_INTAKE = """
      left join lateral (
          select i.intake, i.application_deadline
            from programme_intakes i
           where i.tenant_id = p.tenant_id
             and i.programme_id = p.id
             and i.is_open
             and (i.application_deadline is null
                  or i.application_deadline >= (now() at time zone 'utc')::date)
           order by i.application_deadline asc nulls last, i.intake
           limit 1
      ) nx on true
"""

_COLUMNS = """
    select p.id, p.name, p.level, p.field, p.country, p.city,
           p.tuition_per_year_minor, p.currency, p.duration_months,
           p.status, p.verified_at, p.created_at, p.updated_at,
           p.institution_id, inst.name as institution,
           nx.intake as next_intake, nx.application_deadline as next_deadline,
           -- "Somebody changed a figure since anyone last checked it."
           --
           -- Derived, not stored. Editing a published programme must not
           -- clear verified_at — the constraint would drag the row back to
           -- draft and take it away from students because somebody fixed a
           -- spelling — and must not be silent either, or the row goes on
           -- claiming a fee was confirmed on a date that predates the fee.
           --
           -- Compared against greatest(verified_at, created_at), not against
           -- verified_at alone. `verified_at` is when the FIGURES were
           -- checked and may be older than the row: the seed importer keeps
           -- each entry's own date rather than claiming fifteen programmes
           -- were confirmed the morning they were imported. Against
           -- verified_at alone every one of those rows reads as edited before
           -- anybody has touched it — which a test caught, and which would
           -- have put a warning on the entire imported catalogue.
           --
           -- Safe to compare exactly: set_updated_at() uses now(), the
           -- TRANSACTION timestamp, so verifying leaves updated_at and
           -- verified_at equal rather than a microsecond apart.
           --
           -- False for a draft, which has never been verified at all.
           (p.verified_at is not null
                and p.updated_at > greatest(p.verified_at, p.created_at))
               as edited_since_verified
"""


def _stale_before() -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=STALE_AFTER_DAYS)


def _where(
    tenant_id: str,
    *,
    search: str | None,
    country: str | None,
    status: str | None,
) -> tuple[str, dict[str, Any]]:
    """The filter, shared by the page and the count behind it.

    Built once so the two cannot disagree — a count computed under different
    conditions than the rows is a pager that runs off the end of the list.
    """
    clauses = ["p.tenant_id = :tenant_id", _STATUS_FILTERS[status]]
    params: dict[str, Any] = {"tenant_id": tenant_id}

    if ":stale_before" in _STATUS_FILTERS[status]:
        params["stale_before"] = _stale_before()

    if search and search.strip():
        # Programme name OR institution, because "Camden" and "Data Science"
        # are both things somebody types into that box expecting a hit.
        #
        # ilike '%x%' cannot use a btree index. At fifteen programmes that is
        # irrelevant; at ten thousand it is a trigram index on the same two
        # columns, and nothing above this line changes.
        clauses.append("(p.name ilike :search or inst.name ilike :search)")
        params["search"] = f"%{search.strip()}%"

    if country:
        clauses.append("p.country = :country")
        params["country"] = country

    return " and ".join(clauses), params


def list_for_tenant(
    tenant_id: str,
    *,
    search: str | None = None,
    country: str | None = None,
    status: str | None = None,
    limit: int = 25,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    """One page of the catalogue, and the total behind it.

    Children are NOT returned here. The table shows a next deadline and
    nothing else from them, and fetching intakes and requirements per row
    would be the 1+N the roster already had taken out of it — eleven queries
    for a ten-row page, and it grows with the page size.

    The count is its own statement rather than `count(*) over ()`: a window
    function returns no row at all when the page is empty, so paging past the
    end would report a total of zero instead of the real one.
    """
    where, params = _where(
        tenant_id, search=search, country=country, status=status
    )

    with engine().connect() as conn:
        total = conn.execute(
            text(f"select count(*) {_FROM} where {where}"), params
        ).scalar_one()

        rows = conn.execute(
            text(
                f"{_COLUMNS} {_FROM} {_NEXT_INTAKE} where {where}"
                # p.id is the tiebreak, and it is not decoration. Two
                # programmes can share a name — the same course at two
                # universities — and without a unique final key their order
                # between two pages is undefined, which shows one row twice
                # and hides another entirely.
                " order by p.name asc, p.id asc"
                " limit :limit offset :offset"
            ),
            {**params, "limit": limit, "offset": offset},
        ).mappings().all()

    return [dict(r) for r in rows], total


def counts(tenant_id: str) -> dict[str, int]:
    """The tiles above the table, in one statement rather than four.

    Deliberately unfiltered by search or country: they describe the catalogue,
    not the current view. A tile that moved when you typed would be answering
    a different question from the one its label asks.
    """
    with engine().connect() as conn:
        row = conn.execute(
            text("""
                select
                    count(*) filter (where status <> 'archived')          as all,
                    count(*) filter (where status = 'published'
                                       and verified_at >= :stale_before)  as active,
                    count(*) filter (where status = 'published'
                                       and verified_at <  :stale_before)  as stale,
                    count(*) filter (where status = 'draft')              as draft,
                    count(*) filter (where status = 'archived')           as archived
                  from programmes
                 where tenant_id = :tenant_id
            """),
            {"tenant_id": tenant_id, "stale_before": _stale_before()},
        ).mappings().one()
    return dict(row)


def get(tenant_id: str, programme_id: UUID) -> dict[str, Any] | None:
    """One programme, with its intakes and its entry requirements.

    Three statements, not one plus N: the number does not grow with the data,
    and json_agg in a single query would trade two short readable selects for
    one nobody wants to edit.
    """
    with engine().connect() as conn:
        row = conn.execute(
            text(
                f"{_COLUMNS} {_FROM} {_NEXT_INTAKE}"
                " where p.tenant_id = :tenant_id and p.id = :id"
            ),
            {"tenant_id": tenant_id, "id": programme_id},
        ).mappings().first()
        if not row:
            return None

        intakes = conn.execute(
            text("""
                select intake, application_deadline, is_open
                  from programme_intakes
                 where tenant_id = :tenant_id and programme_id = :id
                 order by intake
            """),
            {"tenant_id": tenant_id, "id": programme_id},
        ).mappings().all()

        requirements = conn.execute(
            text("""
                select id, fact_key, rule, description, mandatory
                  from programme_requirements
                 where tenant_id = :tenant_id and programme_id = :id
                 -- The order a counsellor put them in. Requirements are read
                 -- as a list by a student, and "and finally, IELTS 6.5" is
                 -- not the same list reshuffled by primary key.
                 order by sort_order, id
            """),
            {"tenant_id": tenant_id, "id": programme_id},
        ).mappings().all()

    return {
        **dict(row),
        "intakes": [dict(i) for i in intakes],
        "requirements": [dict(r) for r in requirements],
    }


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------

#: Columns a caller may set. A whitelist because the update below builds its
#: SET clause from keys — anything not named here cannot reach the statement,
#: whatever the request body says. `status`, `verified_at` and `verified_by`
#: are absent on purpose: they move through verify() and set_status(), which
#: are the two acts a permission is checked for.
_WRITABLE = frozenset({
    "institution_id", "name", "level", "field", "country", "city",
    "tuition_per_year_minor", "currency", "duration_months",
})


def find_or_create_institution(
    tenant_id: str, name: str, country: str | None = None
) -> UUID:
    """The university, by name, case-insensitively.

    Get-or-create rather than a separate endpoint the editor has to call
    first: a counsellor typing a university name should not have to know
    whether this agency has seen it before. The unique index on
    (tenant_id, lower(name)) is what makes the second half of that safe.
    """
    with engine().begin() as conn:
        existing = conn.execute(
            text("select id from institutions"
                 " where tenant_id = :t and lower(name) = lower(:n)"),
            {"t": tenant_id, "n": name.strip()},
        ).scalar()
        if existing:
            return existing
        return conn.execute(
            text("insert into institutions (tenant_id, name, country)"
                 " values (:t, :n, :c) returning id"),
            {"t": tenant_id, "n": name.strip(), "c": country},
        ).scalar_one()


def list_institutions(tenant_id: str) -> list[dict[str, Any]]:
    with engine().connect() as conn:
        rows = conn.execute(
            text("""
                select i.id, i.name, i.country, i.website,
                       count(p.id) filter (where p.status <> 'archived')
                           as programme_count
                  from institutions i
                  left join programmes p
                         on p.tenant_id = i.tenant_id and p.institution_id = i.id
                 where i.tenant_id = :t
                 group by i.id
                 order by i.name
            """),
            {"t": tenant_id},
        ).mappings().all()
    return [dict(r) for r in rows]


def create(tenant_id: str, *, created_by: str, **fields: Any) -> UUID:
    """A new programme, always as a draft.

    There is no parameter for status. A row that could be created already
    published would let one request skip verification entirely, which is the
    thing 005's constraint chain exists to make impossible.
    """
    columns = {k: v for k, v in fields.items() if k in _WRITABLE}
    names = ["tenant_id", "created_by", *columns]
    placeholders = [f":{n}" for n in names]
    with engine().begin() as conn:
        return conn.execute(
            text(
                f"insert into programmes ({', '.join(names)})"
                f" values ({', '.join(placeholders)}) returning id"
            ),
            {"tenant_id": tenant_id, "created_by": created_by, **columns},
        ).scalar_one()


def update(tenant_id: str, programme_id: UUID, fields: dict[str, Any]) -> bool:
    """Only the columns the caller actually sent.

    The same contract PATCH /api/users keeps, and for the same reason: two
    counsellors with one programme open, and a form that helpfully posts all
    twelve fields silently overwrites whatever the other one just changed.

    `verified_at` is untouched. `updated_at` moves, which is the whole signal
    — `edited_since_verified` reads it.
    """
    columns = {k: v for k, v in fields.items() if k in _WRITABLE}
    if not columns:
        return True

    assignments = ", ".join(f"{k} = :{k}" for k in columns)
    with engine().begin() as conn:
        result = conn.execute(
            text(
                f"update programmes set {assignments}"
                " where tenant_id = :tenant_id and id = :id"
            ),
            {**columns, "tenant_id": tenant_id, "id": programme_id},
        )
    return result.rowcount > 0


def _touch(conn, tenant_id: str, programme_id: UUID) -> None:
    """Mark the parent edited when a child changes.

    A deadline and an entry requirement are both figures the agent states, so
    changing one is changing the programme — but neither write touches the
    `programmes` row, and without this the edited-since-verified signal would
    miss exactly the edits most worth flagging.
    """
    conn.execute(
        text("update programmes set updated_at = now()"
             " where tenant_id = :t and id = :p"),
        {"t": tenant_id, "p": programme_id},
    )


def set_intakes(
    tenant_id: str, programme_id: UUID, intakes: Sequence[dict[str, Any]]
) -> None:
    """Replace the complete set, the way user_countries is replaced.

    Not a diff. The editor holds the whole list, and a diff would make the
    client work out which rows changed — where a dropped row quietly surviving
    is invisible until somebody reads the programme back weeks later.
    """
    with engine().begin() as conn:
        conn.execute(
            text("delete from programme_intakes"
                 " where tenant_id = :t and programme_id = :p"),
            {"t": tenant_id, "p": programme_id},
        )
        for intake in intakes:
            conn.execute(
                text("insert into programme_intakes"
                     " (tenant_id, programme_id, intake, application_deadline,"
                     "  is_open)"
                     " values (:t, :p, :i, :d, :o)"),
                {"t": tenant_id, "p": programme_id, "i": intake["intake"],
                 "d": intake.get("application_deadline"),
                 "o": intake.get("is_open", True)},
            )
        _touch(conn, tenant_id, programme_id)


def set_requirements(
    tenant_id: str, programme_id: UUID, requirements: Sequence[dict[str, Any]]
) -> None:
    """Replace the complete set. Order is the order given."""
    with engine().begin() as conn:
        conn.execute(
            text("delete from programme_requirements"
                 " where tenant_id = :t and programme_id = :p"),
            {"t": tenant_id, "p": programme_id},
        )
        for order, req in enumerate(requirements):
            conn.execute(
                text("insert into programme_requirements"
                     " (tenant_id, programme_id, fact_key, rule, description,"
                     "  mandatory, sort_order)"
                     " values (:t, :p, :k, :r, :d, :m, :o)"),
                {"t": tenant_id, "p": programme_id, "k": req["fact_key"],
                 "r": req["rule"], "d": req["description"],
                 "m": req.get("mandatory", True), "o": order},
            )
        _touch(conn, tenant_id, programme_id)


def verify(tenant_id: str, programme_id: UUID, user_id: str) -> bool:
    """Publish it, in this person's name.

    `verified_at` and `updated_at` both become now() — the same transaction
    timestamp — so a freshly verified programme does not immediately read as
    edited-since-verified.

    The completeness constraint is the backstop, not the error message: the
    API checks first so the answer names the missing fields instead of
    surfacing a CHECK violation.
    """
    with engine().begin() as conn:
        result = conn.execute(
            text("""
                update programmes
                   set status = 'published',
                       verified_at = now(),
                       verified_by = :u
                 where tenant_id = :t and id = :p and status <> 'archived'
            """),
            {"t": tenant_id, "p": programme_id, "u": user_id},
        )
    return result.rowcount > 0


def set_status(tenant_id: str, programme_id: UUID, status: str) -> bool:
    """Archive, or bring one back.

    Restoring lands on 'published' only if it was verified; otherwise 'draft'.
    Deciding that here rather than trusting the caller keeps the constraint
    chain intact — an archived row whose verification was never recorded
    cannot be restored straight into what students can see.
    """
    with engine().begin() as conn:
        if status == "restore":
            result = conn.execute(
                text("""
                    update programmes
                       set status = case when verified_at is null
                                         then 'draft' else 'published' end
                     where tenant_id = :t and id = :p and status = 'archived'
                """),
                {"t": tenant_id, "p": programme_id},
            )
        else:
            result = conn.execute(
                text("update programmes set status = :s"
                     " where tenant_id = :t and id = :p"),
                {"t": tenant_id, "p": programme_id, "s": status},
            )
    return result.rowcount > 0


def duplicate(tenant_id: str, programme_id: UUID, created_by: str) -> UUID | None:
    """Copy a programme, its intakes and its requirements, as a NEW DRAFT.

    Unverified, and not by accident: an agency adding five courses at one
    university copies the first four times, and a copy that inherited
    `verified_at` would claim four unchecked entries had been confirmed on the
    original's date — while being immediately visible to students.
    """
    with engine().begin() as conn:
        new_id = conn.execute(
            text("""
                insert into programmes (
                    tenant_id, institution_id, name, level, field, country,
                    city, tuition_per_year_minor, currency, duration_months,
                    status, created_by
                )
                select tenant_id, institution_id, name || ' (copy)', level,
                       field, country, city, tuition_per_year_minor, currency,
                       duration_months, 'draft', :by
                  from programmes
                 where tenant_id = :t and id = :p
             returning id
            """),
            {"t": tenant_id, "p": programme_id, "by": created_by},
        ).scalar()
        if not new_id:
            return None

        conn.execute(
            text("""
                insert into programme_intakes
                    (tenant_id, programme_id, intake, application_deadline, is_open)
                select tenant_id, :new, intake, application_deadline, is_open
                  from programme_intakes
                 where tenant_id = :t and programme_id = :p
            """),
            {"t": tenant_id, "p": programme_id, "new": new_id},
        )
        conn.execute(
            text("""
                insert into programme_requirements
                    (tenant_id, programme_id, fact_key, rule, description,
                     mandatory, sort_order)
                select tenant_id, :new, fact_key, rule, description,
                       mandatory, sort_order
                  from programme_requirements
                 where tenant_id = :t and programme_id = :p
            """),
            {"t": tenant_id, "p": programme_id, "new": new_id},
        )
    return new_id
