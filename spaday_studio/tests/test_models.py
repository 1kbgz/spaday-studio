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


def test_state_bindings_events_and_named_slot_anchors_compile_through_spaday():
    source = document()
    operations = parse_operations(
        [
            {"kind": "set_state", "name": "query", "value": "hello"},
            {
                "kind": "set_binding",
                "id": "a",
                "name": "textContent",
                "binding": {"field": "query", "mode": "one-way"},
            },
            {
                "kind": "set_event",
                "id": "a",
                "name": "click",
                "action": {"kind": "toggle-field", "field": "open"},
            },
            {
                "kind": "insert",
                "parent_id": "root",
                "slot": "actions",
                "node": {"id": "c", "tag": "button"},
            },
            {
                "kind": "insert",
                "parent_id": "root",
                "before_id": "b",
                "node": {"id": "d", "tag": "span"},
            },
        ]
    )

    edited = apply_operations(source, operations)
    tree = edited.component().to_node()

    assert edited.state == {"query": "hello"}
    assert [node.id for node in edited.root.slots["default"]] == ["a", "d", "b"]
    assert edited.root.slots["actions"][0].id == "c"
    assert tree["slots"]["default"][0]["bindings"]["textContent"]["field"] == "query"
    assert tree["slots"]["default"][0]["events"]["click"]["kind"] == "toggle-field"


@pytest.mark.parametrize(
    "operation",
    [
        {"kind": "set_binding", "id": "a", "name": "value", "binding": {"field": "x", "mode": "sideways"}},
        {"kind": "set_event", "id": "a", "name": "click", "action": {"kind": "unknown"}},
    ],
)
def test_behavior_operations_use_shared_core_validation(operation):
    with pytest.raises((ValidationError, ValueError)):
        parse_operations([operation])


def test_event_options_compile_and_survive_action_edits_until_explicitly_cleared():
    operation = {"kind": "set_event", "id": "a", "name": "click", "action": {"kind": "toggle-field", "field": "open"}}
    options = {"capture": True, "once": True, "passive": False}
    edited = apply_operations(document(), parse_operations([{**operation, "options": options}]))
    node = edited.component().to_node()["slots"]["default"][0]
    assert node["event_options"]["click"] == options

    preserved = apply_operations(edited, parse_operations([operation]))
    assert find_node(preserved.root, "a").event_options == {"click": options}
    cleared = apply_operations(preserved, parse_operations([{**operation, "options": {}}]))
    assert find_node(cleared.root, "a").event_options == {}
    assert "event_options" not in cleared.component().to_node()["slots"]["default"][0]
    removed = apply_operations(edited, parse_operations([{"kind": "unset_event", "id": "a", "name": "click"}]))
    assert find_node(removed.root, "a").event_options == {}
    assert find_node(removed.root, "a").events == {}
    assert find_node(edited.root, "a").event_options == {"click": options}


@pytest.mark.parametrize("options", [{"capture": "false"}, {"once": 1}, {"passive": None}, {"unknown": True}])
def test_event_options_reject_unknown_flags_and_non_booleans(options):
    action = {"kind": "toggle-field", "field": "open"}
    with pytest.raises(ValidationError):
        StudioNode(id="button", tag="button", events={"click": action}, event_options={"click": options})
    with pytest.raises(ValidationError):
        parse_operations([{"kind": "set_event", "id": "a", "name": "click", "action": action, "options": options}])


def test_event_options_require_a_matching_action():
    with pytest.raises(ValidationError, match="matching event action"):
        StudioNode(id="button", tag="button", event_options={"click": {"once": True}})


def test_document_rejects_event_targets_that_are_not_in_the_tree():
    with pytest.raises(ValidationError, match="event 'click' references missing component 'missing'"):
        StudioDocument(
            title="bad",
            root=StudioNode(
                id="root",
                tag="button",
                events={
                    "click": {
                        "kind": "toggle",
                        "target": {"ref": "id", "id": "missing"},
                        "prop": "hidden",
                    }
                },
            ),
        )


def test_unset_operations_remove_authored_behavior_and_state():
    source = document()
    source.root.slots["default"][0].bindings["textContent"] = {"field": "query", "mode": "one-way"}
    source.root.slots["default"][0].events["click"] = {"kind": "toggle-field", "field": "open"}
    source.state = {"query": "hello"}
    operations = parse_operations(
        [
            {"kind": "unset_prop", "id": "a", "name": "textContent"},
            {"kind": "unset_binding", "id": "a", "name": "textContent"},
            {"kind": "unset_event", "id": "a", "name": "click"},
            {"kind": "unset_state", "name": "query"},
        ]
    )

    edited = apply_operations(source, operations)

    assert edited.root.slots["default"][0].props == {}
    assert edited.root.slots["default"][0].bindings == {}
    assert edited.root.slots["default"][0].events == {}
    assert edited.state == {}


def test_document_title_and_node_key_have_semantic_operations():
    edited = apply_operations(
        document(),
        parse_operations(
            [
                {"kind": "set_title", "value": "Renamed"},
                {"kind": "set_key", "id": "a", "value": "stable-a"},
            ]
        ),
    )

    assert edited.title == "Renamed"
    assert edited.root.slots["default"][0].key == "stable-a"

    cleared = apply_operations(edited, parse_operations([{"kind": "unset_key", "id": "a"}]))
    assert cleared.root.slots["default"][0].key is None


@pytest.mark.parametrize(
    ("operation", "message"),
    [
        (
            {"kind": "insert", "parent_id": "root", "index": 0, "before_id": "a", "node": {"id": "c", "tag": "p"}},
            "insert accepts only one",
        ),
        (
            {"kind": "move", "id": "a", "parent_id": "root", "index": 0, "after_id": "b"},
            "move accepts only one",
        ),
        (
            {"kind": "move", "id": "a", "parent_id": "root", "before_id": "a"},
            "relative to itself",
        ),
    ],
)
def test_structural_operations_reject_ambiguous_positions(operation, message):
    with pytest.raises(ValidationError, match=message):
        parse_operations([operation])


@pytest.mark.parametrize(
    ("operation", "error"),
    [
        ({"kind": "remove", "id": "root"}, ValueError),
        ({"kind": "move", "id": "root", "parent_id": "root"}, ValueError),
        ({"kind": "move", "id": "missing", "parent_id": "root"}, KeyError),
        ({"kind": "insert", "parent_id": "root", "index": 9, "node": {"id": "c", "tag": "p"}}, IndexError),
        ({"kind": "insert", "parent_id": "root", "after_id": "missing", "node": {"id": "c", "tag": "p"}}, KeyError),
    ],
)
def test_structural_operations_reject_missing_or_invalid_targets(operation, error):
    with pytest.raises(error):
        apply_operations(document(), parse_operations([operation]))
