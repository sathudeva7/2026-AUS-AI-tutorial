"""One response shape for the whole API.

    success  {"success": true,  "data": ..., "request_id": "..."}
    failure  {"success": false, "error": {...}, "request_id": "..."}

`message` and `meta` are present only when they carry something. A required
`message` becomes thirty strings nobody reads ("User retrieved successfully"),
and `meta` holding page/limit/total is meaningless on an endpoint that returns
one object.

The HTTP status stays truthful. `success: false` accompanies a 4xx or 5xx; it
never replaces it. An API that answers 200 with success:false breaks caching,
monitoring, and every client's error handling.

── What wraps what ────────────────────────────────────────────────────────
Middleware generates the request id — that part it is good at. It does NOT
rewrite bodies: to wrap a response it would have to buffer it whole, and
/api/run streams the agent's thinking event by event. Buffering it would make
the widget sit silent and then dump everything at once.

So bodies are wrapped in two places instead:
  * exception handlers, for every failure
  * EnvelopeRoute, for successful returns, skipping streams
"""

from __future__ import annotations

import logging
import secrets
from contextvars import ContextVar
from http import HTTPStatus
from typing import Any, Callable, Coroutine

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import StreamingResponse

#: The current request's id, readable from anywhere in the call stack without
#: threading it through every signature.
_request_id: ContextVar[str] = ContextVar("request_id", default="")

REQUEST_ID_HEADER = "X-Request-Id"

#: The same id, parked on the ASGI scope. The contextvar is reset as the
#: request unwinds, and an unhandled exception is handled ABOVE that point —
#: by Starlette's outermost middleware, after ours has already cleaned up. The
#: scope dict is the one thing that survives the whole way out.
REQUEST_ID_SCOPE_KEY = "northbound_request_id"


def request_id(request: Request | None = None) -> str:
    """The current request's id, or "" outside a request.

    Pass the request where you have it: that reading is correct even while an
    exception is on its way out.
    """
    if request is not None:
        rid = request.scope.get(REQUEST_ID_SCOPE_KEY)
        if rid:
            return rid
    return _request_id.get()


def _new_request_id() -> str:
    return f"req_{secrets.token_hex(6)}"


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class ApiError(HTTPException):
    """A failure that carries its own code and wording.

        raise ApiError(401, "MISSING_BEARER_TOKEN", "Sign in to continue.")

    The alternative — a central table mapping reason strings to messages —
    means every new `raise` needs a matching entry somewhere else, and the two
    drift the moment someone forgets. The message belongs beside the condition
    that produced it, where the person writing the check can see it.

    Still an HTTPException, so FastAPI and Starlette treat it normally; the
    handler below just finds more on it than usual.
    """

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        *,
        details: list[dict] | None = None,
        headers: dict[str, str] | None = None,
    ):
        super().__init__(status_code=status_code, detail=message, headers=headers)
        self.code = code
        self.details = details or []


logger = logging.getLogger("northbound.api")


def _fallback_code(status_code: int) -> str:
    """A code for failures that carry none of their own.

    Our own raises use ApiError and name their code at the raise site. This is
    only for what the FRAMEWORK raises — a 404 for an unknown route, a 405 for
    the wrong verb — where there is nothing to read.

    The names come from the stdlib rather than a dict here, because HTTP status
    codes are a fixed, finished spec that `http.HTTPStatus` already spells out
    in full. A local copy would be the same list, shorter, and able to fall out
    of date. Non-standard codes (a proxy's 499) have no name, hence the guard.
    """
    try:
        return HTTPStatus(status_code).name
    except ValueError:
        return "ERROR"


def error_body(
    code: str,
    message: str,
    details: list[dict] | None = None,
    *,
    rid: str | None = None,
) -> dict[str, Any]:
    err: dict[str, Any] = {"code": code, "message": message}
    if details:
        err["details"] = details
    return {"success": False, "error": err, "request_id": rid or request_id()}


def success_body(
    data: Any, message: str | None = None, meta: dict | None = None
) -> dict[str, Any]:
    body: dict[str, Any] = {"success": True, "data": data}
    if message:
        body["message"] = message
    if meta:
        body["meta"] = meta
    body["request_id"] = request_id()
    return body


# ---------------------------------------------------------------------------
# Success wrapping
# ---------------------------------------------------------------------------

def enveloped(
    data: Any, *, message: str | None = None, meta: dict | None = None
) -> dict[str, Any]:
    """Attach a message or meta to a successful response.

        return enveloped(user, message=f"Invitation sent to {email}")
        return enveloped(rows, meta={"page": 1, "limit": 10, "total": 50})

    Returns a marker dict that EnvelopeRoute unpacks. A plain return value
    needs none of this — most endpoints have nothing to say beyond their data.
    """
    out: dict[str, Any] = {"__envelope__": data}
    if message:
        out["message"] = message
    if meta:
        out["meta"] = meta
    return out


class EnvelopeRoute(APIRoute):
    """Wraps a successful return value in `data`.

    Responses the endpoint built itself are passed through untouched — a
    stream, a redirect, a file. Wrapping a StreamingResponse is not merely
    unhelpful, it is impossible: it is a sequence of events over time, not one
    document.
    """

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        original = super().get_route_handler()

        async def handler(request: Request) -> Response:
            response = await original(request)

            # A stream is a sequence of events over time, not a document.
            # /api/run sends the agent's thinking as it happens; buffering it
            # to wrap it would make the widget sit silent and then dump
            # everything at once.
            if isinstance(response, StreamingResponse):
                return response

            # Deliberately NOT `isinstance(response, JSONResponse)`. When an
            # endpoint declares a return type, FastAPI takes an optimised path
            # and hands back a plain Response carrying pre-serialised bytes —
            # so a JSONResponse check silently skips almost every endpoint we
            # have. What matters is the media type, not the class.
            media = (response.media_type or "").split(";")[0].strip()
            if media != "application/json":
                return response

            if response.status_code >= 400:
                return response  # exception handlers own failures

            body = getattr(response, "body", None)
            if not body:
                return response  # 204 and friends

            import json

            payload = json.loads(body)
            if isinstance(payload, dict) and "success" in payload:
                return response  # already an envelope

            message = meta = None
            if isinstance(payload, dict) and "__envelope__" in payload:
                message = payload.get("message")
                meta = payload.get("meta")
                payload = payload["__envelope__"]

            headers = {
                k: v
                for k, v in response.headers.items()
                if k.lower() not in ("content-length", "content-type")
            }
            headers[REQUEST_ID_HEADER] = request_id()
            return JSONResponse(
                success_body(payload, message=message, meta=meta),
                status_code=response.status_code,
                headers=headers,
            )

        return handler


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------
# Written at module level and registered by name below, rather than nested
# inside install() under a decorator. A function that exists only to be
# swallowed by a decorator reads as dead code — nothing mentions the name
# again, so an editor greys it out and a reader has to know the framework to
# see that it runs at all. Out here each one can be imported and called
# directly in a test, and is built once rather than on every install().


async def request_id_middleware(request: Request, call_next):
    """Give the request an id, and echo it back on the response.

    Honouring an incoming id lets one trace span a proxy or the frontend; a
    fresh one is minted when the caller sends none.
    """
    rid = request.headers.get(REQUEST_ID_HEADER) or _new_request_id()
    request.scope[REQUEST_ID_SCOPE_KEY] = rid
    token = _request_id.set(rid)
    try:
        response = await call_next(request)
    finally:
        # In a finally block because the id is per-request state on a context
        # that outlives it — leaking it bleeds one request's id into the next.
        _request_id.reset(token)
    response.headers[REQUEST_ID_HEADER] = rid
    return response


async def http_error_handler(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    """Every raised HTTPException, ours or the framework's."""
    if isinstance(exc, ApiError):
        code, message, details = exc.code, exc.detail, exc.details
    else:
        # Raised by the framework, not by us: a 404 for an unknown route, a
        # 405 for the wrong verb. There is no code to read, so it comes from
        # the status and the message is whatever the framework said.
        code = _fallback_code(exc.status_code)
        message = str(exc.detail or "Request failed.")
        details = []
    return JSONResponse(
        error_body(code, message, details, rid=request_id(request)),
        status_code=exc.status_code,
        headers=getattr(exc, "headers", None),
    )


async def validation_error_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Pydantic's rejections, flattened to one field/issue pair each."""
    details = []
    for err in exc.errors():
        # loc is ("body", "phone") or ("query", "lead_id"); the first element
        # names WHERE, which the caller does not need.
        field = ".".join(str(p) for p in err.get("loc", ())[1:]) or "body"
        issue = err.get("msg", "Invalid value")
        details.append({"field": field, "issue": issue.replace("Value error, ", "")})
    return JSONResponse(
        error_body("VALIDATION_FAILED", "The provided input contains errors.", details),
        status_code=422,
    )


async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """A crash, shaped like every other failure.

    Without this, an unhandled exception leaves Starlette to answer with
    `text/plain` "Internal Server Error" — so the one response a client is
    least prepared for is also the only one that is not JSON, and `unwrap()`
    throws a parse error instead of the real problem.

    The exception text never reaches the client: it is the least sanitised
    string in the process and routinely holds a query, a row, or a connection
    string. What the client gets is the request id, which is enough for someone
    to find the traceback in the logs.
    """
    logger.error(
        "unhandled %s on %s %s request_id=%s",
        type(exc).__name__,
        request.method,
        request.url.path,
        request_id(request),
    )
    return JSONResponse(
        error_body(
            "INTERNAL_ERROR",
            "Something went wrong on our end.",
            rid=request_id(request),
        ),
        status_code=500,
        # Our middleware stamps this header on the way out, but the exception
        # blew past it — nothing set it on this response.
        headers={REQUEST_ID_HEADER: request_id(request)},
    )


def install(app: FastAPI) -> None:
    """Attach the request id, and make every failure share one shape.

    Set `app.router.route_class = EnvelopeRoute` as well — that is what wraps
    the successful returns, and it has to be in place before any route is
    declared, so it cannot be done from here.
    """
    app.middleware("http")(request_id_middleware)
    app.add_exception_handler(StarletteHTTPException, http_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    # Last resort. Starlette still re-raises afterwards, so uvicorn logs the
    # traceback as usual — this only decides what the client is told.
    app.add_exception_handler(Exception, unhandled_error_handler)
