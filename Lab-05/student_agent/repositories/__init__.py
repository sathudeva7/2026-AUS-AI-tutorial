"""Data access. Every SQL statement in the application lives under here.

Two rules make this folder worth having:

1. **`tenant_id` is the first parameter of every function that reads or
   writes tenant-owned data.** A function that cannot be called without one
   cannot silently forget to filter on it, and a reviewer checking "does this
   application leak across agencies?" reads this folder rather than the whole
   codebase.

2. **Nothing here imports FastAPI or `auth`.** These functions take plain
   strings and return plain data, so they can be exercised from a test, from
   the follow-up worker, or from a script — none of which have a request or a
   session token. If an import of `fastapi` ever appears in this folder, the
   layering has collapsed and the first rule stops being checkable.

The value passed as `tenant_id` must always originate from
`Principal.tenant_id` — the verified token — never from a query string, body
or header. That is the caller's responsibility, and it is the whole of the
security argument: the parameter is safe, its SOURCE is what matters.
"""
