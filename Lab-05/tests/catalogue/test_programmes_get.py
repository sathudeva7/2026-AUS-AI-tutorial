"""GET /api/programmes/{id} — one programme, with its children."""

from __future__ import annotations


def test_the_intakes_come_back_each_with_its_own_deadline(client, catalogue):
    """The reason programme_intakes is a table.

    January and September close months apart, and the shape this replaced had
    one date for both — so the agent quoted the wrong one to whichever half of
    the students it was not written for.
    """
    body = client.get(f"/api/programmes/{catalogue['fresh']}").json()
    deadlines = {i["intake"]: i["application_deadline"] for i in body["data"]["intakes"]}
    assert set(deadlines) == {"2027-01", "2027-09"}
    assert deadlines["2027-01"] != deadlines["2027-09"]


def test_requirements_keep_the_order_somebody_put_them_in(client, catalogue):
    """A student reads them as a list. "And finally, IELTS 6.5" is not the
    same list reshuffled by primary key."""
    body = client.get(f"/api/programmes/{catalogue['fresh']}").json()
    keys = [r["fact_key"] for r in body["data"]["requirements"]]
    assert keys == ["qualification", "grades", "budget_per_year"]


def test_a_requirement_carries_both_its_rule_and_its_words(client, catalogue):
    """A rule with no description produces a verdict the agent cannot explain;
    a description with no rule is checked by nothing."""
    body = client.get(f"/api/programmes/{catalogue['fresh']}").json()
    first = body["data"]["requirements"][0]
    assert first["rule"] == "bachelor_years>=4"
    assert first["description"] == "A four-year degree."
    assert first["mandatory"] is True


def test_an_optional_requirement_says_so(client, catalogue):
    """A failed optional requirement dents confidence; a failed mandatory one
    ends the match. Collapsing them loses the difference."""
    body = client.get(f"/api/programmes/{catalogue['fresh']}").json()
    budget = next(r for r in body["data"]["requirements"]
                  if r["fact_key"] == "budget_per_year")
    assert budget["mandatory"] is False


def test_a_programme_with_no_children_returns_empty_lists(client, catalogue):
    """Not null, and not an error. A draft nobody has finished is the normal
    state of a programme somebody is still writing."""
    body = client.get(f"/api/programmes/{catalogue['draft']}").json()
    assert body["data"]["intakes"] == []
    assert body["data"]["requirements"] == []


def test_an_unknown_id_is_a_clean_404(client, catalogue):
    response = client.get(
        "/api/programmes/00000000-0000-4000-8000-000000000000"
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"
