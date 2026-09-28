"""Revisioned Studio state shared by browser and MCP clients."""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from threading import RLock
from uuid import uuid4

from pydantic import BaseModel
from spaday import diff

from .models import (
    InsertNode,
    MoveNode,
    RemoveNode,
    SetBinding,
    SetEvent,
    SetKey,
    SetProp,
    SetState,
    SetTitle,
    StudioDocument,
    StudioOperation,
    UnsetBinding,
    UnsetEvent,
    UnsetKey,
    UnsetProp,
    UnsetState,
    apply_operations,
    find_node,
    parse_operations,
)
from .project import export_python


class RevisionConflict(ValueError):
    """Raised when an edit targets a stale project revision."""


class PreviewConflict(ValueError):
    """Raised when a private draft is missing, stale, or conflicts with accepted edits."""


class StudioState(BaseModel):
    """Canonical state mirrored to connected Studio canvases through transports."""

    revision: int = 0
    document: StudioDocument


@dataclass
class _Draft:
    id: str
    owner: str
    base_revision: int
    operations: list[StudioOperation]
    document: StudioDocument


@dataclass
class _Commit:
    revision: int
    owner: str
    operations: list[StudioOperation] | None
    previous: StudioDocument
    current: StudioDocument


class StudioSession:
    """Apply validated edits and manage isolated transactional drafts."""

    def __init__(
        self,
        document: StudioDocument,
        *,
        save_document: Callable[[StudioDocument], None] | None = None,
        history_limit: int = 100,
    ) -> None:
        if history_limit < 1:
            raise ValueError("history_limit must be at least 1")
        self.state = StudioState(document=document)
        self._drafts: dict[str, _Draft] = {}
        self._commits: list[_Commit] = []
        self._undo: list[_Commit] = []
        self._redo: list[_Commit] = []
        self._history_floor = 0
        self._history_limit = history_limit
        self._lock = RLock()
        self._save_document = save_document

    @property
    def active_document(self) -> StudioDocument:
        """Canonical document currently visible to shared clients."""
        return self.state.document

    @property
    def draft_base_revisions(self) -> set[int]:
        """Canonical revisions still referenced by private drafts."""
        with self._lock:
            return {draft.base_revision for draft in self._drafts.values()}

    def render(self):
        """Compile the canonical document for spaday's tree endpoint."""
        return self.state.document.component()

    def snapshot(self) -> dict:
        """Return JSON-compatible canonical state; private drafts are never mirrored."""
        with self._lock:
            return self.state.model_dump(mode="json")

    def inspect(self, node_id: str, *, draft_id: str | None = None, owner: str | None = None) -> dict:
        """Return one node from the canonical document or an owned private draft."""
        with self._lock:
            document = self._owned_draft(draft_id, owner).document if draft_id is not None else self.state.document
            return find_node(document.root, node_id).model_dump(mode="json")

    def preview_for(self, owner: str) -> dict | None:
        """Return ``owner``'s active private preview, if one exists."""
        with self._lock:
            draft = next((draft for draft in self._drafts.values() if draft.owner == owner), None)
            if draft is None:
                return None
            old = self.state.document.component().to_json()
            new = draft.document.component().to_json()
            return {
                "preview_id": draft.id,
                "base_revision": draft.base_revision,
                "document": draft.document.model_dump(mode="json"),
                "patch": json.loads(diff(old, new)),
            }

    def python_source(self) -> str:
        """Export the canonical document as deterministic spaday Python."""
        return self.python_export()["source"]

    def python_export(self) -> dict:
        """Return a matching canonical revision and deterministic Python source."""
        with self._lock:
            return {"revision": self.state.revision, "source": export_python(self.state.document)}

    def apply(self, expected_revision: int, operations: object, *, owner: str = "direct") -> dict:
        """Commit semantic operations directly against the expected canonical revision."""
        parsed = parse_operations(operations)
        with self._lock:
            self._expect_revision(expected_revision)
            candidate = apply_operations(self.state.document, parsed)
            self._accept(candidate, parsed, owner)
            return self.snapshot()

    def preview(self, expected_revision: int, operations: object, *, owner: str = "direct") -> dict:
        """Create or replace an owner's private draft and return its document and tree patch."""
        parsed = parse_operations(operations)
        with self._lock:
            self._expect_revision(expected_revision)
            candidate = apply_operations(self.state.document, parsed)
            preview_id = uuid4().hex
            for draft_id in [key for key, draft in self._drafts.items() if draft.owner == owner]:
                del self._drafts[draft_id]
            self._drafts[preview_id] = _Draft(preview_id, owner, expected_revision, parsed, candidate)
            old = self.state.document.component().to_json()
            new = candidate.component().to_json()
            return {
                "preview_id": preview_id,
                "base_revision": expected_revision,
                "document": candidate.model_dump(mode="json"),
                "patch": json.loads(diff(old, new)),
            }

    def update_preview(self, preview_id: str, operations: object, *, owner: str = "direct") -> dict:
        """Append validated operations to an existing owned draft."""
        parsed = parse_operations(operations)
        with self._lock:
            draft = self._owned_draft(preview_id, owner)
            candidate = apply_operations(draft.document, parsed)
            old = draft.document.component().to_json()
            new = candidate.component().to_json()
            draft.operations.extend(parsed)
            draft.document = candidate
            return {
                "preview_id": preview_id,
                "base_revision": draft.base_revision,
                "document": candidate.model_dump(mode="json"),
                "patch": json.loads(diff(old, new)),
            }

    def commit_preview(self, preview_id: str, *, owner: str | None = None) -> dict:
        """Commit an owned draft, rebasing it over disjoint accepted changes."""
        with self._lock:
            draft = self._owned_draft(preview_id, owner)
            if draft.base_revision < self._history_floor:
                raise PreviewConflict(f"draft cannot be rebased because revision {draft.base_revision} history is no longer retained")
            intervening = [commit for commit in self._commits if commit.revision > draft.base_revision]
            for commit in intervening:
                if commit.operations is None:
                    raise PreviewConflict(f"draft conflicts with revision {commit.revision}: canonical history changed")
                reason = _conflict_reason(draft.operations, commit.operations)
                if reason is not None:
                    raise PreviewConflict(f"draft conflicts with revision {commit.revision}: {reason}")
            try:
                candidate = apply_operations(self.state.document, draft.operations)
            except (IndexError, KeyError, ValueError) as error:
                raise PreviewConflict(f"draft cannot be rebased: {error}") from error
            self._accept(candidate, draft.operations, draft.owner)
            del self._drafts[preview_id]
            return self.snapshot()

    def discard_preview(self, preview_id: str, *, owner: str | None = None) -> dict:
        """Discard an owned draft without advancing the canonical revision."""
        with self._lock:
            self._owned_draft(preview_id, owner)
            del self._drafts[preview_id]
            return self.snapshot()

    def undo(self, expected_revision: int, *, owner: str = "direct") -> dict:
        """Undo the owner's most recent commit when it is still the canonical head."""
        with self._lock:
            self._expect_revision(expected_revision)
            if not self._undo:
                raise ValueError("no committed edit to undo")
            commit = self._undo[-1]
            if commit.owner != owner:
                raise RevisionConflict(f"revision {commit.revision} belongs to another editor")
            candidate = commit.previous
            previous = self.state.document.model_copy(deep=True)
            self._persist(candidate)
            self.state.document = candidate
            self.state.revision += 1
            self._undo.pop()
            self._redo.append(commit)
            self._record_history_change(owner, previous, candidate)
            return self.snapshot()

    def redo(self, expected_revision: int, *, owner: str = "direct") -> dict:
        """Redo the owner's most recently undone commit when no new edit replaced it."""
        with self._lock:
            self._expect_revision(expected_revision)
            if not self._redo:
                raise ValueError("no committed edit to redo")
            commit = self._redo[-1]
            if commit.owner != owner:
                raise RevisionConflict("redo belongs to another editor")
            candidate = commit.current
            previous = self.state.document.model_copy(deep=True)
            self._persist(candidate)
            self.state.document = candidate
            self.state.revision += 1
            self._redo.pop()
            self._undo.append(commit)
            self._record_history_change(owner, previous, candidate)
            return self.snapshot()

    def history(self, owner: str = "direct") -> dict[str, bool]:
        """Return whether ``owner`` can undo or redo the canonical head."""
        with self._lock:
            return {
                "can_undo": bool(self._undo and self._undo[-1].owner == owner),
                "can_redo": bool(self._redo and self._redo[-1].owner == owner),
            }

    def _accept(self, candidate: StudioDocument, operations: list[StudioOperation], owner: str) -> None:
        previous = self.state.document.model_copy(deep=True)
        self._persist(candidate)
        self.state.document = candidate
        self.state.revision += 1
        commit = _Commit(self.state.revision, owner, operations, previous, candidate.model_copy(deep=True))
        self._commits.append(commit)
        self._undo.append(commit)
        self._redo.clear()
        self._prune_history()

    def _record_history_change(self, owner: str, previous: StudioDocument, current: StudioDocument) -> None:
        self._commits.append(
            _Commit(
                self.state.revision,
                owner,
                None,
                previous,
                current.model_copy(deep=True),
            )
        )
        self._prune_history()

    def _prune_history(self) -> None:
        if len(self._commits) > self._history_limit:
            removed = self._commits[: -self._history_limit]
            self._commits = self._commits[-self._history_limit :]
            self._history_floor = max(self._history_floor, removed[-1].revision)
        if len(self._undo) > self._history_limit:
            self._undo = self._undo[-self._history_limit :]
        if len(self._redo) > self._history_limit:
            self._redo = self._redo[-self._history_limit :]

    def _expect_revision(self, expected_revision: int) -> None:
        if expected_revision != self.state.revision:
            raise RevisionConflict(f"expected revision {expected_revision}, current revision is {self.state.revision}")

    def _owned_draft(self, preview_id: str | None, owner: str | None) -> _Draft:
        if preview_id is None or preview_id not in self._drafts:
            raise PreviewConflict("draft is missing or its id does not match")
        draft = self._drafts[preview_id]
        if owner is not None and draft.owner != owner:
            raise PreviewConflict("draft belongs to another editor")
        return draft

    def _persist(self, document: StudioDocument) -> None:
        if self._save_document is not None:
            self._save_document(document)


def _conflict_reason(draft: list[StudioOperation], accepted: list[StudioOperation]) -> str | None:
    draft_facts = _operation_facts(draft)
    accepted_facts = _operation_facts(accepted)
    overlap = draft_facts["fields"] & accepted_facts["fields"]
    if overlap:
        return f"both drafts edit {min(overlap)!r}"
    if draft_facts["targets"] & accepted_facts["removed"]:
        return f"target node {min(draft_facts['targets'] & accepted_facts['removed'])!r} was removed"
    if accepted_facts["targets"] & draft_facts["removed"]:
        return f"draft removes edited node {min(accepted_facts['targets'] & draft_facts['removed'])!r}"
    overlap = draft_facts["nodes"] & accepted_facts["nodes"]
    if overlap:
        return f"both drafts move or remove node {min(overlap)!r}"
    overlap = draft_facts["indexed_slots"] & accepted_facts["slots"]
    if overlap:
        return f"numeric placement is stale in slot {min(overlap)!r}"
    if draft_facts["indexed_slots"] and accepted_facts["removed"]:
        return "numeric placement is stale after a node was removed"
    overlap = draft_facts["anchors"] & (accepted_facts["removed"] | accepted_facts["moved"])
    if overlap:
        return f"placement anchor {min(overlap)!r} moved or was removed"
    overlap = draft_facts["inserted"] & accepted_facts["inserted"]
    if overlap:
        return f"both drafts insert node {min(overlap)!r}"
    return None


def _operation_facts(operations: list[StudioOperation]) -> dict[str, set]:
    facts: dict[str, set] = {
        name: set() for name in ("fields", "targets", "removed", "moved", "nodes", "slots", "indexed_slots", "anchors", "inserted")
    }
    for operation in operations:
        if isinstance(operation, SetTitle):
            facts["fields"].add(("document", "title"))
        elif isinstance(operation, (SetKey, UnsetKey)):
            facts["fields"].add(("key", operation.id))
            facts["targets"].add(operation.id)
        elif isinstance(operation, (SetProp, UnsetProp)):
            facts["fields"].add(("prop", operation.id, operation.name))
            facts["targets"].add(operation.id)
        elif isinstance(operation, (SetBinding, UnsetBinding)):
            facts["fields"].add(("binding", operation.id, operation.name))
            facts["targets"].add(operation.id)
        elif isinstance(operation, (SetEvent, UnsetEvent)):
            facts["fields"].add(("event", operation.id, operation.name))
            facts["targets"].add(operation.id)
        elif isinstance(operation, (SetState, UnsetState)):
            facts["fields"].add(("state", operation.name))
        elif isinstance(operation, InsertNode):
            facts["slots"].add((operation.parent_id, operation.slot))
            if operation.index is not None:
                facts["indexed_slots"].add((operation.parent_id, operation.slot))
            facts["anchors"].update(anchor for anchor in (operation.before_id, operation.after_id) if anchor is not None)
            facts["inserted"].add(operation.node.id)
            facts["targets"].add(operation.parent_id)
        elif isinstance(operation, MoveNode):
            facts["nodes"].add(operation.id)
            facts["moved"].add(operation.id)
            facts["slots"].add((operation.parent_id, operation.slot))
            if operation.index is not None:
                facts["indexed_slots"].add((operation.parent_id, operation.slot))
            facts["anchors"].update(anchor for anchor in (operation.before_id, operation.after_id) if anchor is not None)
            facts["targets"].update((operation.id, operation.parent_id))
        elif isinstance(operation, RemoveNode):
            facts["nodes"].add(operation.id)
            facts["removed"].add(operation.id)
    return facts


__all__ = ["PreviewConflict", "RevisionConflict", "StudioSession", "StudioState"]
