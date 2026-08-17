from starlette.testclient import TestClient

from spaday_studio.models import find_node
from spaday_studio.project import ProjectFile
from spaday_studio.server import create_app


def test_server_hosts_canvas_tree_api_and_mcp():
    app = create_app()

    with TestClient(app) as client:
        assert client.get("/").status_code == 200
        assert client.get("/tree.json").status_code == 200
        project = client.get("/api/project")

    assert project.status_code == 200
    assert project.json()["revision"] == 0
    assert project.json()["document"]["root"]["id"] == "app"


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
