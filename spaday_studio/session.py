"""Revisioned Studio state shared by browser and MCP clients."""

from __future__ import annotations

import json
from collections.abc import Callable
from threading import RLock
from uuid import uuid4

from pydantic import BaseModel
from spaday import diff

from .models import StudioDocument, apply_operations, find_node, parse_operations
from .project import export_python


class RevisionConflict(ValueError):
    """Raised when an edit targets a stale project revision."""


class PreviewConflict(ValueError):
    """Raised when a preview is missing, stale, or has a different identity."""


class StudioState(BaseModel):
    """State mirrored to connected Studio canvases through transports."""

    revision: int = 0
    document: StudioDocument
    preview: StudioDocument | None = None
    preview_id: str | None = None
    preview_base_revision: int | None = None


class StudioSession:
    """Apply validated edits and manage one transactional pilot preview."""

    def __init__(self, document: StudioDocument, *, save_document: Callable[[StudioDocument], None] | None = None) -> None:
        self.state = StudioState(document=document)
        self._history: list[StudioDocument] = []
        self._lock = RLock()
        self._save_document = save_document

    @property
    def active_document(self) -> StudioDocument:
        """Document currently visible on the canvas."""
        return self.state.preview or self.state.document

    def render(self):
        """Compile the currently visible document for spaday's tree endpoint."""
        return self.active_document.component()

    def snapshot(self) -> dict:
        """Return JSON-compatible canonical and preview state."""
        with self._lock:
            return self.state.model_dump(mode="json")

    def inspect(self, node_id: str) -> dict:
        """Return one node from the visible document."""
        with self._lock:
            return find_node(self.active_document.root, node_id).model_dump(mode="json")

    def python_source(self) -> str:
        """Export the canonical document as deterministic spaday Python."""
        return self.python_export()["source"]

    def python_export(self) -> dict:
        """Return a matching canonical revision and deterministic Python source."""
        with self._lock:
            return {"revision": self.state.revision, "source": export_python(self.state.document)}

    def apply(self, expected_revision: int, operations: object) -> dict:
        """Commit semantic operations against the expected canonical revision."""
        parsed = parse_operations(operations)
        with self._lock:
            self._expect_revision(expected_revision)
            candidate = apply_operations(self.state.document, parsed)
            self._persist(candidate)
            self._history.append(self.state.document.model_copy(deep=True))
            self.state.document = candidate
            self.state.revision += 1
            self._clear_preview()
            return self.snapshot()

    def preview(self, expected_revision: int, operations: object) -> dict:
        """Publish a non-canonical draft and return its spaday tree patch."""
        parsed = parse_operations(operations)
        with self._lock:
            self._expect_revision(expected_revision)
            candidate = apply_operations(self.state.document, parsed)
            preview_id = uuid4().hex
            old = self.state.document.component().to_json()
            new = candidate.component().to_json()
            self.state.preview = candidate
            self.state.preview_id = preview_id
            self.state.preview_base_revision = expected_revision
            return {
                "preview_id": preview_id,
                "base_revision": expected_revision,
                "patch": json.loads(diff(old, new)),
            }

    def commit_preview(self, preview_id: str) -> dict:
        """Commit the current preview when its identity and base revision still match."""
        with self._lock:
            self._expect_preview(preview_id)
            assert self.state.preview is not None
            self._persist(self.state.preview)
            self._history.append(self.state.document.model_copy(deep=True))
            self.state.document = self.state.preview
            self.state.revision += 1
            self._clear_preview()
            return self.snapshot()

    def discard_preview(self, preview_id: str) -> dict:
        """Discard the current preview without advancing the canonical revision."""
        with self._lock:
            self._expect_preview(preview_id)
            self._clear_preview()
            return self.snapshot()

    def undo(self, expected_revision: int) -> dict:
        """Restore the last canonical document as a new revision."""
        with self._lock:
            self._expect_revision(expected_revision)
            if not self._history:
                raise ValueError("no committed edit to undo")
            candidate = self._history[-1]
            self._persist(candidate)
            self.state.document = self._history.pop()
            self.state.revision += 1
            self._clear_preview()
            return self.snapshot()

    def _expect_revision(self, expected_revision: int) -> None:
        if expected_revision != self.state.revision:
            raise RevisionConflict(f"expected revision {expected_revision}, current revision is {self.state.revision}")

    def _expect_preview(self, preview_id: str) -> None:
        if self.state.preview is None or self.state.preview_id != preview_id:
            raise PreviewConflict("preview is missing or its id does not match")
        if self.state.preview_base_revision != self.state.revision:
            raise PreviewConflict("preview is stale because the canonical revision changed")

    def _clear_preview(self) -> None:
        self.state.preview = None
        self.state.preview_id = None
        self.state.preview_base_revision = None

    def _persist(self, document: StudioDocument) -> None:
        if self._save_document is not None:
            self._save_document(document)


__all__ = ["PreviewConflict", "RevisionConflict", "StudioSession", "StudioState"]
