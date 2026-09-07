"""The HTTP layer: routes, and the request/response shapes they speak.

A module here knows about status codes, headers and JSON bodies. It does not
know SQL — it calls `repositories` for that — and it does not decide domain
questions like "is this a real phone number", which belong to `services`.

Request and response models sit beside the routes that use them rather than in
a `schemas/` folder. They ARE the wire contract for those routes and change
with them; a model used by two routers can move later, when there is one.

Still in `main.py` and not yet moved: /health, /api/leads, /api/notes,
/api/briefing, /api/run, /api/tools, /api/reset, /api/end_session. Those wait
on the leads schema, which is not designed yet.
"""

from fastapi import APIRouter

from envelope import EnvelopeRoute


def new_router(**kwargs) -> APIRouter:
    """An APIRouter whose successful responses get wrapped in the envelope.

    Setting `app.router.route_class` in main.py does NOT reach routers that
    are included: `include_router` re-registers each route under the class the
    INCLUDED router carries, not the app's. A router built with plain
    `APIRouter()` would therefore return bare bodies while every route left in
    main.py returned enveloped ones — a split that shows up only as a frontend
    parse error on whichever endpoints happened to be moved.

    So routers are built here, once, and no route file has to remember.
    """
    kwargs.setdefault("route_class", EnvelopeRoute)
    return APIRouter(**kwargs)
