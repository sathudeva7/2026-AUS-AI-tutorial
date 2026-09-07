"""Rules about the people who work at an agency."""

from __future__ import annotations

import re

# Deliberately not a full RFC 5322 implementation — that regex is famously
# several hundred characters and still accepts addresses no mail server will
# take. This rejects what a person actually mistypes: a missing @, a missing
# domain, a stray space. Clerk validates properly when it sends the mail, and
# a bounced invitation is visible; a silently malformed row is not.
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def normalise_email(raw: str) -> str:
    """Trimmed and lowercased, or ValueError.

    `users.email` is citext, so comparison is already case-insensitive — but
    normalising on the way in means the STORED value matches what Clerk was
    told, and a roster showing "Priya@Agency.Test" beside "priya@agency.test"
    looks like two people.
    """
    email = (raw or "").strip().lower()
    if not _EMAIL.match(email):
        raise ValueError("Enter a valid email address, for example name@agency.com.")
    return email
