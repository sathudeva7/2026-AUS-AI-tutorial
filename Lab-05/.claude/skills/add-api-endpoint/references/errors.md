# Errors

## The shape

```python
raise ApiError(
    http.HTTP_404_NOT_FOUND,
    "NOT_FOUND",
    "No such programme.",
    details=[{"field": "programme_id", "issue": "..."}],
)
```

`ApiError` is an `HTTPException`, so FastAPI and Starlette treat it normally.
The message lives beside the condition that produced it — deliberately, rather
than in a central table of reason-string → message, because every new `raise`
would need a matching entry somewhere else and the two drift the moment
somebody forgets.

`details` is a list of `{"field", "issue"}`. Keep the machine-readable part
there rather than glued into the sentence, so the client never splits a string
to find it. `require_permission` does this with the permission key itself.

## The catalogue

Every code currently in use, with the status it carries.

| Status | Code | Raised when |
|---|---|---|
| 401 | `MISSING_BEARER_TOKEN` | No `Authorization` header |
| 401 | `INVALID_TOKEN` | Token failed verification against Clerk's JWKS |
| 403 | `NO_ACTIVE_ORGANIZATION` | Signed in, but no Clerk org — so no tenant |
| 403 | `ACCOUNT_DEACTIVATED` | Row exists, `status = 'deactivated'` |
| 403 | `MISSING_PERMISSION` | Role ∪ grants lacks the key; key travels in `details` |
| 404 | `NOT_FOUND` | Catalogue row absent **or in another agency** |
| 404 | `USER_NOT_FOUND` | Roster member absent or in another agency |
| 404 | `TENANT_NOT_FOUND` | Agency absent |
| 409 | `ALREADY_A_MEMBER` | Invited an address already on the roster |
| 409 | `ALREADY_INVITED` | Invited an address with an invitation pending |
| 409 | `LAST_OWNER` | The change would leave the agency with no owner |
| 409 | `CLERK_USER_HAS_NO_EMAIL` | Clerk account carries no address to match on |
| 422 | `VALIDATION_FAILED` | Field-level problems; each one in `details` |
| 422 | `CANNOT_DEACTIVATE_SELF` | Caller is the target |
| 500 | `PROVISIONING_FAILED` | First-request tenant creation did not complete |
| 500 | `INTERNAL_ERROR` | The unhandled-exception fallback in `envelope.py` |
| 502 | `INVITE_NOT_SENT` | Clerk accepted the request but did not send |

## Choosing one

**Reuse `VALIDATION_FAILED`** for anything a field-level `details` entry can
explain. That is the common case, and a specific code adds nothing when the
client's only sensible response is to show the message against the field.

**Mint a specific code only when the frontend must BRANCH on it** — a
different screen, a different offer, a different recovery. That is what
`LAST_OWNER` and `CANNOT_DEACTIVATE_SELF` exist for: both are 4xx refusals a
generic validation error could carry, but the UI needs to say something
particular about each.

If you cannot name the branch the client would take, you do not need a new
code.

New codes are `SCREAMING_SNAKE`, and name the CONDITION, not the remedy:
`LAST_OWNER`, not `PROMOTE_SOMEONE_FIRST`. The remedy belongs in the message,
which can change without breaking a client.

## Status conventions in this codebase

- **404 for another tenant's row, never 403.** Two different answers let
  somebody enumerate other agencies' ids. `_require()` in `api/catalogue.py`
  is the pattern.
- **422 for validation, not 400.** FastAPI's own default, and the suite
  asserts it.
- **409 for a state conflict** — the request is well-formed and the world
  says no.
- **502 when a third party failed**, not 500. `INVITE_NOT_SENT` is Clerk's
  failure, not ours, and the distinction is what tells an operator where to
  look.

## What the client does with it

`web/src/api/client.ts` unwraps the envelope once, for every caller:

- `details` non-empty → `FieldValidationError`, carrying `{field: issue}`
- 401 or 403 → `NotAuthenticatedError`
- anything else → `ApiRequestError`

So a refusal that should land against a form field **must** carry `details`.
Without it the message surfaces as a whole-page failure instead.
