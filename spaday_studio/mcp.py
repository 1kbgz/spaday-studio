"""MCP resources and tools for a Studio session."""

from __future__ import annotations

from mcp.server import MCPServer
from pydantic import BaseModel

from .catalog import ComponentCatalog, ComponentSchema, ComponentSummary, discover_catalog
from .models import StudioNode, StudioOperation
from .session import StudioSession, StudioState


class PreviewResult(BaseModel):
    """Identity and component-tree patch for a published preview."""

    preview_id: str
    base_revision: int
    patch: dict


class PythonExport(BaseModel):
    """Deterministic Python source for one canonical revision."""

    revision: int
    source: str


class ComponentList(BaseModel):
    """Compact schemas for components matching an optional package filter."""

    components: list[ComponentSummary]


def create_mcp(session: StudioSession, catalog: ComponentCatalog | None = None) -> MCPServer:
    """Create an MCP server bound to ``session``."""
    component_catalog = catalog or discover_catalog()
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
        return session.snapshot()

    @server.resource("spaday://catalog")
    def catalog_index() -> dict:
        """Installed package names and compact selected component summaries."""
        return {
            "available_packages": component_catalog.available_packages,
            "selected_packages": component_catalog.selected_packages,
            "components": [
                ComponentSummary.model_validate(component.model_dump()).model_dump(mode="json") for component in component_catalog.components
            ],
        }

    @server.tool()
    def inspect_component(component_id: str) -> StudioNode:
        """Inspect one component by its stable Studio id."""
        return StudioNode.model_validate(session.inspect(component_id))

    @server.tool()
    def list_components(package: str | None = None) -> ComponentList:
        """List compact component identities, optionally restricted to one selected package."""
        components = [component for component in component_catalog.components if package is None or component.package == package]
        return ComponentList(components=[ComponentSummary.model_validate(component.model_dump()) for component in components])

    @server.tool()
    def get_component_schema(tag: str) -> ComponentSchema:
        """Return editable property metadata for one selected component tag."""
        return component_catalog.component(tag)

    @server.tool()
    def export_python() -> PythonExport:
        """Export the canonical project as ordinary spaday Python source."""
        return PythonExport.model_validate(session.python_export())

    @server.tool()
    def preview_operations(expected_revision: int, operations: list[StudioOperation]) -> PreviewResult:
        """Validate operations and publish a live non-canonical preview to connected canvases."""
        return PreviewResult.model_validate(session.preview(expected_revision, operations))

    @server.tool()
    def commit_preview(preview_id: str) -> StudioState:
        """Commit the matching live preview as a new canonical revision."""
        return StudioState.model_validate(session.commit_preview(preview_id))

    @server.tool()
    def discard_preview(preview_id: str) -> StudioState:
        """Discard the matching live preview without changing the canonical revision."""
        return StudioState.model_validate(session.discard_preview(preview_id))

    @server.tool()
    def apply_operations(expected_revision: int, operations: list[StudioOperation]) -> StudioState:
        """Commit validated operations directly, without a preview."""
        return StudioState.model_validate(session.apply(expected_revision, operations))

    @server.tool()
    def undo(expected_revision: int) -> StudioState:
        """Restore the previous canonical document as a new revision."""
        return StudioState.model_validate(session.undo(expected_revision))

    return server


__all__ = ["ComponentList", "PreviewResult", "PythonExport", "create_mcp"]
