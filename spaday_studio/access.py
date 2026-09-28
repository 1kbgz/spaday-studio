"""Host-defined Studio authorization roles."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from starlette.requests import HTTPConnection

StudioRole = Literal["read", "edit", "admin"]


@dataclass(frozen=True)
class StudioAccessContext:
    """Request context passed to a host authorizer."""

    scope: Literal["http", "websocket", "mcp"]
    connection: HTTPConnection | None = None


StudioAuthorizer = Callable[[StudioAccessContext, str], StudioRole]

_ROLE_LEVEL = {"read": 0, "edit": 1, "admin": 2}


def allow_all(_context: StudioAccessContext, _actor_id: str) -> StudioRole:
    """Grant the default trusted-local Studio administrator role."""
    return "admin"


def require_access(
    authorizer: StudioAuthorizer,
    context: StudioAccessContext,
    actor_id: str,
    required: StudioRole,
) -> StudioRole:
    """Return the actor's role or raise when it lacks ``required`` access."""
    role = authorizer(context, actor_id)
    if role not in _ROLE_LEVEL:
        raise ValueError(f"unknown Studio role {role!r}")
    if _ROLE_LEVEL[role] < _ROLE_LEVEL[required]:
        raise PermissionError(f"actor {actor_id!r} requires {required} access")
    return role


__all__ = ["StudioAccessContext", "StudioAuthorizer", "StudioRole", "allow_all", "require_access"]
