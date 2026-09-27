from __future__ import annotations

import types
from typing import Any, Literal

from spaday import Component, ComponentSchema as CoreComponentSchema, PropertySchema as CorePropertySchema

from spaday_studio import catalog


class FancyCard(Component):
    tag = "demo-card"

    def __init__(
        self,
        *children,
        key: str | None = None,
        label: str | None = None,
        active: bool | None = None,
        count: float | None = None,
        tone: Literal["neutral", "accent"] | None = None,
        row_patch: Any = None,
        **props,
    ) -> None:
        super().__init__(
            *children,
            key=key,
            props={"label": label, "active": active, "count": count, "tone": tone, "rowPatch": row_patch},
            **props,
        )


class SchemaCard(Component):
    tag = "schema-card"
    schema = CoreComponentSchema(
        tag="schema-card",
        class_name="SchemaCard",
        summary="Schema-backed card.",
        props=(CorePropertySchema(name="label", kind="string"),),
        fields=(CorePropertySchema(name="items", kind="json"),),
        events=("activate",),
        slots=("header", "default"),
    )


def test_module_catalog_infers_typed_and_wire_property_names():
    module = types.ModuleType("demo_components")
    module.__dict__.update(__all__=["FancyCard", "CardAlias"], FancyCard=FancyCard, CardAlias=FancyCard)

    schema = catalog._module_components("demo", module)[0]
    props = {prop.name: prop for prop in schema.props}

    assert schema.tag == "demo-card"
    assert props["label"].kind == "string"
    assert props["active"].kind == "boolean"
    assert props["count"].kind == "number"
    assert props["tone"].choices == ["neutral", "accent"]
    assert props["rowPatch"].kind == "json"
    assert [component.tag for component in catalog._module_components("demo", module)] == ["demo-card"]


def test_unselected_packages_are_listed_without_importing_modules(monkeypatch):
    class EntryPoint:
        name = "demo"
        module = "must_not_import"

    monkeypatch.setattr(catalog.metadata, "entry_points", lambda **_kwargs: [EntryPoint()])
    monkeypatch.setattr(catalog, "import_module", lambda _name: (_ for _ in ()).throw(AssertionError("imported")))

    discovered = catalog.discover_catalog()

    assert discovered.available_packages == ["demo"]
    assert discovered.selected_packages == []
    assert discovered.component("button").package == "html"


def test_selected_package_loads_its_exported_component_schemas(monkeypatch):
    class EntryPoint:
        name = "demo"
        module = "demo_components"

    module = types.ModuleType("demo_components")
    module.__dict__.update(__all__=["FancyCard"], FancyCard=FancyCard)
    monkeypatch.setattr(catalog.metadata, "entry_points", lambda **_kwargs: [EntryPoint()])
    monkeypatch.setattr(catalog, "import_module", lambda name: module if name == "demo_components" else None)

    discovered = catalog.discover_catalog(["demo"])

    assert discovered.selected_packages == ["demo"]
    assert discovered.component("demo-card").package == "demo"


def test_catalog_reuses_core_component_fields_events_and_slots():
    module = types.ModuleType("schema_components")
    module.__dict__.update(__all__=["SchemaCard"], SchemaCard=SchemaCard)

    schema = catalog._module_components("demo", module)[0]

    assert {prop.name for prop in schema.props} >= {"label", "items"}
    assert schema.events == ["activate"]
    assert schema.slots == ["header", "default"]
