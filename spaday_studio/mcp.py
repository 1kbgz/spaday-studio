"""MCP resources and tools for a Studio session."""

from __future__ import annotations

from mcp.server import MCPServer
from pydantic import BaseModel

from .access import StudioAccessContext, StudioAuthorizer, allow_all, require_access
from .catalog import ComponentCatalog, ComponentSchema, ComponentSummary, discover_catalog
from .models import StudioDocument, StudioNode, StudioOperation
from .session import StudioSession, StudioState


class PreviewResult(BaseModel):
    """Identity, document, and component-tree patch for a private preview."""

    preview_id: str
    base_revision: int
    document: StudioDocument
    patch: dict


class PythonExport(BaseModel):
    """Deterministic Python source for one canonical revision."""

    revision: int
    source: str


class ComponentList(BaseModel):
    """Compact schemas for components matching an optional package filter."""

    components: list[ComponentSummary]


class HistoryState(BaseModel):
    """Undo and redo availability for one actor."""

    can_undo: bool
    can_redo: bool


def create_mcp(
    session: StudioSession,
    catalog: ComponentCatalog | None = None,
    *,
    authorize: StudioAuthorizer = allow_all,
) -> MCPServer:
    """Create an MCP server bound to ``session``."""
    component_catalog = catalog or discover_catalog()
    context = StudioAccessContext("mcp")
    server = MCPServer(
        "spaday-studio",
        instructions=(
            "Inspect the current spaday project, then use preview_operations before commit_preview. "
            "Read a component schema before inserting or changing its properties. Every edit is revision checked "
            "and expressed as typed component operations."
        ),
    )

    @server.resource("spaday://project")
    def project() -> dict:
        """Current canonical document, active preview, and revision."""
        require_access(authorize, context, "mcp", "read")
        return session.snapshot()

    @server.resource("spaday://catalog")
    def catalog_index() -> dict:
        """Installed package names and compact selected component summaries."""
        require_access(authorize, context, "mcp", "read")
        return {
            "available_packages": component_catalog.available_packages,
            "selected_packages": component_catalog.selected_packages,
            "components": [
                ComponentSummary.model_validate(component.model_dump()).model_dump(mode="json") for component in component_catalog.components
            ],
        }

    @server.tool()
    def inspect_component(component_id: str, preview_id: str | None = None, actor_id: str = "mcp") -> StudioNode:
        """Inspect one canonical component or a component in the actor's private preview."""
        require_access(authorize, context, actor_id, "read")
        return StudioNode.model_validate(session.inspect(component_id, draft_id=preview_id, owner=actor_id if preview_id else None))

    @server.tool()
    def list_components(package: str | None = None) -> ComponentList:
        """List compact component identities, optionally restricted to one selected package."""
        require_access(authorize, context, "mcp", "read")
        components = [component for component in component_catalog.components if package is None or component.package == package]
        return ComponentList(components=[ComponentSummary.model_validate(component.model_dump()) for component in components])

    @server.tool()
    def get_component_schema(tag: str) -> ComponentSchema:
        """Return editable property metadata for one selected component tag."""
        require_access(authorize, context, "mcp", "read")
        return component_catalog.component(tag)

    @server.tool()
    def export_python() -> PythonExport:
        """Export the canonical project as ordinary spaday Python source."""
        require_access(authorize, context, "mcp", "read")
        return PythonExport.model_validate(session.python_export())

    @server.tool()
    def preview_operations(
        expected_revision: int,
        operations: list[StudioOperation],
        actor_id: str = "mcp",
        preview_id: str | None = None,
    ) -> PreviewResult:
        """Create an actor-private preview or append operations to that preview."""
        require_access(authorize, context, actor_id, "edit")
        result = (
            session.update_preview(preview_id, operations, owner=actor_id)
            if preview_id is not None
            else session.preview(expected_revision, operations, owner=actor_id)
        )
        return PreviewResult.model_validate(result)

    @server.tool()
    def commit_preview(preview_id: str, actor_id: str = "mcp") -> StudioState:
        """Commit the actor's preview, rebasing disjoint accepted changes."""
        require_access(authorize, context, actor_id, "edit")
        return StudioState.model_validate(session.commit_preview(preview_id, owner=actor_id))

    @server.tool()
    def discard_preview(preview_id: str, actor_id: str = "mcp") -> StudioState:
        """Discard the actor's preview without changing the canonical revision."""
        require_access(authorize, context, actor_id, "edit")
        return StudioState.model_validate(session.discard_preview(preview_id, owner=actor_id))

    @server.tool()
    def apply_operations(expected_revision: int, operations: list[StudioOperation], actor_id: str = "mcp") -> StudioState:
        """Commit validated operations directly, without a preview."""
        require_access(authorize, context, actor_id, "admin")
        return StudioState.model_validate(session.apply(expected_revision, operations, owner=actor_id))

    @server.tool()
    def undo(expected_revision: int, actor_id: str = "mcp") -> StudioState:
        """Undo the actor's last commit when it remains the canonical head."""
        require_access(authorize, context, actor_id, "edit")
        return StudioState.model_validate(session.undo(expected_revision, owner=actor_id))

    @server.tool()
    def redo(expected_revision: int, actor_id: str = "mcp") -> StudioState:
        """Redo the actor's most recently undone commit."""
        require_access(authorize, context, actor_id, "edit")
        return StudioState.model_validate(session.redo(expected_revision, owner=actor_id))

    @server.tool()
    def history(actor_id: str = "mcp") -> HistoryState:
        """Return undo and redo availability for the actor."""
        require_access(authorize, context, actor_id, "read")
        return HistoryState.model_validate(session.history(actor_id))

    return server


__all__ = ["ComponentList", "HistoryState", "PreviewResult", "PythonExport", "create_mcp"]
