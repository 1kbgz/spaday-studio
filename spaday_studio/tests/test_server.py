import sys
import types

import spaday.packages
import transports
from spaday import Component, ComponentPackage
from starlette.testclient import TestClient

from spaday_studio import catalog
from spaday_studio.access import StudioAccessContext
from spaday_studio.models import StudioDocument, find_node
from spaday_studio.project import ProjectFile
from spaday_studio.server import _prune_buffer_revisions, create_app


class DemoButton(Component):
    tag = "demo-button"

    def __init__(self, *children, key: str | None = None, disabled: bool | None = None, **props) -> None:
        super().__init__(*children, key=key, props={"disabled": disabled}, **props)


def test_buffer_cleanup_keeps_current_and_active_draft_revisions():
    hub = transports.Hub(key=lambda connection: connection)
    model_id = hub.share(
        {},
        crdt_spec=transports.CrdtSpec({"kind": "map", "values": {"kind": "sequence", "materialization": "string"}}),
    )
    hub.mutate_shared_crdt(
        model_id,
        [
            {"kind": "map_set", "path": [], "key": "0:root:bindings", "value": "{}"},
            {"kind": "map_set", "path": [], "key": "1:root:events", "value": "{}"},
            {"kind": "map_set", "path": [], "key": "2:state", "value": "{}"},
        ],
    )

    removed = _prune_buffer_revisions(hub, model_id, current_revision=2, active_revisions={1})
    buffers = transports.from_value(hub.snapshot_shared(model_id)["value"], dict)

    assert removed == ["0:root:bindings"]
    assert set(buffers) == {"1:root:events", "2:state"}


def test_server_hosts_canvas_tree_api_and_mcp():
    app = create_app()

    with TestClient(app) as client:
        assert client.get("/").status_code == 200
        assert client.get("/tree.json").status_code == 200
        project = client.get("/api/project")
        catalog = client.get("/api/catalog")
        document_schema = client.get("/api/schema/document")
        single_operation_schema = client.get("/api/schema/operation")
        batch_operation_schema = client.get("/api/schema/operations")

    assert project.status_code == 200
    assert project.json()["revision"] == 0
    assert project.json()["document"]["root"]["id"] == "app"
    assert any(component["tag"] == "button" for component in catalog.json()["components"])
    assert document_schema.json()["title"] == "StudioDocument"
    assert "oneOf" in single_operation_schema.json()
    assert batch_operation_schema.json()["type"] == "array"
    assert {variant["$ref"].rsplit("/", 1)[-1] for variant in batch_operation_schema.json()["items"]["oneOf"]} >= {
        "SetTitle",
        "SetKey",
        "InsertNode",
    }


def test_browser_operation_endpoint_is_revision_checked():
    app = create_app()
    operation = {"kind": "set_prop", "id": "headline", "name": "textContent", "value": "Edited live"}

    with TestClient(app) as client:
        accepted = client.post("/api/operations", json={"expected_revision": 0, "operations": [operation]})
        stale = client.post("/api/operations", json={"expected_revision": 0, "operations": [operation]})

    assert accepted.status_code == 200
    assert accepted.json()["revision"] == 1
    assert stale.status_code == 409


def test_history_endpoints_undo_and_redo_an_actors_commit():
    app = create_app()
    operation = {"kind": "set_prop", "id": "headline", "name": "textContent", "value": "Edited live"}

    with TestClient(app) as client:
        client.post("/api/operations", json={"expected_revision": 0, "actor_id": "alice", "operations": [operation]})
        available = client.get("/api/history", params={"actor_id": "alice"})
        undone = client.post("/api/history/undo", json={"expected_revision": 1, "actor_id": "alice"})
        after_undo = client.get("/api/history", params={"actor_id": "alice"})
        redone = client.post("/api/history/redo", json={"expected_revision": 2, "actor_id": "alice"})

    assert available.json() == {"can_undo": True, "can_redo": False}
    assert find_node(StudioDocument.model_validate(undone.json()["document"]).root, "headline").props["textContent"] != "Edited live"
    assert after_undo.json() == {"can_undo": False, "can_redo": True}
    assert find_node(StudioDocument.model_validate(redone.json()["document"]).root, "headline").props["textContent"] == "Edited live"


def test_host_authorizer_enforces_read_edit_and_admin_roles():
    roles = {"reader": "read", "editor": "edit", "administrator": "admin"}

    def authorize(context: StudioAccessContext, actor_id: str):
        assert context.scope in {"http", "websocket", "mcp"}
        return roles.get(actor_id, "read")

    app = create_app(authorize=authorize)
    operation = {"kind": "set_prop", "id": "headline", "name": "textContent", "value": "Authorized"}
    with TestClient(app) as client:
        reader = client.get("/api/access", params={"actor_id": "reader"})
        denied_draft = client.post(
            "/api/drafts",
            json={"expected_revision": 0, "actor_id": "reader", "operations": [operation]},
        )
        editor_draft = client.post(
            "/api/drafts",
            json={"expected_revision": 0, "actor_id": "editor", "operations": [operation]},
        )
        denied_direct = client.post(
            "/api/operations",
            json={"expected_revision": 0, "actor_id": "editor", "operations": [operation]},
        )
        administrator = client.post(
            "/api/operations",
            json={"expected_revision": 0, "actor_id": "administrator", "operations": [operation]},
        )

    assert reader.json() == {"actor_id": "reader", "role": "read"}
    assert denied_draft.status_code == 403
    assert editor_draft.status_code == 200
    assert denied_direct.status_code == 403
    assert administrator.status_code == 200


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

    assert discovered["selected_packages"] == ["codemirror", "demo"]
    demo = next(component for component in discovered["components"] if component["tag"] == "demo-button")
    assert next(prop for prop in demo["props"] if prop["name"] == "disabled") == {
        "name": "disabled",
        "kind": "boolean",
        "choices": [],
    }
    assert asset.status_code == 200
    assert '<script type="module" src="/components/codemirror/cdn/index.js"></script>' in homepage.text
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
    assert discovered["selected_packages"] == ["codemirror", "demo"]
    assert any(component["tag"] == "demo-button" for component in discovered["components"])
    assert asset.status_code == 200


def test_private_draft_endpoints_validate_preview_and_commit():
    app = create_app()
    operation = {"kind": "set_prop", "id": "headline", "name": "textContent", "value": "Private"}

    with TestClient(app) as client:
        preview = client.post(
            "/api/drafts",
            json={"expected_revision": 0, "actor_id": "browser-a", "operations": [operation]},
        )
        canonical = client.get("/api/project")
        committed = client.post(
            f"/api/drafts/{preview.json()['preview_id']}/commit",
            json={"actor_id": "browser-a"},
        )
        schemas = client.get("/api/schema/behavior")

    assert preview.status_code == 200
    assert preview.json()["document"]["root"]["slots"]["default"][1]["props"]["textContent"] == "Private"
    assert canonical.json()["revision"] == 0
    assert committed.json()["revision"] == 1
    assert set(schemas.json()) == {"action", "binding", "expr"}


def test_private_draft_update_discard_and_error_endpoints():
    app = create_app()
    operation = {"kind": "set_prop", "id": "headline", "name": "textContent", "value": "Private"}

    with TestClient(app) as client:
        malformed = client.post("/api/operations", json={})
        preview = client.post(
            "/api/drafts",
            json={"expected_revision": 0, "actor_id": "browser-a", "operations": [operation]},
        ).json()
        updated = client.post(
            "/api/drafts",
            json={
                "expected_revision": 0,
                "preview_id": preview["preview_id"],
                "actor_id": "browser-a",
                "operations": [{"kind": "set_state", "name": "ready", "value": True}],
            },
        )
        wrong_owner = client.post(
            f"/api/drafts/{preview['preview_id']}/commit",
            json={"actor_id": "browser-b"},
        )
        discarded = client.post(
            f"/api/drafts/{preview['preview_id']}/discard",
            json={"actor_id": "browser-a"},
        )
        with client.websocket_connect("/ws/buffers/browser-a") as websocket:
            assert websocket.receive_json()["t"] == "crdt_snapshot"

    assert malformed.status_code == 422
    assert updated.status_code == 200
    assert updated.json()["document"]["state"]["ready"] is True
    assert wrong_owner.status_code == 409
    assert discarded.status_code == 200
    assert discarded.json()["revision"] == 0


def test_private_draft_can_be_recovered_by_its_actor():
    app = create_app()
    operation = {"kind": "set_prop", "id": "headline", "name": "textContent", "value": "Recover me"}

    with TestClient(app) as client:
        preview = client.post(
            "/api/drafts",
            json={"expected_revision": 0, "actor_id": "alice", "operations": [operation]},
        ).json()
        recovered = client.get("/api/drafts", params={"actor_id": "alice"})
        missing = client.get("/api/drafts", params={"actor_id": "bob"})

    assert recovered.status_code == 200
    assert recovered.json() == preview
    assert missing.status_code == 204
