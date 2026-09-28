import pytest

from spaday_studio import PreviewConflict, RevisionConflict, StudioDocument, StudioNode, StudioSession
from spaday_studio.models import parse_operations
from spaday_studio.session import _conflict_reason


def session() -> StudioSession:
    return StudioSession(
        StudioDocument(
            title="test",
            root=StudioNode(id="root", tag="main", slots={"default": [StudioNode(id="message", tag="p", props={"textContent": "Before"})]}),
        )
    )


EDIT = [{"kind": "set_prop", "id": "message", "name": "textContent", "value": "After"}]


def test_preview_is_private_and_not_canonical_until_committed():
    studio = session()

    preview = studio.preview(0, EDIT)

    assert studio.state.revision == 0
    assert studio.state.document.root.slots["default"][0].props["textContent"] == "Before"
    assert studio.active_document.root.slots["default"][0].props["textContent"] == "Before"
    assert preview["document"]["root"]["slots"]["default"][0]["props"]["textContent"] == "After"
    assert preview["patch"]["ops"]
    assert "preview" not in studio.snapshot()

    result = studio.commit_preview(preview["preview_id"])

    assert result["revision"] == 1
    assert studio.state.document.root.slots["default"][0].props["textContent"] == "After"


def test_discard_preview_restores_canonical_canvas_without_advancing_revision():
    studio = session()
    preview = studio.preview(0, EDIT)

    result = studio.discard_preview(preview["preview_id"])

    assert result["revision"] == 0
    assert studio.active_document.root.slots["default"][0].props["textContent"] == "Before"


def test_stale_edits_and_wrong_preview_ids_are_rejected():
    studio = session()
    preview = studio.preview(0, EDIT)

    with pytest.raises(RevisionConflict):
        studio.apply(1, EDIT)
    with pytest.raises(PreviewConflict):
        studio.commit_preview(preview["preview_id"] + "wrong")


def test_undo_restores_previous_document_as_a_new_revision():
    studio = session()
    studio.apply(0, EDIT)

    result = studio.undo(1)

    assert result["revision"] == 2
    assert studio.state.document.root.slots["default"][0].props["textContent"] == "Before"

    redone = studio.redo(2)
    assert redone["revision"] == 3
    assert studio.state.document.root.slots["default"][0].props["textContent"] == "After"


def test_repeated_undo_does_not_toggle_the_last_document():
    studio = session()
    studio.apply(0, EDIT)
    studio.undo(1)

    with pytest.raises(ValueError, match="no committed edit to undo"):
        studio.undo(2)


def test_new_edit_clears_redo_and_history_is_bounded():
    studio = StudioSession(session().state.document, history_limit=2)
    studio.apply(0, EDIT)
    studio.undo(1)
    studio.apply(2, [{"kind": "set_state", "name": "ready", "value": True}])

    with pytest.raises(ValueError, match="no committed edit to redo"):
        studio.redo(3)

    studio.apply(3, [{"kind": "set_state", "name": "count", "value": 1}])
    studio.apply(4, [{"kind": "set_state", "name": "count", "value": 2}])
    assert len(studio._commits) == 2
    assert len(studio._undo) == 2


def test_history_rejects_invalid_limits_and_another_actors_redo():
    with pytest.raises(ValueError, match="history_limit"):
        StudioSession(session().state.document, history_limit=0)

    studio = session()
    studio.apply(0, EDIT, owner="alice")
    studio.undo(1, owner="alice")
    with pytest.raises(RevisionConflict, match="another editor"):
        studio.redo(2, owner="bob")


def test_draft_rejects_non_operation_history_changes():
    studio = session()
    draft = studio.preview(0, [{"kind": "set_state", "name": "draft", "value": True}], owner="alice")
    studio.apply(0, EDIT, owner="bob")
    studio.undo(1, owner="bob")

    with pytest.raises(PreviewConflict, match="canonical history changed"):
        studio.commit_preview(draft["preview_id"], owner="alice")


def test_draft_rejects_rebase_when_required_history_was_pruned():
    studio = StudioSession(session().state.document, history_limit=1)
    draft = studio.preview(0, [{"kind": "set_state", "name": "draft", "value": True}], owner="alice")
    studio.apply(0, [{"kind": "set_state", "name": "one", "value": 1}], owner="bob")
    studio.apply(1, [{"kind": "set_state", "name": "two", "value": 2}], owner="bob")

    with pytest.raises(PreviewConflict, match="history is no longer retained"):
        studio.commit_preview(draft["preview_id"], owner="alice")


def test_history_reports_only_actions_available_to_the_actor():
    studio = session()
    studio.apply(0, EDIT, owner="alice")

    assert studio.history("alice") == {"can_undo": True, "can_redo": False}
    assert studio.history("bob") == {"can_undo": False, "can_redo": False}
    studio.undo(1, owner="alice")
    assert studio.history("alice") == {"can_undo": False, "can_redo": True}


def test_undo_rejects_an_empty_history_and_another_owners_commit():
    studio = session()
    with pytest.raises(ValueError, match="no committed edit"):
        studio.undo(0)

    studio.apply(0, EDIT, owner="alice")
    with pytest.raises(RevisionConflict, match="another editor"):
        studio.undo(1, owner="bob")


def test_only_canonical_changes_are_persisted():
    saved: list[StudioDocument] = []
    studio = StudioSession(session().state.document, save_document=lambda document: saved.append(document.model_copy(deep=True)))

    preview = studio.preview(0, EDIT)
    assert "'Before'" in studio.python_source()
    studio.discard_preview(preview["preview_id"])
    assert saved == []

    preview = studio.preview(0, EDIT)
    studio.commit_preview(preview["preview_id"])
    studio.undo(1)

    assert [item.root.slots["default"][0].props["textContent"] for item in saved] == ["After", "Before"]


def test_failed_persistence_does_not_change_session_state():
    def fail(_document: StudioDocument) -> None:
        raise OSError("disk full")

    studio = StudioSession(session().state.document, save_document=fail)

    with pytest.raises(OSError, match="disk full"):
        studio.apply(0, EDIT)

    assert studio.state.revision == 0
    assert studio.state.document.root.slots["default"][0].props["textContent"] == "Before"


def test_disjoint_private_drafts_rebase_and_overlapping_drafts_conflict():
    studio = session()
    alice = studio.preview(0, EDIT, owner="alice")
    bob = studio.preview(
        0,
        [{"kind": "set_prop", "id": "root", "name": "title", "value": "Bob"}],
        owner="bob",
    )

    studio.commit_preview(alice["preview_id"], owner="alice")
    result = studio.commit_preview(bob["preview_id"], owner="bob")

    assert result["revision"] == 2
    assert studio.state.document.root.props["title"] == "Bob"
    assert studio.state.document.root.slots["default"][0].props["textContent"] == "After"

    carol = studio.preview(2, EDIT, owner="carol")
    dave = studio.preview(
        2,
        [{"kind": "set_prop", "id": "message", "name": "textContent", "value": "Dave"}],
        owner="dave",
    )
    studio.commit_preview(carol["preview_id"], owner="carol")
    with pytest.raises(PreviewConflict, match="both drafts edit"):
        studio.commit_preview(dave["preview_id"], owner="dave")


def test_concurrent_appends_rebase_but_numeric_placement_and_removed_anchors_conflict():
    studio = session()
    alice = studio.preview(
        0,
        [{"kind": "insert", "parent_id": "root", "node": {"id": "alice", "tag": "p"}}],
        owner="alice",
    )
    bob = studio.preview(
        0,
        [{"kind": "insert", "parent_id": "root", "node": {"id": "bob", "tag": "p"}}],
        owner="bob",
    )

    studio.commit_preview(alice["preview_id"], owner="alice")
    result = studio.commit_preview(bob["preview_id"], owner="bob")

    assert [node["id"] for node in result["document"]["root"]["slots"]["default"]] == ["message", "alice", "bob"]

    carol = studio.preview(
        2,
        [{"kind": "insert", "parent_id": "root", "index": 0, "node": {"id": "carol", "tag": "p"}}],
        owner="carol",
    )
    dave = studio.preview(
        2,
        [{"kind": "insert", "parent_id": "root", "index": 0, "node": {"id": "dave", "tag": "p"}}],
        owner="dave",
    )
    studio.commit_preview(carol["preview_id"], owner="carol")
    with pytest.raises(PreviewConflict, match="numeric placement is stale"):
        studio.commit_preview(dave["preview_id"], owner="dave")

    erin = studio.preview(
        3,
        [{"kind": "insert", "parent_id": "root", "after_id": "message", "node": {"id": "erin", "tag": "p"}}],
        owner="erin",
    )
    frank = studio.preview(3, [{"kind": "remove", "id": "message"}], owner="frank")
    studio.commit_preview(frank["preview_id"], owner="frank")
    with pytest.raises(PreviewConflict, match="placement anchor 'message' moved or was removed"):
        studio.commit_preview(erin["preview_id"], owner="erin")


def test_draft_owner_is_enforced_and_updates_append_to_private_document():
    studio = session()
    preview = studio.preview(0, EDIT, owner="alice")

    updated = studio.update_preview(
        preview["preview_id"],
        [{"kind": "set_prop", "id": "root", "name": "title", "value": "Draft"}],
        owner="alice",
    )

    assert updated["document"]["root"]["props"]["title"] == "Draft"
    with pytest.raises(PreviewConflict, match="another editor"):
        studio.discard_preview(preview["preview_id"], owner="bob")


def test_new_preview_replaces_the_same_owners_previous_draft():
    studio = session()
    first = studio.preview(0, EDIT, owner="alice")
    second = studio.preview(0, [{"kind": "set_state", "name": "ready", "value": True}], owner="alice")

    with pytest.raises(PreviewConflict, match="draft is missing"):
        studio.discard_preview(first["preview_id"], owner="alice")
    assert studio.discard_preview(second["preview_id"], owner="alice")["revision"] == 0


def test_actor_can_recover_its_active_private_draft():
    studio = session()
    preview = studio.preview(0, EDIT, owner="alice")

    assert studio.preview_for("alice") == preview
    assert studio.preview_for("bob") is None


@pytest.mark.parametrize(
    ("draft", "accepted", "message"),
    [
        (
            [{"kind": "set_title", "value": "Draft"}],
            [{"kind": "set_title", "value": "Accepted"}],
            "both drafts edit",
        ),
        (
            [{"kind": "set_key", "id": "message", "value": "draft"}],
            [{"kind": "unset_key", "id": "message"}],
            "both drafts edit",
        ),
        (
            [{"kind": "move", "id": "message", "parent_id": "root", "index": 0}],
            [{"kind": "move", "id": "message", "parent_id": "root"}],
            "both drafts move or remove node 'message'",
        ),
        (
            [{"kind": "set_prop", "id": "message", "name": "title", "value": "draft"}],
            [{"kind": "remove", "id": "message"}],
            "target node 'message' was removed",
        ),
        (
            [{"kind": "remove", "id": "message"}],
            [{"kind": "set_prop", "id": "message", "name": "title", "value": "accepted"}],
            "draft removes edited node 'message'",
        ),
        (
            [{"kind": "move", "id": "message", "parent_id": "root"}],
            [{"kind": "move", "id": "message", "parent_id": "root"}],
            "both drafts move or remove node 'message'",
        ),
        (
            [{"kind": "insert", "parent_id": "root", "index": 0, "node": {"id": "draft", "tag": "p"}}],
            [{"kind": "remove", "id": "message"}],
            "numeric placement is stale after a node was removed",
        ),
        (
            [{"kind": "insert", "parent_id": "root", "node": {"id": "same", "tag": "p"}}],
            [{"kind": "insert", "parent_id": "root", "node": {"id": "same", "tag": "p"}}],
            "both drafts insert node 'same'",
        ),
        (
            [{"kind": "set_binding", "id": "message", "name": "textContent", "binding": {"field": "a", "mode": "one-way"}}],
            [{"kind": "unset_binding", "id": "message", "name": "textContent"}],
            "both drafts edit",
        ),
        (
            [{"kind": "set_event", "id": "message", "name": "click", "action": {"kind": "toggle-field", "field": "a"}}],
            [{"kind": "unset_event", "id": "message", "name": "click"}],
            "both drafts edit",
        ),
        (
            [{"kind": "set_state", "name": "ready", "value": True}],
            [{"kind": "unset_state", "name": "ready"}],
            "both drafts edit",
        ),
    ],
)
def test_conflict_reasons_cover_semantic_and_structural_overlap(draft, accepted, message):
    assert message in _conflict_reason(parse_operations(draft), parse_operations(accepted))
