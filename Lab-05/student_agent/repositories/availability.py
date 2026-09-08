"""Recurring weekly availability.

Times are WALL CLOCK, read against `users.timezone` — "9 to 5" with no zone is
a missed call when the counsellor is in Colombo and the student is in London.
Booked appointments are a different table and store absolute timestamptz.

Every read goes through `to_char`, so a time crosses the driver as text rather
than a `datetime.time`. Postgres `time` runs 00:00:00 to 24:00:00 inclusive and
Python's stops at 23:59:59, so the end of a shift stored as 24:00 — the only
way to express "until midnight" under the `end_time > start_time` CHECK —
raises a conversion error on the way back out. Text avoids the whole question,
and "HH:MM" is the shape the API returns anyway.
"""

from __future__ import annotations

from typing import Any, Sequence

from sqlalchemy import text

from db import engine

_SELECT = (
    "select day_of_week,"
    "       to_char(start_time, 'HH24:MI') as start_time,"
    "       to_char(end_time,   'HH24:MI') as end_time"
    "  from availability_rules"
    " where tenant_id = :t and user_id = :u"
    " order by day_of_week, start_time"
)


def list_for_user(tenant_id: str, user_id: str) -> list[dict[str, Any]]:
    """One user's week, ordered by day then start.

    Ordered in SQL rather than by the caller: a week grid that redraws in a
    different order after every save looks broken, and the index on
    (user_id, day_of_week) already makes this the cheap way round.
    """
    with engine().connect() as conn:
        return [dict(r) for r in conn.execute(
            text(_SELECT), {"t": tenant_id, "u": user_id}).mappings()]


def set_for_user(
    tenant_id: str, user_id: str, rules: Sequence[tuple[int, str, str]]
) -> None:
    """Replace this user's week.

    A wholesale rewrite, deliberately unlike `users.set_countries`, which
    diffs. That one preserves `assigned_at` because "who owned UK in March?" is
    a question someone asks. Nothing asks what a counsellor's hours were in
    March — `created_at` here answers nothing — so the simpler operation is
    also the honest one.

    One transaction: a counsellor with no hours for the instant between the
    delete and the insert is a counsellor nothing can be booked with.
    """
    with engine().begin() as conn:
        conn.execute(
            text("delete from availability_rules"
                 " where tenant_id = :t and user_id = :u"),
            {"t": tenant_id, "u": user_id},
        )
        for day, start, end in rules:
            conn.execute(
                text("insert into availability_rules"
                     " (tenant_id, user_id, day_of_week, start_time, end_time)"
                     " values (:t, :u, :d, cast(:s as time), cast(:e as time))"),
                {"t": tenant_id, "u": user_id, "d": day, "s": start, "e": end},
            )
