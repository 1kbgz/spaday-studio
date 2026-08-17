import json

import pytest

from spaday_studio import StudioDocument, StudioNode
from spaday_studio.project import ProjectFile, export_python


def document() -> StudioDocument:
    return StudioDocument(
        title="Saved project",
        root=StudioNode(
            id="root",
            tag="main",
            props={"data": {"z": 2, "a": [True, None]}, "className": "shell"},
            slots={
                "footer": [StudioNode(id="actions", tag="div", key="actions-key")],
                "default": [StudioNode(id="message", tag="p", props={"textContent": "Hello"})],
            },
        ),
    )


def test_project_file_round_trips_validated_json_atomically(tmp_path):
    project = ProjectFile(tmp_path / "nested" / "app.studio.json")

    project.save(document())

    assert project.load() == document()
    assert not list(project.path.parent.glob(".*.tmp"))


def test_python_export_is_deterministic_and_matches_compiled_component():
    source = export_python(document())
    namespace: dict = {}

    exec(compile(source, "generated_app.py", "exec"), namespace)  # noqa: S102

    assert source == export_python(document())
    assert max(map(len, source.splitlines())) <= 120
    assert json.loads(namespace["page"]().to_json()) == json.loads(document().component().to_json())
    assert source.index("node_0.prop('className'") < source.index("node_0.prop('data'")
    assert "node_0.child(node_1)" in source
    assert "node_0.child_in('footer', node_2)" in source


def test_project_file_rejects_non_json_floats(tmp_path):
    invalid = document()
    invalid.root.props["score"] = float("nan")
    project = ProjectFile(tmp_path / "invalid.studio.json")

    with pytest.raises(ValueError, match="Out of range float"):
        project.save(invalid)

    assert not project.path.exists()
