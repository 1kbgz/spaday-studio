import pytest
from pydantic import ValidationError

from spaday_studio import StudioDocument, StudioNode
from spaday_studio.models import apply_operations, find_node, parse_operations


def document() -> StudioDocument:
    return StudioDocument(
        title="test",
        root=StudioNode(
            id="root",
            tag="main",
            slots={
                "default": [
                    StudioNode(id="a", tag="p", props={"textContent": "A"}),
                    StudioNode(id="b", tag="p", props={"textContent": "B"}),
                ]
            },
        ),
    )


def test_document_compiles_stable_editor_ids_without_overloading_authored_keys():
    tree = document().component().to_node()

    assert tree["key"] == "root"
    assert tree["props"]["data-spaday-studio-id"] == {"Str": "root"}
    assert tree["slots"]["default"][0]["key"] == "a"


def test_duplicate_editor_ids_are_rejected():
    with pytest.raises(ValidationError, match="duplicate Studio node id 'same'"):
        StudioDocument(
            title="bad",
            root=StudioNode(id="same", tag="main", slots={"default": [StudioNode(id="same", tag="p")]}),
        )


@pytest.mark.parametrize(
    ("node", "message"),
    [
        ({"id": "bad", "tag": "script"}, "tag 'script' is not allowed"),
        ({"id": "bad", "tag": "div", "props": {"innerHTML": "<b>unsafe</b>"}}, "prop 'innerHTML' is not allowed"),
        ({"id": "bad", "tag": "a", "props": {"href": "javascript:alert(1)"}}, "contains an unsafe URL"),
        (
            {
                "id": "bad",
                "tag": "p",
                "props": {"textContent": "text"},
                "slots": {"default": [{"id": "child", "tag": "span"}]},
            },
            "textContent cannot also have child nodes",
        ),
    ],
)
def test_document_rejects_obvious_executable_markup_and_ambiguous_text_nodes(node, message):
    with pytest.raises(ValidationError, match=message):
        StudioNode.model_validate(node)


def test_semantic_operations_set_insert_move_and_remove_nodes():
    operations = parse_operations(
        [
            {"kind": "set_prop", "id": "a", "name": "textContent", "value": "Edited"},
            {"kind": "insert", "parent_id": "root", "index": 2, "node": {"id": "c", "tag": "button", "props": {}, "slots": {}}},
            {"kind": "move", "id": "c", "parent_id": "root", "index": 0},
            {"kind": "remove", "id": "b"},
        ]
    )

    edited = apply_operations(document(), operations)

    assert [node.id for node in edited.root.slots["default"]] == ["c", "a"]
    assert find_node(edited.root, "a").props["textContent"] == "Edited"


def test_failed_batch_does_not_modify_input_document():
    source = document()
    operations = parse_operations(
        [
            {"kind": "set_prop", "id": "a", "name": "textContent", "value": "Edited"},
            {"kind": "remove", "id": "missing"},
        ]
    )

    with pytest.raises(KeyError):
        apply_operations(source, operations)

    assert find_node(source.root, "a").props["textContent"] == "A"
