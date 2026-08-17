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


def test_preview_is_visible_but_not_canonical_until_committed():
    studio = session()

    preview = studio.preview(0, EDIT)

    assert studio.state.revision == 0
    assert studio.state.document.root.slots["default"][0].props["textContent"] == "Before"
    assert studio.active_document.root.slots["default"][0].props["textContent"] == "After"
    assert preview["patch"]["ops"]

    result = studio.commit_preview(preview["preview_id"])

    assert result["revision"] == 1
    assert result["preview"] is None
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
