import pytest

from spaday_studio import PreviewConflict, RevisionConflict, StudioDocument, StudioNode, StudioSession


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
