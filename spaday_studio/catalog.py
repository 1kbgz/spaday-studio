"""Opt-in component catalog discovery for Studio."""

from __future__ import annotations

import inspect
import types
from importlib import import_module, metadata
from typing import Any, Literal, cast, get_args, get_origin, get_type_hints

from pydantic import BaseModel, Field, JsonValue
from spaday import Component

PropertyKind = Literal["string", "boolean", "number", "enum", "json"]


class PropertySchema(BaseModel):
    """One editable DOM property in a component schema."""

    name: str
    kind: PropertyKind
    choices: list[JsonValue] = Field(default_factory=list)


class ComponentSchema(BaseModel):
    """The Studio-facing schema for one component tag."""

    package: str
    tag: str
    class_name: str
    summary: str | None = None
    props: list[PropertySchema] = Field(default_factory=list)


class ComponentSummary(BaseModel):
    """Compact component identity returned by catalog listings."""

    package: str
    tag: str
    class_name: str
    summary: str | None = None


class ComponentCatalog(BaseModel):
    """Available package names and schemas for explicitly selected packages."""

    available_packages: list[str]
    selected_packages: list[str]
    components: list[ComponentSchema]

    def component(self, tag: str) -> ComponentSchema:
        """Return the schema for ``tag`` or raise ``KeyError``."""
        try:
            return next(component for component in self.components if component.tag == tag)
        except StopIteration as error:
            raise KeyError(tag) from error


_COMMON_PROPS: list[PropertySchema] = [
    PropertySchema(name="id", kind="string"),
    PropertySchema(name="class", kind="string"),
    PropertySchema(name="style", kind="string"),
    PropertySchema(name="title", kind="string"),
    PropertySchema(name="hidden", kind="boolean"),
]
_TEXT_PROP = PropertySchema(name="textContent", kind="string")


def discover_catalog(packages: tuple[str, ...] | list[str] = ()) -> ComponentCatalog:
    """Discover names without importing them and schemas only for selected packages."""
    entry_points = tuple(metadata.entry_points(group="spaday.component_packages"))
    available = sorted(entry_point.name for entry_point in entry_points if entry_point.name != "studio")
    components: list[ComponentSchema] = _html_components()
    selected: list[str] = []

    for reference in packages:
        if ":" in reference:
            module_name, _, attribute = reference.partition(":")
            module = import_module(module_name)
            descriptor = getattr(module, attribute)
            package_name = descriptor.name
        else:
            matches = [entry_point for entry_point in entry_points if entry_point.name == reference]
            if len(matches) != 1:
                raise ValueError(f"component package {reference!r} does not have exactly one installed entry point")
            package_name = reference
            module = import_module(matches[0].module)
        selected.append(package_name)
        components.extend(_module_components(package_name, module))

    components.sort(key=lambda component: (component.package, component.tag))
    return ComponentCatalog(
        available_packages=available,
        selected_packages=selected,
        components=components,
    )


def _module_components(package: str, module: types.ModuleType) -> list[ComponentSchema]:
    schemas: list[ComponentSchema] = []
    seen: set[str] = set()
    for name in getattr(module, "__all__", ()):
        value = getattr(module, name, None)
        if not isinstance(value, type) or not issubclass(value, Component) or value is Component or not value.tag or value.tag in seen:
            continue
        seen.add(value.tag)
        schemas.append(_class_schema(package, name, value))
    return schemas


def _class_schema(package: str, name: str, component_class: type[Component]) -> ComponentSchema:
    signature = inspect.signature(component_class.__init__)
    try:
        hints = get_type_hints(component_class.__init__)
    except (NameError, TypeError):
        hints = {}
    props: dict[str, PropertySchema] = {prop.name: _copy_prop(prop) for prop in _COMMON_PROPS}
    for parameter in signature.parameters.values():
        if parameter.name in {"self", "children", "key", "props"} or parameter.kind not in {
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
            inspect.Parameter.KEYWORD_ONLY,
        }:
            continue
        wire_name = _wire_name(component_class, parameter.name)
        props[wire_name] = _property_schema(wire_name, hints.get(parameter.name, parameter.annotation))
    summary = inspect.cleandoc(component_class.__doc__) if component_class.__doc__ else None
    ordered_props = list(props.values())
    ordered_props.sort(key=lambda prop: prop.name)
    return ComponentSchema(
        package=package,
        tag=component_class.tag,
        class_name=name,
        summary=summary.splitlines()[0] if summary else None,
        props=ordered_props,
    )


def _wire_name(component_class: type[Component], parameter: str) -> str:
    sentinel = f"__spaday_studio_{parameter}__"
    try:
        props = cast(Any, component_class)(**{parameter: sentinel}).to_node().get("props", {})
    except (TypeError, ValueError):
        return parameter.removesuffix("_")
    tagged = {"Str": sentinel}
    return next((name for name, value in props.items() if value == tagged), parameter.removesuffix("_"))


def _property_schema(name: str, annotation: object) -> PropertySchema:
    args = tuple(argument for argument in get_args(annotation) if argument is not type(None))
    if len(args) == 1:
        annotation = args[0]
    if get_origin(annotation) is Literal:
        return PropertySchema(name=name, kind="enum", choices=list(get_args(annotation)))
    if annotation is str:
        return PropertySchema(name=name, kind="string")
    if annotation is bool:
        return PropertySchema(name=name, kind="boolean")
    if annotation in {int, float}:
        return PropertySchema(name=name, kind="number")
    return PropertySchema(name=name, kind="json")


def _html_components() -> list[ComponentSchema]:
    text_tags = ("a", "button", "h1", "h2", "h3", "label", "p", "span", "strong")
    container_tags = ("article", "aside", "div", "footer", "header", "main", "nav", "section")
    components: list[ComponentSchema] = [_html_schema(tag, [_TEXT_PROP]) for tag in text_tags]
    components.extend(_html_schema(tag) for tag in container_tags)
    components.extend(
        (
            _html_schema(
                "button",
                [
                    _TEXT_PROP,
                    PropertySchema(name="disabled", kind="boolean"),
                    PropertySchema(name="type", kind="enum", choices=["button", "submit", "reset"]),
                ],
            ),
            _html_schema(
                "input",
                [
                    PropertySchema(name="checked", kind="boolean"),
                    PropertySchema(name="disabled", kind="boolean"),
                    PropertySchema(name="type", kind="string"),
                    PropertySchema(name="value", kind="string"),
                ],
            ),
        )
    )
    unique = {component.tag: component for component in components}
    return list(unique.values())


def _html_schema(tag: str, props: list[PropertySchema] | None = None) -> ComponentSchema:
    combined: dict[str, PropertySchema] = {prop.name: _copy_prop(prop) for prop in _COMMON_PROPS}
    combined.update({prop.name: _copy_prop(prop) for prop in props or ()})
    ordered_props = list(combined.values())
    ordered_props.sort(key=lambda prop: prop.name)
    return ComponentSchema(
        package="html",
        tag=tag,
        class_name=tag,
        props=ordered_props,
    )


def _copy_prop(prop: PropertySchema) -> PropertySchema:
    return PropertySchema(name=prop.name, kind=prop.kind, choices=list(prop.choices))


__all__ = [
    "ComponentCatalog",
    "ComponentSchema",
    "ComponentSummary",
    "PropertySchema",
    "discover_catalog",
]
