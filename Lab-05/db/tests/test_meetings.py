"""What `meetings` (004) promises, proved against a real Postgres.

Most of these assert a FAILURE, for the reason test_constraints.py gives: the
value of a schema is in what it refuses. The headline is
`test_two_meetings_at_the_same_time_are_rejected` — if a later migration drops
the exclusion constraint, double-booking silently becomes possible again and
not one application test would notice, because the application never asks.

Times are absolute here, unlike availability_rules. They are written as
explicit UTC instants so a test never depends on the machine's clock.
"""

from __future__ import annotations

import pytest
from psycopg import errors


# A fixed Tuesday, far enough out that nothing collides with real data.
MON = "2030-01-14"


def book(cur, tenant, lead, user, start, end, **cols):
    """Insert one meeting, returning its id. Times are 'HH:MM' on MON, UTC."""
    columns = ["tenant_id", "lead_id", "user_id", "starts_at", "ends_at"]
    values = [tenant, lead, user, f"{MON} {start}+00", f"{MON} {end}+00"]
    for name, value in cols.items():
        columns.append(name)
        values.append(value)
    cur.execute(
        f"insert into meetings ({', '.join(columns)})"
        f" values ({', '.join(['%s'] * len(values))}) returning id",
        tuple(values),
    )
    return cur.fetchone()[0]


@pytest.fixture
def booked(cur, seed):
    """Two tenants, a counsellor and a student in tenant A.

    Built on the shared `seed` rather than replacing it, so the cross-tenant
    tests still have org_B to point at.
    """

    def _booked():
        s = seed()
        cur.execute(
            "insert into leads (tenant_id, email, name)"
            " values ('org_A', 'student@example.test', 'A Student') returning id"
        )
        s["lead_a"] = cur.fetchone()[0]
        return s

    return _booked


# ---------------------------------------------------------------------------
# Double booking — the reason this table has an exclusion constraint
# ---------------------------------------------------------------------------

def test_two_meetings_at_the_same_time_are_rejected(cur, booked):
    """The constraint the whole design rests on.

    Not a test that Postgres works: a test that this rule is stated in the
    database rather than in a Python `if`, which two concurrent bookings would
    both pass.
    """
    s = booked()
    book(cur, "org_A", s["lead_a"], s["user_a"], "10:00", "11:00")
    with pytest.raises(errors.ExclusionViolation):
        book(cur, "org_A", s["lead_a"], s["user_a"], "10:30", "11:30")


def test_a_meeting_inside_another_is_rejected(cur, booked):
    """Containment is overlap too. A shorter meeting hiding inside a longer one
    would slip past any check written as "does it start during another"."""
    s = booked()
    book(cur, "org_A", s["lead_a"], s["user_a"], "09:00", "12:00")
    with pytest.raises(errors.ExclusionViolation):
        book(cur, "org_A", s["lead_a"], s["user_a"], "10:00", "10:30")


def test_back_to_back_meetings_are_allowed(cur, booked):
    """10:00-10:30 then 10:30-11:00 is a normal morning, not a clash.

    The range is half-open '[)' precisely so this works. A '[]' range would
    make every consecutive pair a violation — the same trap the availability
    API avoided by comparing windows with < rather than <=.
    """
    s = booked()
    book(cur, "org_A", s["lead_a"], s["user_a"], "10:00", "10:30")
    book(cur, "org_A", s["lead_a"], s["user_a"], "10:30", "11:00")


def test_cancelling_frees_the_time(cur, booked):
    """A cancelled meeting must stop reserving its slot.

    Without the WHERE on the exclusion constraint, every cancellation would
    poison that time forever and the bug would only surface as "why can't
    anyone book Tuesday at ten".
    """
    s = booked()
    first = book(cur, "org_A", s["lead_a"], s["user_a"], "10:00", "11:00")
    cur.execute(
        "update meetings set status = 'cancelled', cancelled_at = now()"
        " where id = %s",
        (first,),
    )
    book(cur, "org_A", s["lead_a"], s["user_a"], "10:00", "11:00")


def test_a_completed_meeting_still_blocks(cur, booked):
    """Only 'cancelled' frees the time. A meeting that happened still occupied
    the counsellor, and recording a second one over it would be a false
    history, not a booking."""
    s = booked()
    book(cur, "org_A", s["lead_a"], s["user_a"], "10:00", "11:00", status="completed")
    with pytest.raises(errors.ExclusionViolation):
        book(cur, "org_A", s["lead_a"], s["user_a"], "10:00", "11:00")


def test_a_no_show_still_blocks(cur, booked):
    """Same reasoning: the time was held, the counsellor waited."""
    s = booked()
    book(cur, "org_A", s["lead_a"], s["user_a"], "10:00", "11:00", status="no_show")
    with pytest.raises(errors.ExclusionViolation):
        book(cur, "org_A", s["lead_a"], s["user_a"], "10:00", "11:00")


def test_two_counsellors_can_be_busy_at_the_same_time(cur, booked):
    """The constraint is per counsellor. An agency where only one person can be
    in a meeting at ten o'clock is not an agency."""
    s = booked()
    cur.execute(
        "insert into users (tenant_id, clerk_user_id, email, role, status)"
        " values ('org_A', 'user_clerk_two', 'nuwan@agency-a.test',"
        " 'counsellor', 'active') returning id"
    )
    other = cur.fetchone()[0]
    book(cur, "org_A", s["lead_a"], s["user_a"], "10:00", "11:00")
    book(cur, "org_A", s["lead_a"], other, "10:00", "11:00")


def test_one_student_may_meet_two_people_at_once(cur, booked):
    """Documents a deliberate ABSENCE.

    There is no exclusion constraint on lead_id, because a joint consultation
    — a counsellor and a visa specialist on one call — is two rows at the same
    time for one student. If someone later adds the symmetric constraint for
    tidiness, this test is what tells them why it was left out.
    """
    s = booked()
    cur.execute(
        "insert into users (tenant_id, clerk_user_id, email, role, status)"
        " values ('org_A', 'user_clerk_spec', 'visa@agency-a.test',"
        " 'manager', 'active') returning id"
    )
    specialist = cur.fetchone()[0]
    book(cur, "org_A", s["lead_a"], s["user_a"], "10:00", "11:00")
    book(cur, "org_A", s["lead_a"], specialist, "10:00", "11:00")


# ---------------------------------------------------------------------------
# Shape of a single row
# ---------------------------------------------------------------------------

def test_a_meeting_must_end_after_it_starts(cur, booked):
    s = booked()
    with pytest.raises(errors.CheckViolation):
        book(cur, "org_A", s["lead_a"], s["user_a"], "11:00", "10:00")


def test_a_zero_length_meeting_is_rejected(cur, booked):
    s = booked()
    with pytest.raises(errors.CheckViolation):
        book(cur, "org_A", s["lead_a"], s["user_a"], "10:00", "10:00")


def test_invented_status_is_rejected(cur, booked):
    s = booked()
    with pytest.raises(errors.CheckViolation):
        book(cur, "org_A", s["lead_a"], s["user_a"], "10:00", "11:00", status="pending")


def test_cancelled_without_a_timestamp_is_rejected(cur, booked):
    """The status and the timestamp are one fact stated twice; they may not
    disagree. A cancelled row with no cancelled_at cannot say when."""
    s = booked()
    with pytest.raises(errors.CheckViolation):
        book(
            cur, "org_A", s["lead_a"], s["user_a"], "10:00", "11:00",
            status="cancelled",
        )


def test_a_booked_meeting_cannot_carry_a_cancellation_time(cur, booked):
    """The other half of the same pairing — the half that is easy to forget,
    because reinstating a meeting means clearing the timestamp too."""
    s = booked()
    with pytest.raises(errors.CheckViolation):
        book(
            cur, "org_A", s["lead_a"], s["user_a"], "10:00", "11:00",
            cancelled_at="2030-01-10 09:00+00",
        )


# ---------------------------------------------------------------------------
# Tenant isolation and provenance
# ---------------------------------------------------------------------------

def test_a_meeting_cannot_cross_tenants(cur, booked):
    """org_B claiming org_A's student. The composite foreign key is the only
    thing standing between two agencies' calendars."""
    s = booked()
    with pytest.raises(errors.ForeignKeyViolation):
        book(cur, "org_B", s["lead_a"], s["user_a"], "10:00", "11:00")


def test_deleting_a_student_removes_their_meetings(cur, booked):
    """CASCADE from the lead. Erasing a student erases their appointments —
    there is nothing left to attend."""
    s = booked()
    book(cur, "org_A", s["lead_a"], s["user_a"], "10:00", "11:00")
    cur.execute("delete from leads where id = %s", (s["lead_a"],))
    cur.execute("select count(*) from meetings where lead_id = %s", (s["lead_a"],))
    assert cur.fetchone()[0] == 0


def test_deleting_a_counsellor_with_meetings_is_refused(cur, booked):
    """RESTRICT, not CASCADE. This is the loud failure 003 chose on purpose:
    deleting an agency is an ordered purge, and meetings now come before users
    in that order."""
    s = booked()
    book(cur, "org_A", s["lead_a"], s["user_a"], "10:00", "11:00")
    with pytest.raises(errors.ForeignKeyViolation):
        cur.execute("delete from users where id = %s", (s["user_a"],))


def test_who_booked_it_survives_that_person_leaving(cur, booked):
    """null in created_by MEANS "the student booked this themselves", so
    SET NULL would not lose information — it would state something false. The
    delete is refused instead."""
    s = booked()
    book(
        cur, "org_A", s["lead_a"], s["user_a"], "10:00", "11:00",
        created_by=s["user_a"],
    )
    with pytest.raises(errors.ForeignKeyViolation):
        cur.execute("delete from users where id = %s", (s["user_a"],))
