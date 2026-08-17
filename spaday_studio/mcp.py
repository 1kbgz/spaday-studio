"""MCP resources and tools for a Studio session."""

from __future__ import annotations

from mcp.server import MCPServer
from pydantic import BaseModel

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


def create_mcp(session: StudioSession) -> MCPServer:
    """Create an MCP server bound to ``session``."""
    server = MCPServer(
        "spaday-studio",
        instructions=(
            "Inspect the current spaday project, then use preview_operations before commit_preview. "
            "Every edit is revision checked and expressed as typed component operations."
        ),
    )

    @server.resource("spaday://project")
    def project() -> dict:
        """Current canonical document, active preview, and revision."""
        return session.snapshot()

    @server.tool()
    def inspect_component(component_id: str) -> StudioNode:
        """Inspect one component by its stable Studio id."""
        return StudioNode.model_validate(session.inspect(component_id))

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


__all__ = ["PreviewResult", "PythonExport", "create_mcp"]
