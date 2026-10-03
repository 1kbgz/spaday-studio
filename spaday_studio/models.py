"""Structured project documents and semantic edit operations."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, StrictBool, TypeAdapter, field_validator, model_validator
from spaday import Component, element, validate_action, validate_binding

WireObject = dict[str, JsonValue]
EventOptions = dict[Literal["capture", "once", "passive"], StrictBool]


class StudioNode(BaseModel):
    """One editable component in a Studio document."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    tag: str = Field(min_length=1)
    key: str | None = None
    props: dict[str, JsonValue] = Field(default_factory=dict)
    bindings: dict[str, WireObject] = Field(default_factory=dict)
    events: dict[str, WireObject] = Field(default_factory=dict)
    event_options: dict[str, EventOptions] = Field(default_factory=dict)
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

    @model_validator(mode="after")
    def options_have_events(self) -> StudioNode:
        if self.event_options.keys() - self.events.keys():
            raise ValueError("event_options requires a matching event action")
        return self

    @field_validator("bindings")
    @classmethod
    def valid_bindings(cls, value: dict[str, WireObject]) -> dict[str, WireObject]:
        return {name: validate_binding(binding) for name, binding in value.items()}

    @field_validator("events")
    @classmethod
    def valid_events(cls, value: dict[str, WireObject]) -> dict[str, WireObject]:
        return {name: validate_action(action) for name, action in value.items()}

    def component(self) -> Component:
        """Compile this document node to an ordinary spaday component."""
        component = element(self.tag, key=self.key or self.id, **self.props)
        component.prop("data-spaday-studio-id", self.id)
        for prop, binding in self.bindings.items():
            component.bind_wire(prop, binding)
        for event, action in self.events.items():
            component.on_wire(event, action, **self.event_options.get(event, {}))
        for slot, children in self.slots.items():
            for child in children:
                component.child_in(slot, child.component())
        return component


class StudioDocument(BaseModel):
    """An editable component tree with globally unique authoring identities."""

    model_config = ConfigDict(extra="forbid")

    title: str
    state: dict[str, JsonValue] = Field(default_factory=dict)
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

        def validate_refs(node: StudioNode) -> None:
            for event, action in node.events.items():
                for reference in _id_references(action):
                    if reference not in seen:
                        raise ValueError(f"component {node.id!r} event {event!r} references missing component {reference!r}")
            for children in node.slots.values():
                for child in children:
                    validate_refs(child)

        validate_refs(self.root)
        return self

    def component(self) -> Component:
        """Compile the document root to a spaday component tree."""
        return self.root.component()


class SetTitle(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["set_title"]
    value: str


class SetKey(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["set_key"]
    id: str
    value: str


class UnsetKey(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["unset_key"]
    id: str


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


class SetBinding(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["set_binding"]
    id: str
    name: str
    binding: WireObject

    @field_validator("binding")
    @classmethod
    def valid_binding(cls, value: WireObject) -> WireObject:
        return validate_binding(value)


class UnsetBinding(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["unset_binding"]
    id: str
    name: str


class SetEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["set_event"]
    id: str
    name: str
    action: WireObject
    options: EventOptions | None = None

    @field_validator("action")
    @classmethod
    def valid_action(cls, value: WireObject) -> WireObject:
        return validate_action(value)


class UnsetEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["unset_event"]
    id: str
    name: str


class SetState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["set_state"]
    name: str
    value: JsonValue


class UnsetState(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["unset_state"]
    name: str


class InsertNode(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["insert"]
    parent_id: str
    slot: str = "default"
    index: int | None = Field(default=None, ge=0)
    before_id: str | None = None
    after_id: str | None = None
    node: StudioNode

    @model_validator(mode="after")
    def one_position(self) -> InsertNode:
        if sum(value is not None for value in (self.index, self.before_id, self.after_id)) > 1:
            raise ValueError("insert accepts only one of index, before_id, or after_id")
        return self


class MoveNode(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["move"]
    id: str
    parent_id: str
    slot: str = "default"
    index: int | None = Field(default=None, ge=0)
    before_id: str | None = None
    after_id: str | None = None

    @model_validator(mode="after")
    def one_position(self) -> MoveNode:
        if sum(value is not None for value in (self.index, self.before_id, self.after_id)) > 1:
            raise ValueError("move accepts only one of index, before_id, or after_id")
        if self.id in {self.before_id, self.after_id}:
            raise ValueError("a node cannot be positioned relative to itself")
        return self


class RemoveNode(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["remove"]
    id: str


StudioOperation = Annotated[
    SetTitle
    | SetKey
    | UnsetKey
    | SetProp
    | UnsetProp
    | SetBinding
    | UnsetBinding
    | SetEvent
    | UnsetEvent
    | SetState
    | UnsetState
    | InsertNode
    | MoveNode
    | RemoveNode,
    Field(discriminator="kind"),
]
operation_adapter = TypeAdapter(StudioOperation)
operations_adapter = TypeAdapter(list[StudioOperation])


def parse_operations(value: object) -> list[StudioOperation]:
    """Validate a JSON-compatible list of semantic edit operations."""
    return operations_adapter.validate_python(value)


def document_schema() -> dict:
    """Return the public JSON Schema for a Studio document."""
    return StudioDocument.model_json_schema()


def operation_schema() -> dict:
    """Return the public JSON Schema for one Studio operation."""
    return operation_adapter.json_schema()


def operation_batch_schema() -> dict:
    """Return the public JSON Schema for an atomic Studio operation batch."""
    return operations_adapter.json_schema()


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
        if isinstance(operation, SetTitle):
            candidate.title = operation.value
        elif isinstance(operation, SetKey):
            find_node(candidate.root, operation.id).key = operation.value
        elif isinstance(operation, UnsetKey):
            find_node(candidate.root, operation.id).key = None
        elif isinstance(operation, SetProp):
            find_node(candidate.root, operation.id).props[operation.name] = operation.value
        elif isinstance(operation, UnsetProp):
            find_node(candidate.root, operation.id).props.pop(operation.name, None)
        elif isinstance(operation, SetBinding):
            find_node(candidate.root, operation.id).bindings[operation.name] = operation.binding
        elif isinstance(operation, UnsetBinding):
            find_node(candidate.root, operation.id).bindings.pop(operation.name, None)
        elif isinstance(operation, SetEvent):
            node = find_node(candidate.root, operation.id)
            node.events[operation.name] = operation.action
            if operation.options is not None:
                if operation.options:
                    node.event_options[operation.name] = operation.options
                else:
                    node.event_options.pop(operation.name, None)
        elif isinstance(operation, UnsetEvent):
            node = find_node(candidate.root, operation.id)
            node.events.pop(operation.name, None)
            node.event_options.pop(operation.name, None)
        elif isinstance(operation, SetState):
            candidate.state[operation.name] = operation.value
        elif isinstance(operation, UnsetState):
            candidate.state.pop(operation.name, None)
        elif isinstance(operation, InsertNode):
            parent = find_node(candidate.root, operation.parent_id)
            children = parent.slots.setdefault(operation.slot, [])
            children.insert(_position(children, operation), operation.node.model_copy(deep=True))
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
            children.insert(_position(children, operation), moved)
    return StudioDocument.model_validate(candidate.model_dump())


def _position(children: list[StudioNode], operation: InsertNode | MoveNode) -> int:
    if operation.before_id is not None:
        return _anchor_index(children, operation.before_id)
    if operation.after_id is not None:
        return _anchor_index(children, operation.after_id) + 1
    index = len(children) if operation.index is None else operation.index
    if index > len(children):
        raise IndexError(f"index {index} exceeds slot length {len(children)}")
    return index


def _anchor_index(children: list[StudioNode], anchor_id: str) -> int:
    try:
        return next(index for index, child in enumerate(children) if child.id == anchor_id)
    except StopIteration as error:
        raise KeyError(f"slot anchor {anchor_id!r} does not exist") from error


def _id_references(value: JsonValue) -> list[str]:
    if isinstance(value, dict):
        references = [value["id"]] if value.get("ref") == "id" and isinstance(value.get("id"), str) else []
        for nested in value.values():
            references.extend(_id_references(nested))
        return references
    if isinstance(value, list):
        return [reference for nested in value for reference in _id_references(nested)]
    return []


__all__ = [
    "InsertNode",
    "MoveNode",
    "RemoveNode",
    "SetBinding",
    "SetEvent",
    "SetProp",
    "SetState",
    "StudioDocument",
    "StudioNode",
    "StudioOperation",
    "UnsetBinding",
    "UnsetEvent",
    "UnsetProp",
    "UnsetState",
    "apply_operations",
    "find_node",
    "parse_operations",
]
