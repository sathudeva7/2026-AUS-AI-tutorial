"""Entry-requirement rules, checked before they are stored.

`programme_requirements.rule` is machine text the evaluator reads — the schema
deliberately does not constrain it, because the grammar lives in the evaluator
and a regex in a CHECK would be the same rule stated twice in a language that
cannot run it. This module is the other half of that bargain.

WHAT THE EVALUATOR ACTUALLY DOES, which is less than the rule text suggests:

    check_requirements dispatches on `fact_key`, never on the rule. From the
    rule it takes ONE thing, and only for three keys:

        float(re.split(r"[<>]=", rule)[-1])

    So the left-hand side is decorative. A requirement keyed `qualification`
    with the rule "ielts_overall>=4" behaves identically to "bachelor_years>=4",
    because the evaluator reads the key to decide it is looking at a degree and
    the rule only to find the number 4.

That is worth knowing before reading what follows: this validates what is
load-bearing, not what the string appears to promise.
"""

from __future__ import annotations

import re

#: Keys `check_requirements` has a branch for. The other two — target_country
#: and field_of_study — fall through to "no rule evaluator for requirement
#: key", which returns INDETERMINATE every single time. A requirement that can
#: never be anything but indeterminate dents confidence on every shortlist it
#: touches and can never be satisfied, so it is refused here rather than
#: stored looking like a requirement.
EVALUATED_KEYS = frozenset({
    "qualification", "grades", "english_test", "intended_intake",
    "budget_per_year",
})

#: The three whose branch parses a number out of the rule. For the other two
#: the rule text is never read at all — `intended_intake` compares against the
#: programme's own intakes, `budget_per_year` against its tuition — so their
#: rule is documentation, and anything non-empty is accepted.
THRESHOLD_KEYS = frozenset({"qualification", "grades", "english_test"})

_SPLIT = re.compile(r"[<>]=")


def threshold(rule: str) -> float:
    """The number the evaluator will read out of this rule.

    Deliberately identical to `mocks.client._threshold` rather than importing
    it: the API layer must not depend on the mock store. A test asserts the
    two agree on the same inputs — the same drift check `permissions.py` and
    the fact-key CHECK already get.
    """
    return float(_SPLIT.split(rule)[-1])


def validate_rule(fact_key: str, rule: str) -> str:
    """The rule as it will be stored, or ValueError explaining why not.

    The failure this prevents is not cosmetic. `float()` on an unparseable
    rule raises inside `check_requirements`, which runs mid-conversation while
    a student waits — a 500 in the middle of a shortlist, caused by something
    a counsellor typed weeks earlier in a different screen.
    """
    rule = rule.strip()
    if not rule:
        raise ValueError("A rule is required.")

    if fact_key not in EVALUATED_KEYS:
        raise ValueError(
            f"Nothing evaluates a {fact_key!r} requirement, so it could never "
            f"pass or fail. Requirements can be set on: "
            f"{', '.join(sorted(EVALUATED_KEYS))}."
        )

    if fact_key in THRESHOLD_KEYS:
        if not _SPLIT.search(rule):
            raise ValueError(
                f"A {fact_key} rule needs >= or <=, for example "
                f"'{_EXAMPLES[fact_key]}'."
            )
        try:
            threshold(rule)
        except ValueError:
            raise ValueError(
                f"The value after >= must be a number, for example "
                f"'{_EXAMPLES[fact_key]}'."
            ) from None

    return rule


_EXAMPLES = {
    "qualification": "bachelor_years>=4",
    "grades": "percentage>=65",
    "english_test": "ielts_overall>=6.5",
}
