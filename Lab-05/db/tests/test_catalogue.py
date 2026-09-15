"""What `catalogue` (005) promises, proved against a real Postgres.

Most of these assert a FAILURE, for the reason test_constraints.py gives: the
value of a schema is in what it refuses.

The headline is `test_a_programme_cannot_be_published_without_a_person`. Every
other guard in this product against the agent stating an unchecked fee is a
prompt instruction, a permission check or a WHERE clause — all of them things
a future code path can forget. That one is a CHECK constraint, and 006's
extraction pipeline will run against it.

Each test's transaction is rolled back, so a statement that raises must be the
last one in its test: Postgres aborts the transaction, not just the statement.
"""

from __future__ import annotations

import re

import pytest
from psycopg import errors


def institution(cur, tenant="org_A", name="Camden Metropolitan University", **cols):
    columns = ["tenant_id", "name"]
    values = [tenant, name]
    for key, value in cols.items():
        columns.append(key)
        values.append(value)
    cur.execute(
        f"insert into institutions ({', '.join(columns)})"
        f" values ({', '.join(['%s'] * len(values))}) returning id",
        tuple(values),
    )
    return cur.fetchone()[0]


def programme(cur, tenant="org_A", name="MSc Data Science", **cols):
    """Insert one programme. Defaults to a bare draft — the state a
    half-finished extraction produces."""
    columns = ["tenant_id", "name"]
    values = [tenant, name]
    for key, value in cols.items():
        columns.append(key)
        values.append(value)
    cur.execute(
        f"insert into programmes ({', '.join(columns)})"
        f" values ({', '.join(['%s'] * len(values))}) returning id",
        tuple(values),
    )
    return cur.fetchone()[0]


def publishable(inst, user):
    """Every column `programmes_published_is_complete` demands."""
    return dict(
        institution_id=inst,
        level="masters",
        field="data science",
        country="GB",
        city="London",
        tuition_per_year_minor=2450000,
        currency="GBP",
        duration_months=12,
        status="published",
        verified_at="2026-09-01T00:00:00+00",
        verified_by=user,
    )


@pytest.fixture
def catalogue(cur, seed):
    """The shared seed plus one university in tenant A."""

    def _catalogue():
        s = seed()
        s["inst_a"] = institution(cur)
        return s

    return _catalogue


# ---------------------------------------------------------------------------
# Publication — the reason this migration has constraints at all
# ---------------------------------------------------------------------------

def test_a_programme_cannot_be_published_without_a_person(cur, catalogue):
    """The constraint the whole design rests on.

    `search_programmes` may only read published rows, so publishing IS the act
    of making a figure quotable to a student. Requiring `verified_at` — which
    `programmes_verified_pair` in turn requires a `users` row for — means no
    import script, refresh job or AI extraction can reach a student by writing
    a status. Stated here, an unchecked published programme is not unlikely;
    it is unrepresentable.
    """
    s = catalogue()
    fields = publishable(s["inst_a"], s["user_a"])
    fields.pop("verified_at")
    fields.pop("verified_by")
    with pytest.raises(errors.CheckViolation):
        programme(cur, **fields)


def test_a_verified_programme_publishes(cur, catalogue):
    """The positive half. A rule that refused everything would pass the test
    above and break the product."""
    s = catalogue()
    programme(cur, **publishable(s["inst_a"], s["user_a"]))


def test_a_published_programme_must_answer_the_obvious_questions(cur, catalogue):
    """Verified but priceless — literally.

    A student asking "how much?" about a live programme must get a figure, not
    a dash. These columns stay nullable for drafts and become mandatory at the
    moment the row becomes visible.
    """
    s = catalogue()
    fields = publishable(s["inst_a"], s["user_a"])
    fields["tuition_per_year_minor"] = None
    fields["currency"] = None
    with pytest.raises(errors.CheckViolation):
        programme(cur, **fields)


def test_a_draft_may_be_half_empty(cur, catalogue):
    """006 depends on this one.

    A URL extraction that found a name and a fee but no duration must be
    storable, or there is nowhere to put a partial result and the counsellor
    reviews nothing. Incompleteness is a draft's normal state.
    """
    catalogue()
    programme(cur, name="MSc Something", tuition_per_year_minor=2450000, currency="GBP")


def test_the_stamp_and_the_person_cannot_disagree(cur, catalogue):
    """Same pairing meetings uses for cancelled_*. A date with nobody behind it
    is exactly the claim this column exists to prevent."""
    s = catalogue()
    fields = publishable(s["inst_a"], s["user_a"])
    fields["verified_by"] = None
    with pytest.raises(errors.CheckViolation):
        programme(cur, **fields)


def test_deleting_the_verifier_is_refused(cur, catalogue):
    """Provenance outlives the person.

    SET NULL would rewrite "Priya verified this fee" into "nobody verified this
    fee" — and leave a published row that violates its own constraint. Users
    are deactivated, not deleted, so this never fires in normal operation.
    """
    s = catalogue()
    programme(cur, **publishable(s["inst_a"], s["user_a"]))
    with pytest.raises(errors.ForeignKeyViolation):
        cur.execute("delete from users where id = %s", (s["user_a"],))


# ---------------------------------------------------------------------------
# Money and destination
# ---------------------------------------------------------------------------

def test_an_amount_needs_a_currency(cur, catalogue):
    """"24500" with no currency is not a cheaper programme, it is an
    unanswerable question."""
    catalogue()
    with pytest.raises(errors.CheckViolation):
        programme(cur, tuition_per_year_minor=2450000)


def test_a_country_must_at_least_be_shaped_like_one(cur, catalogue):
    """The database checks the SHAPE. 'gb' and 'GBR' never match a
    `user_countries` row, so a programme carrying one is invisible to routing
    while looking perfectly filled in."""
    catalogue()
    with pytest.raises(errors.CheckViolation):
        programme(cur, country="gb")


def test_the_register_is_checked_where_it_lives(cur, catalogue):
    """The other half, and the half that catches the bug this column exists
    for.

    "UK" is two uppercase letters, so no CHECK constraint written as a shape
    will refuse it — and "UK" is exactly what the seed catalogue wrote while
    `user_countries` stored GB, which left the coverage banner reporting
    Britain permanently unowned however many people owned it.

    ISO 3166 is not copied into the schema (that would be a third register to
    hold in step). It lives in `services/geo.normalise_country`, so this test
    stands where `test_code_map_matches_the_database_check` does: proving the
    code half of a two-part rule still refuses what the database cannot.
    EVERY write path into `programmes.country` must go through it.
    """
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "student_agent"))
    from services.geo import normalise_country

    catalogue()
    # The database would take it; the register must not.
    programme(cur, country="UK")
    with pytest.raises(ValueError):
        normalise_country("UK")
    assert normalise_country("gb") == "GB"


def test_level_must_be_lowercase(cur, catalogue):
    """`search_programmes` matches `level` exactly. "Masters" that never
    matches "masters" is a programme that silently cannot be found."""
    catalogue()
    with pytest.raises(errors.CheckViolation):
        programme(cur, level="Masters")


# ---------------------------------------------------------------------------
# Institutions
# ---------------------------------------------------------------------------

def test_the_same_university_twice_is_rejected(cur, catalogue):
    """Case-insensitively, because the whole point of splitting this table out
    was to stop one university being typed fifteen ways."""
    catalogue()
    with pytest.raises(errors.UniqueViolation):
        institution(cur, name="camden metropolitan university")


def test_two_agencies_may_each_hold_the_same_university(cur, catalogue):
    """Tenant-owned, not global. `verified_at` on the programmes beneath it is
    an assertion by THAT agency; a shared row would imply a shared
    verification nobody made."""
    catalogue()
    institution(cur, tenant="org_B")


def test_a_programme_cannot_borrow_another_tenants_university(cur, catalogue):
    """Tenant isolation, stated as a composite foreign key rather than a WHERE
    clause somebody has to remember to write."""
    s = catalogue()
    with pytest.raises(errors.ForeignKeyViolation):
        programme(cur, tenant="org_B", institution_id=s["inst_a"])


# ---------------------------------------------------------------------------
# Intakes
# ---------------------------------------------------------------------------

def test_each_intake_carries_its_own_deadline(cur, catalogue):
    """The reason this is a table and not a column on `programmes`.

    January and September close months apart. One deadline for both means the
    agent quotes the wrong date to whichever half of the students it was not
    written for — and the freshness fixture already raised "Application
    deadline · 2027-09 intake" against a shape that could not store one.
    """
    s = catalogue()
    p = programme(cur, **publishable(s["inst_a"], s["user_a"]))
    cur.execute(
        "insert into programme_intakes"
        " (tenant_id, programme_id, intake, application_deadline)"
        " values ('org_A', %s, '2027-01', '2026-10-15'),"
        "        ('org_A', %s, '2027-09', '2027-06-30')",
        (p, p),
    )
    cur.execute(
        "select count(distinct application_deadline) from programme_intakes"
        " where programme_id = %s",
        (p,),
    )
    assert cur.fetchone()[0] == 2


def test_an_intake_must_be_a_month(cur, catalogue):
    """'2027-9' and '2027-13' are the two ways a hand-typed or extracted intake
    goes wrong, and both would silently never match a student's stated one."""
    s = catalogue()
    p = programme(cur, **publishable(s["inst_a"], s["user_a"]))
    with pytest.raises(errors.CheckViolation):
        cur.execute(
            "insert into programme_intakes (tenant_id, programme_id, intake)"
            " values ('org_A', %s, '2027-9')",
            (p,),
        )


def test_the_same_intake_twice_is_rejected(cur, catalogue):
    """Two rows for September with different deadlines is a question with two
    answers."""
    s = catalogue()
    p = programme(cur, **publishable(s["inst_a"], s["user_a"]))
    cur.execute(
        "insert into programme_intakes (tenant_id, programme_id, intake)"
        " values ('org_A', %s, '2027-09')",
        (p,),
    )
    with pytest.raises(errors.UniqueViolation):
        cur.execute(
            "insert into programme_intakes (tenant_id, programme_id, intake)"
            " values ('org_A', %s, '2027-09')",
            (p,),
        )


def test_children_go_with_the_programme(cur, catalogue):
    """Intakes and requirements cascade. They have no meaning without their
    programme, unlike the audit columns above, which have meaning without
    their user."""
    s = catalogue()
    p = programme(cur, **publishable(s["inst_a"], s["user_a"]))
    cur.execute(
        "insert into programme_intakes (tenant_id, programme_id, intake)"
        " values ('org_A', %s, '2027-09')",
        (p,),
    )
    cur.execute(
        "insert into programme_requirements"
        " (tenant_id, programme_id, fact_key, rule, description)"
        " values ('org_A', %s, 'grades', 'percentage>=65', 'A UK 2:1.')",
        (p,),
    )
    cur.execute("delete from programmes where id = %s", (p,))
    cur.execute(
        "select (select count(*) from programme_intakes where programme_id = %s)"
        "     + (select count(*) from programme_requirements where programme_id = %s)",
        (p, p),
    )
    assert cur.fetchone()[0] == 0


# ---------------------------------------------------------------------------
# Requirements
# ---------------------------------------------------------------------------

def test_a_requirement_must_name_a_real_fact(cur, catalogue):
    """A requirement keyed to something that is not a fact can never be
    evaluated — `check_requirements` pairs the two by this key."""
    s = catalogue()
    p = programme(cur, **publishable(s["inst_a"], s["user_a"]))
    with pytest.raises(errors.CheckViolation):
        cur.execute(
            "insert into programme_requirements"
            " (tenant_id, programme_id, fact_key, rule, description)"
            " values ('org_A', %s, 'portfolio', 'has_portfolio', 'Send work.')",
            (p,),
        )


def test_a_rule_needs_words_a_student_can_read(cur, catalogue):
    """Both registers are required. A rule with no description produces a
    verdict the agent cannot explain."""
    s = catalogue()
    p = programme(cur, **publishable(s["inst_a"], s["user_a"]))
    with pytest.raises(errors.CheckViolation):
        cur.execute(
            "insert into programme_requirements"
            " (tenant_id, programme_id, fact_key, rule, description)"
            " values ('org_A', %s, 'grades', 'percentage>=65', '   ')",
            (p,),
        )


def test_requirement_keys_match_the_fact_keys(cur):
    """The two CHECKs are one rule written twice, in two migrations.

    If they drift, a requirement becomes legal to write and impossible to
    check — or a fact the student can state has no requirement that can test
    it. Neither breaks a single page, which is why this is asserted here.
    """
    def keys(constraint: str) -> set[str]:
        cur.execute(
            "select pg_get_constraintdef(oid) from pg_constraint where conname = %s",
            (constraint,),
        )
        row = cur.fetchone()
        assert row, f"{constraint} is gone — did a migration drop it?"
        return set(re.findall(r"'([a-z_]+)'", row[0]))

    assert keys("programme_requirements_key_valid") == keys("lead_facts_key_valid")
