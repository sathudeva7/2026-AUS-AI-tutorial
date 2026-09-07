"""Rules that are neither HTTP nor SQL.

A service answers questions about the domain — is this a real phone number for
its country, is this agency finished setting itself up — without knowing that
a request asked or that a database will store the answer. It may call
`repositories`; it may not import `fastapi`.
"""
