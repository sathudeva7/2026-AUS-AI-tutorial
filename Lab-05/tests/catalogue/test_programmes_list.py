"""GET /api/programmes — the catalogue table's data.

The tests worth having here are the ones about SCOPE and TRANSLATION: which
agency's rows come back, and how the screen's vocabulary ("Needs check")
becomes a query the database can answer.
"""

from __future__ import annotations


def get(client, **params):
    response = client.get("/api/programmes", params=params)
    return response, response.json()


def names(body):
    return {row["name"] for row in body["data"]}


# ---------------------------------------------------------------------------
# Scope
# ---------------------------------------------------------------------------

def test_only_this_agencys_catalogue_comes_back(client, catalogue):
    _, body = get(client)
    assert "MSc Somewhere Else" not in names(body)


def test_a_tenant_id_in_the_query_is_ignored(client, catalogue, seed):
    """The scope comes from the verified token or it does not come at all.

    A tenant id the caller can set is not a scope, it is a suggestion — and
    this is the request that proves the parameter does nothing.
    """
    _, body = get(client, tenant_id=seed["tenant_b"])
    assert "MSc Somewhere Else" not in names(body)
    assert "MSc Data Science" in names(body)


def test_a_programme_in_another_agency_is_not_found(client, catalogue):
    """404, not 403. Whether an id exists elsewhere is not this caller's
    business, and answering differently would let somebody enumerate other
    tenants' rows."""
    response = client.get(f"/api/programmes/{catalogue['other']}")
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Status — the screen's vocabulary, not the column's
# ---------------------------------------------------------------------------

def test_archived_programmes_are_hidden_by_default(client, catalogue):
    """They are kept because past tool_calls name them, not because anybody
    wants them in the table."""
    _, body = get(client)
    assert "MSc Withdrawn Studies" not in names(body)


def test_archived_can_still_be_asked_for(client, catalogue):
    """Hidden is not gone. A row with no way to look at it is a row nobody can
    un-archive."""
    _, body = get(client, status="archived")
    assert names(body) == {"MSc Withdrawn Studies"}


def test_needs_check_means_an_old_verification_not_a_status(client, catalogue):
    """`programmes.status` has no 'stale'. The filter is a date comparison
    against verified_at, and this is the test that fails if somebody later
    tries to make it a column."""
    _, body = get(client, status="stale")
    assert names(body) == {"MSc Artificial Intelligence"}


def test_active_excludes_the_one_nobody_has_checked_lately(client, catalogue):
    _, body = get(client, status="active")
    assert "MSc Data Science" in names(body)
    assert "MSc Artificial Intelligence" not in names(body)
    assert "MSc Robotics" not in names(body)


def test_drafts_are_visible_to_a_counsellor(client, catalogue):
    """Invisible to the AGENT is not invisible to the person writing it."""
    _, body = get(client, status="draft")
    assert names(body) == {"MSc Robotics"}


def test_the_client_is_told_what_stale_means(client, catalogue):
    """The badge and the filter must agree. Sending the number is what stops
    the console keeping its own copy and drifting from the server's."""
    _, body = get(client)
    assert body["meta"]["stale_after_days"] == 30


def test_the_tiles_count_the_catalogue_not_the_current_view(client, catalogue):
    """A tile that moved when you typed in the search box would be answering a
    different question from the one its label asks."""
    _, body = get(client, search="artificial")
    assert len(body["data"]) == 1
    counts = body["meta"]["counts"]
    assert counts["all"] == 5        # everything except the archived one
    assert counts["draft"] == 1
    assert counts["stale"] == 1
    assert counts["archived"] == 1


# ---------------------------------------------------------------------------
# Search and filters
# ---------------------------------------------------------------------------

def test_search_matches_the_institution_too(client, catalogue):
    """"Camden" is a thing somebody types into that box expecting both of that
    university's courses."""
    _, body = get(client, search="camden")
    assert names(body) == {"MSc Data Science", "MSc Business Analytics"}


def test_search_matches_part_of_a_programme_name(client, catalogue):
    _, body = get(client, search="analytics")
    assert names(body) == {"MSc Business Analytics"}


def test_country_filters_on_the_code(client, catalogue):
    _, body = get(client, country="AU")
    assert names(body) == {"Master of Cybersecurity"}


def test_the_seeds_uk_is_refused_rather_than_matching_nothing(client, catalogue):
    """"UK" is not an ISO code. Matching nothing would read as "this agency
    has no British programmes", which is a different claim and a worse one."""
    response = client.get("/api/programmes", params={"country": "UK"})
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "country"


# ---------------------------------------------------------------------------
# Paging
# ---------------------------------------------------------------------------

def test_pages_do_not_repeat_or_skip_a_row(client, catalogue):
    """Ordering by name alone leaves ties undefined, which shows one row twice
    and hides another. p.id is the tiebreak that makes the order total."""
    _, first = get(client, limit=3, offset=0)
    _, second = get(client, limit=3, offset=3)
    ids = [r["id"] for r in first["data"]] + [r["id"] for r in second["data"]]
    assert len(ids) == len(set(ids))
    assert first["meta"]["total"] == 5


def test_asking_for_too_many_is_refused_not_quietly_clamped(client, catalogue):
    """A caller who asks for 5000 and silently receives 100 has been given a
    wrong answer without being told."""
    assert client.get("/api/programmes", params={"limit": 5000}).status_code == 422


# ---------------------------------------------------------------------------
# Shape
# ---------------------------------------------------------------------------

def test_the_row_shape_is_stable(client, catalogue):
    """An exact set. A subset check would pass while the response quietly grew
    a column the repository started selecting."""
    _, body = get(client)
    row = next(r for r in body["data"] if r["name"] == "MSc Data Science")
    assert set(row) == {
        "id", "name", "institution", "institution_id", "level", "field",
        "country", "city", "tuition_per_year_minor", "currency",
        "duration_months", "status", "verified_at", "edited_since_verified",
        "next_intake", "next_deadline", "created_at", "updated_at",
    }


def test_money_travels_as_minor_units_with_its_currency(client, catalogue):
    """Not a formatted string: a formatted string cannot be sorted, compared
    or converted, and £24,500.00 is 2450000 pence in a bigint for the reason
    CLAUDE.md gives — a fee is never a float."""
    _, body = get(client)
    row = next(r for r in body["data"] if r["name"] == "MSc Data Science")
    assert row["tuition_per_year_minor"] == 2450000
    assert row["currency"] == "GBP"


def test_the_deadline_shown_is_the_next_one_still_open(client, catalogue):
    """The table has one deadline column and a programme has several. The
    earliest is the wrong answer once it has passed — it shows a date nobody
    can act on."""
    _, body = get(client)
    row = next(r for r in body["data"] if r["name"] == "MSc Data Science")
    # Two intakes: 2027-09 closes in 40 days, 2027-01 in 200. The soonest one
    # that has not passed wins, regardless of which month it belongs to.
    assert row["next_intake"] == "2027-09"


def test_a_programme_whose_intakes_have_all_passed_says_nothing(client, catalogue):
    """Null, so the console can say "No open intake" rather than showing a
    date that went by last year."""
    _, body = get(client)
    row = next(r for r in body["data"] if r["name"] == "Master of Cybersecurity")
    assert row["next_intake"] is None
    assert row["next_deadline"] is None


def test_a_draft_has_never_been_verified(client, catalogue):
    """Null, not an old date. "Never checked" and "checked long ago" are
    different claims and the console draws them differently."""
    _, body = get(client, status="draft")
    assert body["data"][0]["verified_at"] is None
