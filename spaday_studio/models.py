"""Structured project documents and semantic edit operations."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, TypeAdapter, field_validator, model_validator
from spaday import Component, element


class StudioNode(BaseModel):
    """One editable component in a Studio document."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    tag: str = Field(min_length=1)
    key: str | None = None
    props: dict[str, JsonValue] = Field(default_factory=dict)
    slots: dict[str, list[StudioNode]] = Field(default_factory=dict)

    @field_validator("tag")
    @classmethod
    def safe_tag(cls, value: str) -> str:
        normalized = value.lower()
        if not normalized[0].isalpha() or any(not (character.isalnum() or character in ".-") for character in normalized):
            raise ValueError("component tag must contain only letters, digits, dots, and hyphens")
        if normalized in {"base", "embed", "iframe", "link", "meta", "object", "script", "style"}:
            raise ValueError(f"component tag {value!r} is not allowed in Studio")
        return normalized

    @field_validator("props")
    @classmethod
    def safe_props(cls, value: dict[str, JsonValue]) -> dict[str, JsonValue]:
        for name, prop in value.items():
            normalized = name.lower()
            if normalized.startswith("on") or normalized in {"__proto__", "constructor", "innerhtml", "outerhtml", "prototype", "srcdoc"}:
                raise ValueError(f"component prop {name!r} is not allowed in Studio")
            if normalized in {"action", "formaction", "href", "src"} and isinstance(prop, str):
                compact = prop.lstrip().lower()
                if compact.startswith(("javascript:", "data:text/html")):
                    raise ValueError(f"component prop {name!r} contains an unsafe URL")
        return value

    @model_validator(mode="after")
    def text_is_leaf_content(self) -> StudioNode:
        if "textContent" in self.props and any(self.slots.values()):
            raise ValueError("a component with textContent cannot also have child nodes")
        return self

    def component(self) -> Component:
        """Compile this document node to an ordinary spaday component."""
        component = element(self.tag, key=self.key or self.id, **self.props)
        component.prop("data-spaday-studio-id", self.id)
        for slot, children in self.slots.items():
            for child in children:
                component.child_in(slot, child.component())
        return component


class StudioDocument(BaseModel):
    """An editable component tree with globally unique authoring identities."""

    model_config = ConfigDict(extra="forbid")

    title: str
    root: StudioNode

    @model_validator(mode="after")
    def unique_ids(self) -> StudioDocument:
        seen: set[str] = set()
        duplicate: str | None = None

        def visit(node: StudioNode) -> None:
            nonlocal duplicate
            if node.id in seen and duplicate is None:
                duplicate = node.id
            seen.add(node.id)
            for children in node.slots.values():
                for child in children:
                    visit(child)

        visit(self.root)
        if duplicate is not None:
            raise ValueError(f"duplicate Studio node id {duplicate!r}")
        return self

    def component(self) -> Component:
        """Compile the document root to a spaday component tree."""
        return self.root.component()


class SetProp(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["set_prop"]
    id: str
    name: str
    value: JsonValue


class UnsetProp(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["unset_prop"]
    id: str
    name: str


class InsertNode(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["insert"]
    parent_id: str
    slot: str = "default"
    index: int = Field(ge=0)
    node: StudioNode


class MoveNode(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["move"]
    id: str
    parent_id: str
    slot: str = "default"
    index: int = Field(ge=0)


class RemoveNode(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["remove"]
    id: str


StudioOperation = Annotated[SetProp | UnsetProp | InsertNode | MoveNode | RemoveNode, Field(discriminator="kind")]
operations_adapter = TypeAdapter(list[StudioOperation])


def parse_operations(value: object) -> list[StudioOperation]:
    """Validate a JSON-compatible list of semantic edit operations."""
    return operations_adapter.validate_python(value)


def find_node(root: StudioNode, node_id: str) -> StudioNode:
    """Return the node with ``node_id`` or raise ``KeyError``."""
    if root.id == node_id:
        return root
    for children in root.slots.values():
        for child in children:
            try:
                return find_node(child, node_id)
            except KeyError:
                pass
    raise KeyError(node_id)


def _location(root: StudioNode, node_id: str) -> tuple[StudioNode, str, int] | None:
    for slot, children in root.slots.items():
        for index, child in enumerate(children):
            if child.id == node_id:
                return root, slot, index
            nested = _location(child, node_id)
            if nested is not None:
                return nested
    return None


def apply_operations(document: StudioDocument, operations: list[StudioOperation]) -> StudioDocument:
    """Apply operations atomically and return a newly validated document."""
    candidate = document.model_copy(deep=True)
    for operation in operations:
        if isinstance(operation, SetProp):
            find_node(candidate.root, operation.id).props[operation.name] = operation.value
        elif isinstance(operation, UnsetProp):
            find_node(candidate.root, operation.id).props.pop(operation.name, None)
        elif isinstance(operation, InsertNode):
            parent = find_node(candidate.root, operation.parent_id)
            children = parent.slots.setdefault(operation.slot, [])
            if operation.index > len(children):
                raise IndexError(f"insert index {operation.index} exceeds slot length {len(children)}")
            children.insert(operation.index, operation.node.model_copy(deep=True))
        elif isinstance(operation, RemoveNode):
            location = _location(candidate.root, operation.id)
            if location is None:
                if operation.id == candidate.root.id:
                    raise ValueError("cannot remove the document root")
                raise KeyError(operation.id)
            parent, slot, index = location
            parent.slots[slot].pop(index)
        elif isinstance(operation, MoveNode):
            location = _location(candidate.root, operation.id)
            if location is None:
                if operation.id == candidate.root.id:
                    raise ValueError("cannot move the document root")
                raise KeyError(operation.id)
            old_parent, old_slot, old_index = location
            moved = old_parent.slots[old_slot].pop(old_index)
            parent = find_node(candidate.root, operation.parent_id)
            children = parent.slots.setdefault(operation.slot, [])
            if operation.index > len(children):
                raise IndexError(f"move index {operation.index} exceeds slot length {len(children)}")
            children.insert(operation.index, moved)
    return StudioDocument.model_validate(candidate.model_dump())


__all__ = [
    "InsertNode",
    "MoveNode",
    "RemoveNode",
    "SetProp",
    "StudioDocument",
    "StudioNode",
    "StudioOperation",
    "UnsetProp",
    "apply_operations",
    "find_node",
    "parse_operations",
]
