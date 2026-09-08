"""GET and PUT /api/users/{id}/availability — the recurring weekly pattern.

Times are WALL CLOCK read against users.timezone, not absolute instants: "9 to
5" means nine in the counsellor's morning wherever they are, and stays nine
when they move. Booked appointments are a different table and store timestamptz.

Two guards live only in this API and not in the database. Overlapping rules are
refused here, because `availability_rules` carries no exclusion constraint — a
counsellor available twice at once produces a double booking nobody can explain
later. And a shift crossing midnight is refused rather than split, because the
CHECK requires end_time > start_time; the client sends 22:00-24:00 and
00:00-02:00 as two rows.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text


def url(user_id):
    return f"/api/users/{user_id}/availability"


def put(client, user_id, rules):
    r = client.put(url(user_id), json={"rules": rules})
    return r, r.json()


def rule(day, start, end):
    return {"day_of_week": day, "start_time": start, "end_time": end}


def stored(conn, user_id):
    """Straight from the table, so a test cannot pass on a response alone."""
    return [
        (r["day_of_week"], r["start_time"], r["end_time"])
        for r in conn.execute(
            # to_char, not the raw columns: Postgres `time` includes 24:00:00
            # and Python's `datetime.time` stops at 23:59:59, so a shift ending
            # at midnight fails on the way back through the driver.
            text("select day_of_week,"
                 "       to_char(start_time, 'HH24:MI') as start_time,"
                 "       to_char(end_time,   'HH24:MI') as end_time"
                 "  from availability_rules"
                 " where user_id = :u order by day_of_week, start_time"),
            {"u": user_id},
        ).mappings()
    ]


def add_rule(conn, tenant, user_id, day, start, end):
    conn.execute(
        text("insert into availability_rules"
             " (tenant_id, user_id, day_of_week, start_time, end_time)"
             " values (:t, :u, :d, :s, :e)"),
        {"t": tenant, "u": user_id, "d": day, "s": start, "e": end},
    )


def signed_in_as(app, seed, role, user_key):
    from fastapi.testclient import TestClient

    from auth import Principal, require_auth

    app.dependency_overrides[require_auth] = lambda: Principal(
        clerk_user_id="ck_x", tenant_id=seed["tenant_a"], user_id=seed[user_key],
        role=role, grants=frozenset(),
    )
    return TestClient(app, raise_server_exceptions=False)


WEEK = [rule(1, "09:00", "17:00"), rule(3, "09:00", "12:00")]


# ---------------------------------------------------------------------------
# Who may set whose hours
# ---------------------------------------------------------------------------

def test_without_a_token_it_refuses(anon_client, seed):
    assert anon_client.put(url(seed["zoe"]), json={"rules": []}).status_code == 401
    assert anon_client.get(url(seed["zoe"])).status_code == 401


def test_a_counsellor_may_set_their_own_hours(app, conn, seed):
    """The reason this is self-or-permission rather than permission alone.

    Hours are read against the counsellor's own timezone. Someone who cannot
    enter their own is offered to students at hours they never agreed to.
    """
    r = signed_in_as(app, seed, "counsellor", "zoe").put(
        url(seed["zoe"]), json={"rules": WEEK})
    assert r.status_code == 200
    assert stored(conn, seed["zoe"]) == [(1, "09:00", "17:00"),
                                         (3, "09:00", "12:00")]


def test_a_counsellor_cannot_set_someone_elses(app, conn, seed):
    r = signed_in_as(app, seed, "counsellor", "zoe").put(
        url(seed["anita"]), json={"rules": WEEK})
    assert r.status_code == 403
    assert stored(conn, seed["anita"]) == []


def test_a_manager_may_set_anyones(app, conn, seed):
    r = signed_in_as(app, seed, "manager", "anita").put(
        url(seed["zoe"]), json={"rules": WEEK})
    assert r.status_code == 200
    assert len(stored(conn, seed["zoe"])) == 2


def test_an_owner_may_set_anyones(client, conn, seed):
    r, _ = put(client, seed["zoe"], WEEK)
    assert r.status_code == 200
    assert len(stored(conn, seed["zoe"])) == 2


def test_any_member_may_read_a_colleagues_hours(app, seed):
    """Reading is not gated the way writing is: knowing when a colleague is
    available is what makes handing a lead over possible at all."""
    signed_in_as(app, seed, "owner", "priya").put(url(seed["zoe"]),
                                                  json={"rules": WEEK})
    r = signed_in_as(app, seed, "counsellor", "zoe").get(url(seed["anita"]))
    assert r.status_code == 200


# ---------------------------------------------------------------------------
# Wrong target
# ---------------------------------------------------------------------------

def test_another_agencys_user_cannot_be_written(client, conn, seed):
    r, body = put(client, seed["other"], WEEK)
    assert r.status_code == 404
    assert body["error"]["code"] == "USER_NOT_FOUND"
    assert stored(conn, seed["other"]) == []


def test_another_agencys_user_cannot_be_read(client, conn, seed):
    """404, not an empty list. An empty week and a user who is none of your
    business are different answers, and the second must not look like the
    first."""
    add_rule(conn, seed["tenant_b"], seed["other"], 1, "09:00", "17:00")
    r, body = client.get(url(seed["other"])), client.get(url(seed["other"])).json()
    assert r.status_code == 404
    assert body["error"]["code"] == "USER_NOT_FOUND"


def test_an_unknown_id_is_not_found(client):
    r, _ = put(client, "00000000-0000-0000-0000-000000000000", WEEK)
    assert r.status_code == 404


def test_a_malformed_id_is_refused(client):
    r, body = put(client, "not-a-uuid", WEEK)
    assert r.status_code == 422
    assert body["error"]["details"][0]["field"] == "user_id"


# ---------------------------------------------------------------------------
# Bad times — every one refused by name, never as a 500 from the CHECK
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("day", [7, -1, 99])
def test_a_day_outside_the_week_is_refused(client, conn, seed, day):
    r, body = put(client, seed["zoe"], [rule(day, "09:00", "17:00")])
    assert r.status_code == 422
    assert "day_of_week" in body["error"]["details"][0]["field"]
    assert stored(conn, seed["zoe"]) == []


def test_an_end_equal_to_the_start_is_refused(client, seed):
    r, body = put(client, seed["zoe"], [rule(1, "09:00", "09:00")])
    assert r.status_code == 422
    assert body["error"]["details"][0]["field"].endswith("end_time")


def test_an_end_before_the_start_is_refused(client, seed):
    r, body = put(client, seed["zoe"], [rule(1, "17:00", "09:00")])
    assert r.status_code == 422
    assert body["error"]["details"][0]["field"].endswith("end_time")


def test_a_shift_crossing_midnight_is_refused(client, conn, seed):
    """22:00-02:00 cannot be one row: the CHECK requires end > start. Refused
    rather than silently split, so the client sends what is actually stored —
    22:00-24:00 and 00:00-02:00 — and the week it draws matches the week we
    hold."""
    r, body = put(client, seed["zoe"], [rule(1, "22:00", "02:00")])
    assert r.status_code == 422
    assert "midnight" in body["error"]["details"][0]["issue"].lower()
    assert stored(conn, seed["zoe"]) == []


def test_the_two_halves_of_a_night_shift_are_accepted(client, conn, seed):
    """The other side of the rule above: split by the client, both rows save.
    Postgres `time` accepts 24:00:00, which is what makes the first half
    expressible at all."""
    r, _ = put(client, seed["zoe"],
               [rule(1, "22:00", "24:00"), rule(2, "00:00", "02:00")])
    assert r.status_code == 200
    assert stored(conn, seed["zoe"]) == [(1, "22:00", "24:00"),
                                         (2, "00:00", "02:00")]


@pytest.mark.parametrize("bad", ["9am", "25:00", "", "noon", "09:60"])
def test_a_time_that_is_not_a_time_is_refused(client, seed, bad):
    r, body = put(client, seed["zoe"], [rule(1, bad, "17:00")])
    assert r.status_code == 422
    assert body["error"]["details"][0]["field"].endswith("start_time")


# ---------------------------------------------------------------------------
# Overlaps — the guard that exists only here, not in the database
# ---------------------------------------------------------------------------

def test_two_rules_that_overlap_are_refused(client, conn, seed):
    """`availability_rules` has no exclusion constraint, so the database will
    happily store a counsellor as available twice at once. The damage shows up
    much later as a double booking, by which point the cause is invisible."""
    r, body = put(client, seed["zoe"],
                  [rule(1, "09:00", "17:00"), rule(1, "13:00", "18:00")])
    assert r.status_code == 422
    assert body["error"]["details"][0]["field"] == "rules"
    assert stored(conn, seed["zoe"]) == []


def test_back_to_back_shifts_are_allowed(client, conn, seed):
    """The case a naive overlap check gets wrong. A morning ending at 12:00 and
    an afternoon starting at 12:00 do not overlap — they touch, which is what
    an ordinary split shift looks like."""
    r, _ = put(client, seed["zoe"],
               [rule(1, "09:00", "12:00"), rule(1, "12:00", "17:00")])
    assert r.status_code == 200
    assert len(stored(conn, seed["zoe"])) == 2


def test_the_same_rule_sent_twice_is_refused(client, seed):
    r, body = put(client, seed["zoe"],
                  [rule(1, "09:00", "17:00"), rule(1, "09:00", "17:00")])
    assert r.status_code == 422
    assert body["error"]["details"][0]["field"] == "rules"


def test_one_rule_wholly_inside_another_is_refused(client, seed):
    r, _ = put(client, seed["zoe"],
               [rule(1, "09:00", "17:00"), rule(1, "10:00", "11:00")])
    assert r.status_code == 422


def test_the_same_hours_on_different_days_are_fine(client, conn, seed):
    """Not an overlap. Working 09:00-17:00 every weekday is the common case,
    and a check that compares times without comparing days refuses it."""
    r, _ = put(client, seed["zoe"], [rule(d, "09:00", "17:00") for d in range(5)])
    assert r.status_code == 200
    assert len(stored(conn, seed["zoe"])) == 5


# ---------------------------------------------------------------------------
# Fields this endpoint does not own
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("extra", ["tenant_id", "user_id", "id", "role"])
def test_a_field_this_endpoint_does_not_own_is_refused(client, seed, extra):
    """The URL and the token decide whose hours these are. A tenant_id the
    caller can set is not a scope, it is a suggestion."""
    r, body = put(client, seed["zoe"],
                  [{**rule(1, "09:00", "17:00"), extra: "x"}])
    assert r.status_code == 422
    assert extra in body["error"]["details"][0]["field"]


# ---------------------------------------------------------------------------
# Ordinary use
# ---------------------------------------------------------------------------

def test_an_empty_list_clears_the_week(client, conn, seed):
    put(client, seed["zoe"], WEEK)
    r, _ = put(client, seed["zoe"], [])
    assert r.status_code == 200
    assert stored(conn, seed["zoe"]) == []


def test_what_was_saved_is_what_comes_back(client, seed):
    put(client, seed["zoe"], WEEK)
    body = client.get(url(seed["zoe"])).json()
    assert body["data"] == [
        {"day_of_week": 1, "start_time": "09:00", "end_time": "17:00"},
        {"day_of_week": 3, "start_time": "09:00", "end_time": "12:00"},
    ]


def test_a_second_write_replaces_the_first(client, conn, seed):
    """Replace, not merge. Nothing reads created_at on these rows — there is
    no "what were her hours in March?" — which is why this is a wholesale
    rewrite where set_countries is a careful diff."""
    put(client, seed["zoe"], WEEK)
    put(client, seed["zoe"], [rule(5, "10:00", "14:00")])
    assert stored(conn, seed["zoe"]) == [(5, "10:00", "14:00")]


def test_hours_are_returned_in_a_stable_order(client, seed):
    """Sorted by day then start, whatever order the client sent. A week grid
    that redraws in a different order after every save looks broken."""
    put(client, seed["zoe"],
        [rule(3, "14:00", "16:00"), rule(1, "09:00", "12:00"),
         rule(3, "09:00", "12:00")])
    days = [(r["day_of_week"], r["start_time"])
            for r in client.get(url(seed["zoe"])).json()["data"]]
    assert days == [(1, "09:00"), (3, "09:00"), (3, "14:00")]


def test_an_invited_user_can_be_given_hours(client, conn, seed):
    """Setting someone's week before they accept is ordinary preparation."""
    r, _ = put(client, seed["invited"], WEEK)
    assert r.status_code == 200
    assert len(stored(conn, seed["invited"])) == 2


def test_a_write_does_not_touch_another_agencys_rows(client, conn, seed):
    """Checked in the table, not the response: a tenant leak that a filtered
    response hides is exactly the bug worth catching."""
    add_rule(conn, seed["tenant_b"], seed["other"], 1, "09:00", "17:00")
    put(client, seed["zoe"], [])
    assert stored(conn, seed["other"]) == [(1, "09:00", "17:00")]


def test_someone_with_no_hours_reads_as_an_empty_week(client, seed):
    r = client.get(url(seed["zoe"]))
    assert r.status_code == 200 and r.json()["data"] == []
