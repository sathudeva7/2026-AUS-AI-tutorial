"""Creating, editing, verifying and archiving programmes.

The theme running through these: a figure a student is shown must be one a
person put their name to. Most of what is asserted here is a refusal.
"""

from __future__ import annotations


def create(client, **body):
    return client.post("/api/programmes", json={"name": "MSc Test", **body})


# ---------------------------------------------------------------------------
# Creating
# ---------------------------------------------------------------------------

def test_a_new_programme_is_always_a_draft(client, catalogue):
    """There is no status parameter. A row that could be created published
    would let one request skip verification altogether."""
    body = create(client, status="published").json()
    assert body["data"]["status"] == "draft"
    assert body["data"]["verified_at"] is None


def test_a_programme_needs_a_name(client, catalogue):
    response = client.post("/api/programmes", json={"name": "   "})
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "name"


def test_naming_a_university_reuses_the_row(client, catalogue):
    """Case-insensitively. The reason institutions is its own table is that
    the seed typed one university's name once per programme."""
    first = create(client, institution="Camden Metropolitan University").json()
    second = create(client, institution="camden metropolitan UNIVERSITY").json()
    assert first["data"]["institution_id"] == second["data"]["institution_id"]
    assert second["data"]["institution"] == "Camden Metropolitan University"


# ---------------------------------------------------------------------------
# Money
# ---------------------------------------------------------------------------

def test_a_typed_fee_is_stored_as_minor_units(client, catalogue):
    """The client sends what the person typed; the column holds pence. Putting
    the conversion here means no client has to know that JPY has no decimal
    places while BHD has three."""
    body = create(client, tuition_per_year="24,500.50", currency="GBP").json()
    assert body["data"]["tuition_per_year_minor"] == 2450050


def test_a_yen_fee_is_not_multiplied_by_a_hundred(client, catalogue):
    body = create(client, tuition_per_year="1200000", currency="JPY").json()
    assert body["data"]["tuition_per_year_minor"] == 1200000


def test_a_fee_more_precise_than_its_currency_is_refused(client, catalogue):
    """Not rounded. A fee is a figure somebody typed, and quietly turning
    24500.567 into 24500.57 answers a question that was not asked."""
    response = create(client, tuition_per_year="24500.567", currency="GBP")
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "tuition_per_year"


def test_a_fee_without_a_currency_is_refused(client, catalogue):
    """"24500" with no currency is not a cheaper programme, it is an
    unanswerable question — and the column pair refuses it anyway."""
    response = create(client, tuition_per_year="24500")
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "currency"


def test_changing_the_amount_alone_keeps_the_currency(client, catalogue):
    """A PATCH sends what changed. The conversion still needs to know which
    currency, and the row already knows."""
    body = client.patch(f"/api/programmes/{catalogue['fresh']}",
                        json={"tuition_per_year": "26000"}).json()
    assert body["data"]["tuition_per_year_minor"] == 2600000
    assert body["data"]["currency"] == "GBP"


# ---------------------------------------------------------------------------
# Country and level
# ---------------------------------------------------------------------------

def test_the_seeds_uk_is_refused_on_write(client, catalogue):
    """The column takes any two uppercase letters, so this is the half of the
    rule the database cannot state."""
    response = create(client, country="UK")
    assert response.status_code == 422


def test_a_capitalised_level_is_fixed_rather_than_refused(client, catalogue):
    """`search_programmes` matches level exactly, so "Masters" would be a
    programme nobody can find — but a 422 for a capital letter is a wall in
    front of a typo the server can just fix."""
    body = create(client, level="Masters").json()
    assert body["data"]["level"] == "masters"


# ---------------------------------------------------------------------------
# Editing a published programme — the decision this build rests on
# ---------------------------------------------------------------------------

def test_editing_a_published_programme_keeps_it_published(client, catalogue):
    """Clearing verified_at would violate the publish constraint and drag the
    row back to draft — taking a live programme away from students because
    somebody corrected a spelling."""
    body = client.patch(f"/api/programmes/{catalogue['fresh']}",
                        json={"city": "Manchester"}).json()
    assert body["data"]["status"] == "published"
    assert body["data"]["verified_at"] is not None


def test_editing_a_published_programme_says_so(client, catalogue):
    """The other half. The row stays live AND stops claiming the new fee was
    the one somebody checked."""
    before = client.get(f"/api/programmes/{catalogue['fresh']}").json()
    assert before["data"]["edited_since_verified"] is False

    after = client.patch(f"/api/programmes/{catalogue['fresh']}",
                         json={"tuition_per_year": "26000"}).json()
    assert after["data"]["edited_since_verified"] is True


def test_changing_a_deadline_counts_as_editing_the_programme(client, catalogue):
    """A deadline is a figure the agent states, so changing one is changing
    the programme — even though the write touches a child table and never the
    programmes row."""
    client.put(f"/api/programmes/{catalogue['fresh']}/intakes",
               json=[{"intake": "2027-09", "application_deadline": "2027-05-01"}])
    body = client.get(f"/api/programmes/{catalogue['fresh']}").json()
    assert body["data"]["edited_since_verified"] is True


def test_a_patch_leaves_untouched_fields_alone(client, catalogue):
    """Two counsellors with one programme open. A form that helpfully posts
    all twelve fields overwrites whatever the other just changed."""
    before = client.get(f"/api/programmes/{catalogue['fresh']}").json()["data"]
    after = client.patch(f"/api/programmes/{catalogue['fresh']}",
                         json={"city": "Leeds"}).json()["data"]
    assert after["city"] == "Leeds"
    assert after["name"] == before["name"]
    assert after["tuition_per_year_minor"] == before["tuition_per_year_minor"]


# ---------------------------------------------------------------------------
# Verifying
# ---------------------------------------------------------------------------

def test_verifying_an_incomplete_draft_names_what_is_missing(client, catalogue):
    """The database refuses it either way. The point of checking first is that
    a CHECK violation tells a counsellor nothing about what to type."""
    new = create(client).json()["data"]
    response = client.post(f"/api/programmes/{new['id']}/verify")
    assert response.status_code == 422
    assert "tuition fee" in response.json()["error"]["message"]


def test_verifying_a_complete_draft_publishes_it(client, catalogue):
    new = create(
        client, institution="Camden Metropolitan University", level="masters",
        field="data science", country="GB", tuition_per_year="20000",
        currency="GBP", duration_months=12,
    ).json()["data"]

    body = client.post(f"/api/programmes/{new['id']}/verify").json()
    assert body["data"]["status"] == "published"
    assert body["data"]["verified_at"] is not None


def test_a_freshly_verified_programme_does_not_read_as_edited(client, catalogue):
    """verified_at and updated_at are both now() — the transaction timestamp —
    so they land exactly equal rather than a microsecond apart."""
    body = client.post(f"/api/programmes/{catalogue['stale']}/verify").json()
    assert body["data"]["edited_since_verified"] is False


def test_editing_does_not_need_permission_to_certify(writer_client, catalogue):
    """A counsellor granted catalogue.write may correct a fee."""
    response = writer_client.patch(f"/api/programmes/{catalogue['fresh']}",
                                   json={"city": "Bristol"})
    assert response.status_code == 200


def test_certifying_is_a_separate_permission(writer_client, catalogue):
    """And may not put their name to it. This is why the two keys exist."""
    response = writer_client.post(f"/api/programmes/{catalogue['draft']}/verify")
    assert response.status_code == 403
    assert response.json()["error"]["details"][0]["issue"] == "catalogue.verify"


# ---------------------------------------------------------------------------
# Requirements and intakes
# ---------------------------------------------------------------------------

def test_a_requirement_nothing_evaluates_is_refused(client, catalogue):
    """check_requirements has no branch for target_country, so such a
    requirement returns indeterminate forever — denting confidence on every
    shortlist it touches and never being satisfiable."""
    response = client.put(
        f"/api/programmes/{catalogue['fresh']}/requirements",
        json=[{"fact_key": "target_country", "rule": "country=GB",
               "description": "Must want the UK."}],
    )
    assert response.status_code == 422


def test_a_rule_with_no_number_is_refused(client, catalogue):
    """float() on this raises inside check_requirements while a student is
    waiting — a 500 mid-conversation caused by something typed weeks earlier
    on a different screen."""
    response = client.put(
        f"/api/programmes/{catalogue['fresh']}/requirements",
        json=[{"fact_key": "english_test", "rule": "ielts_overall>=six",
               "description": "IELTS 6.0."}],
    )
    assert response.status_code == 422


def test_requirements_replace_the_whole_set(client, catalogue):
    """Not a diff. A dropped row quietly surviving is invisible until somebody
    reads the programme back weeks later."""
    body = client.put(
        f"/api/programmes/{catalogue['fresh']}/requirements",
        json=[{"fact_key": "grades", "rule": "percentage>=70",
               "description": "A UK first."}],
    ).json()
    assert [r["fact_key"] for r in body["data"]["requirements"]] == ["grades"]


def test_the_same_intake_cannot_be_listed_twice(client, catalogue):
    """Two rows for September with different deadlines is a question with two
    answers."""
    response = client.put(
        f"/api/programmes/{catalogue['fresh']}/intakes",
        json=[{"intake": "2027-09", "application_deadline": "2027-05-01"},
              {"intake": "2027-09", "application_deadline": "2027-06-01"}],
    )
    assert response.status_code == 422


def test_an_intake_must_be_a_month(client, catalogue):
    response = client.put(f"/api/programmes/{catalogue['fresh']}/intakes",
                          json=[{"intake": "2027-9"}])
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# Archiving, restoring, duplicating
# ---------------------------------------------------------------------------

def test_there_is_no_way_to_delete_a_programme(client, catalogue):
    """Past tool_calls name this id and the dashboard rebuilds shortlists from
    them. A hard delete turns a completed shortlist into a dangling
    reference."""
    response = client.delete(f"/api/programmes/{catalogue['fresh']}")
    assert response.status_code == 405


def test_archiving_takes_it_out_of_the_table_but_not_the_database(client, catalogue):
    client.post(f"/api/programmes/{catalogue['fresh']}/archive")
    listed = client.get("/api/programmes").json()
    assert "MSc Data Science" not in {r["name"] for r in listed["data"]}
    assert client.get(f"/api/programmes/{catalogue['fresh']}").status_code == 200


def test_restoring_a_verified_programme_returns_it_to_students(client, catalogue):
    client.post(f"/api/programmes/{catalogue['fresh']}/archive")
    body = client.post(f"/api/programmes/{catalogue['fresh']}/restore").json()
    assert body["data"]["status"] == "published"


def test_restoring_an_unverified_one_only_gets_as_far_as_draft(client, catalogue):
    """Never straight to what students can see on the caller's word alone."""
    client.post(f"/api/programmes/{catalogue['draft']}/archive")
    body = client.post(f"/api/programmes/{catalogue['draft']}/restore").json()
    assert body["data"]["status"] == "draft"


def test_a_copy_starts_unverified(client, catalogue):
    """An agency adding five courses at one university copies the first four
    times. A copy inheriting verification would put four unchecked entries in
    front of students on somebody else's date."""
    body = client.post(f"/api/programmes/{catalogue['fresh']}/duplicate").json()
    assert body["data"]["status"] == "draft"
    assert body["data"]["verified_at"] is None
    assert body["data"]["name"].endswith("(copy)")


def test_a_copy_brings_the_intakes_and_requirements_with_it(client, catalogue):
    """Copying the row alone would produce a programme whose eligibility
    cannot be computed at all — there would be nothing to check against."""
    body = client.post(f"/api/programmes/{catalogue['fresh']}/duplicate").json()
    assert len(body["data"]["intakes"]) == 2
    assert len(body["data"]["requirements"]) == 3


# ---------------------------------------------------------------------------
# Scope
# ---------------------------------------------------------------------------

def test_another_agencys_programme_cannot_be_edited(client, catalogue):
    response = client.patch(f"/api/programmes/{catalogue['other']}",
                            json={"city": "Nowhere"})
    assert response.status_code == 404
