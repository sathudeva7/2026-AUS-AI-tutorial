# One slice, end to end

`GET /api/programmes/{id}` and `PATCH /api/programmes/{id}`, as they exist
today. Read the real files alongside this — the point is the sequence and the
reasoning, and the code in the repo is always the current version.

- `student_agent/repositories/catalogue.py`
- `student_agent/api/catalogue.py`
- `tests/catalogue/`

## 1. Repository

`tenant_id` first, all SQL here, plain data out.

```python
def get(tenant_id: str, programme_id: UUID) -> dict[str, Any] | None:
    with engine().connect() as conn:
        row = conn.execute(
            text(f"{_COLUMNS} {_FROM} {_NEXT_INTAKE}"
                 " where p.tenant_id = :tenant_id and p.id = :id"),
            {"tenant_id": tenant_id, "id": programme_id},
        ).mappings().first()
        ...
```

Three statements rather than one plus N, and deliberately not a single
`json_agg` query: the number of statements does not grow with the data, and
two short readable selects beat one nobody wants to edit.

Returns `None` for absent. **The repository does not raise HTTP errors** — it
does not import `fastapi`, so it cannot.

The write is the mirror image:

```python
def update(tenant_id: str, programme_id: UUID, fields: dict[str, Any]) -> bool:
    columns = {k: v for k, v in fields.items() if k in _WRITABLE}
    if not columns:
        return True
    assignments = ", ".join(f"{k} = :{k}" for k in columns)
    ...
```

`_WRITABLE` is the repository's own allowlist. Even if the route let something
through, the SQL cannot set a column that is not on it.

## 2. Models, beside the routes

`ProgrammeOut` is the row; `ProgrammeDetailOut` extends it with `intakes` and
`requirements`; `ProgrammeWrite` is what a counsellor may set.

Three decisions visible in those classes:

- **Money leaves as `tuition_per_year_minor` + `currency`, and arrives as
  `tuition_per_year: str | None`.** The asymmetry is the point: a human types
  a decimal, a machine reads an integer, and putting the conversion in the
  API means the client never learns that JPY has no decimal places while BHD
  has three.
- **`status`, `verified_at` and `verified_by` are absent from `ProgrammeWrite`.**
  They move through `/verify` and `/archive`, which check a different
  permission. A body that could set them would let one request skip
  verification entirely.
- **Validators normalise rather than trust.** `_iso_country` runs
  `normalise_country`, not the lenient `resolve_country` — this value comes
  from a picker, so anything that is not already a code means a broken client.

## 3. Routes

```python
@router.get("/api/programmes/{programme_id}")
def get_programme(
    programme_id: UUID,
    principal: Principal = Depends(require_permission("catalogue.read")),
) -> dict[str, Any]:
    row = catalogue_repo.get(principal.tenant_id, programme_id)
    if not row:
        raise ApiError(http.HTTP_404_NOT_FOUND, "NOT_FOUND", "No such programme.")
    return enveloped(ProgrammeDetailOut(**row).model_dump(mode="json"))
```

`principal.tenant_id` goes in; nothing from the path or body can change which
agency is read. Absent and belongs-to-another-agency produce the same `404`,
which is what stops an id being probed.

Two helpers carry the repetition across eleven routes:

- `_require(tenant_id, id)` — the row or a 404
- `_detail(tenant_id, id)` — the full row, returned by **every** endpoint that
  changes one, so the console replaces what it holds instead of refetching and
  a derived field like `edited_since_verified` is never a turn out of date

PATCH takes only what was sent:

```python
fields = body.model_dump(exclude_unset=True)
```

Two counsellors with one programme open must not overwrite each other's
untouched columns. This is also why the editor diffs before sending.

One subtlety worth copying: **`verified_at` is not cleared on an edit.**
Clearing it would violate `programmes_published_is_verified` and drag a live
programme back to draft — taking it away from students because somebody fixed
a spelling. `updated_at` moves instead, which makes `edited_since_verified`
true: the row stays published and says out loud that a figure changed.

## 4. Completeness checks belong in the route

`/verify` re-states what the database already guarantees:

```python
missing = [label for column, label in _REQUIRED_TO_PUBLISH
           if row.get(column) is None]
```

The CHECK constraint would refuse the row anyway. It would refuse it as a
constraint violation, which tells a counsellor nothing. The list exists so the
answer can name what is missing, in words, in the order the editor shows them.

That is the general rule: **the database is the boundary, the API is the
explanation.** Both, not either.

## 5. Tests

`tests/catalogue/` splits by verb — `test_programmes_get.py`,
`test_programmes_list.py`, `test_programmes_write.py` — over a shared
`conftest.py` holding six programmes in agency A and one in B, covering every
status.

The one in B is the whole reason the fixture exists. Every read test has a
sibling asserting `404` for it.

## The shape to copy

```
repositories/<x>.py   tenant_id first · all SQL · returns None, never raises
api/<x>.py            models beside routes · _require/_detail helpers · one
                      permission per route · principal.tenant_id only
tests/<x>/            conftest on `seed` · happy path · cross-tenant 404 ·
                      permission · validation
```
