# Set Studio access roles

This guide shows how to assign read, edit, and admin access in a hosted Studio application.

Pass a synchronous authorizer to `create_app()`:

```python
from spaday_studio import StudioAccessContext
from spaday_studio.server import create_app


def authorize(context: StudioAccessContext, actor_id: str):
    if context.scope == "mcp":
        return "edit"

    connection = context.connection
    principal = connection.scope.get("user")
    if principal is None or principal.actor_id != actor_id:
        raise PermissionError("actor identity does not match the authenticated principal")
    return principal.studio_role


app = create_app(authorize=authorize)
```

Authenticate HTTP and WebSocket connections before they reach Studio. The browser sends its actor ID with
draft and history requests and in the collaborative-buffer WebSocket path; the callback must compare that
claim with the authenticated principal.

The roles are cumulative:

| Role    | Access                                                                    |
| ------- | ------------------------------------------------------------------------- |
| `read`  | Open the canvas and receive canonical and collaborative-buffer updates.   |
| `edit`  | Create, recover, commit, and discard drafts; edit buffers; undo and redo. |
| `admin` | Commit direct canonical operation batches.                                |

MCP tool execution has an `mcp` context without an HTTP request object. Authenticate the `/mcp` mount in
the host and make the authorizer return the allowed role for its actor IDs. Raise `PermissionError` to deny
an actor's role-bearing Studio requests. Deny unauthenticated access to the canvas and canonical WebSocket
in the upstream host.
