import sys
import types

import spaday.packages
from spaday import Component, ComponentPackage
from starlette.testclient import TestClient

from spaday_studio import catalog
from spaday_studio.models import find_node
from spaday_studio.project import ProjectFile
from spaday_studio.server import create_app


class DemoButton(Component):
    tag = "demo-button"

    def __init__(self, *children, key: str | None = None, disabled: bool | None = None, **props) -> None:
        super().__init__(*children, key=key, props={"disabled": disabled}, **props)


def test_server_hosts_canvas_tree_api_and_mcp():
    app = create_app()

    with TestClient(app) as client:
        assert client.get("/").status_code == 200
        assert client.get("/tree.json").status_code == 200
        project = client.get("/api/project")
        catalog = client.get("/api/catalog")

    assert project.status_code == 200
    assert project.json()["revision"] == 0
    assert project.json()["document"]["root"]["id"] == "app"
    assert any(component["tag"] == "button" for component in catalog.json()["components"])


def test_browser_operation_endpoint_is_revision_checked():
    app = create_app()
    operation = {"kind": "set_prop", "id": "headline", "name": "textContent", "value": "Edited live"}

    with TestClient(app) as client:
        accepted = client.post("/api/operations", json={"expected_revision": 0, "operations": [operation]})
        stale = client.post("/api/operations", json={"expected_revision": 0, "operations": [operation]})

    assert accepted.status_code == 200
    assert accepted.json()["revision"] == 1
    assert stale.status_code == 409


def test_server_persists_canonical_edits_and_exports_python(tmp_path):
    project_path = tmp_path / "app.studio.json"
    app = create_app(project_path=project_path)
    operation = {"kind": "set_prop", "id": "headline", "name": "textContent", "value": "Persisted"}

    with TestClient(app) as client:
        accepted = client.post("/api/operations", json={"expected_revision": 0, "operations": [operation]})
        exported = client.get("/api/export/python")

    assert accepted.status_code == 200
    assert "def page() -> Component:" in exported.text
    assert "'Persisted'" in exported.text
    assert exported.headers["content-disposition"] == 'attachment; filename="spaday_app.py"'
    assert find_node(ProjectFile(project_path).load().root, "headline").props["textContent"] == "Persisted"

    reloaded = create_app(project_path=project_path)
    assert find_node(reloaded.state.studio.state.document.root, "headline").props["textContent"] == "Persisted"


def test_server_loads_catalogs_and_assets_only_for_selected_packages(tmp_path, monkeypatch):
    assets = tmp_path / "extension"
    assets.mkdir()
    (assets / "index.js").write_text("customElements.define('demo-button', class extends HTMLElement {})")
    module = types.ModuleType("demo_studio_package")
    module.__dict__.update(
        __all__=["DemoButton", "package"],
        DemoButton=DemoButton,
        package=ComponentPackage(name="demo", assets_dir=assets, assets=(("js", "index.js"),)),
    )
    monkeypatch.setitem(sys.modules, "demo_studio_package", module)

    app = create_app(packages=["demo_studio_package:package"])
    with TestClient(app) as client:
        discovered = client.get("/api/catalog").json()
        asset = client.get("/components/demo/index.js")
        homepage = client.get("/")

    assert discovered["selected_packages"] == ["demo"]
    demo = next(component for component in discovered["components"] if component["tag"] == "demo-button")
    assert next(prop for prop in demo["props"] if prop["name"] == "disabled") == {
        "name": "disabled",
        "kind": "boolean",
        "choices": [],
    }
    assert asset.status_code == 200
    assert '<script type="module" src="/components/demo/index.js"></script>' in homepage.text


def test_server_wildcard_selects_all_available_packages(tmp_path, monkeypatch):
    assets = tmp_path / "extension"
    assets.mkdir()
    (assets / "index.js").write_text("customElements.define('demo-button', class extends HTMLElement {})")
    module = types.ModuleType("demo_studio_package")
    module.__dict__.update(
        __all__=["DemoButton", "package"],
        DemoButton=DemoButton,
        package=ComponentPackage(name="demo", assets_dir=assets, assets=(("js", "index.js"),)),
    )
    monkeypatch.setitem(sys.modules, "demo_studio_package", module)

    class EntryPoint:
        name = "demo"
        module = "demo_studio_package"

        @staticmethod
        def load():
            return module.package

    monkeypatch.setattr(catalog.metadata, "entry_points", lambda **_kwargs: [EntryPoint()])
    monkeypatch.setattr(spaday.packages, "entry_points", lambda **_kwargs: [EntryPoint()])

    app = create_app(packages=["*"])
    with TestClient(app) as client:
        discovered = client.get("/api/catalog").json()
        asset = client.get("/components/demo/index.js")

    assert discovered["available_packages"] == ["demo"]
    assert discovered["selected_packages"] == ["demo"]
    assert any(component["tag"] == "demo-button" for component in discovered["components"])
    assert asset.status_code == 200
