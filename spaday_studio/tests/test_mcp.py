import asyncio

from mcp.types import CallToolResult

from spaday_studio.example import document
from spaday_studio.mcp import create_mcp
from spaday_studio.session import StudioSession


def test_mcp_exposes_inspection_and_transactional_edit_tools():
    async def names() -> set[str]:
        tools = await create_mcp(StudioSession(document.model_copy(deep=True))).list_tools()
        return {tool.name for tool in tools}

    assert asyncio.run(names()) == {
        "apply_operations",
        "commit_preview",
        "discard_preview",
        "export_python",
        "get_component_schema",
        "inspect_component",
        "list_components",
        "preview_operations",
        "undo",
    }


def test_mcp_returns_structured_component_content():
    async def inspect() -> dict:
        server = create_mcp(StudioSession(document.model_copy(deep=True)))
        result = await server.call_tool("inspect_component", {"component_id": "headline"})
        assert isinstance(result, CallToolResult)
        assert result.structured_content is not None
        return result.structured_content

    assert asyncio.run(inspect())["id"] == "headline"


def test_mcp_exports_the_canonical_python_source():
    async def exported() -> dict:
        server = create_mcp(StudioSession(document.model_copy(deep=True)))
        result = await server.call_tool("export_python", {})
        assert isinstance(result, CallToolResult)
        assert result.structured_content is not None
        return result.structured_content

    result = asyncio.run(exported())
    assert result["revision"] == 0
    assert "def page() -> Component:" in result["source"]


def test_mcp_exposes_compact_component_lists_and_individual_schemas():
    async def schemas() -> tuple[dict, dict]:
        server = create_mcp(StudioSession(document.model_copy(deep=True)))
        listed = await server.call_tool("list_components", {"package": "html"})
        button = await server.call_tool("get_component_schema", {"tag": "button"})
        assert isinstance(listed, CallToolResult)
        assert isinstance(button, CallToolResult)
        assert listed.structured_content is not None
        assert button.structured_content is not None
        return listed.structured_content, button.structured_content

    listed, button = asyncio.run(schemas())
    assert any(component["tag"] == "button" for component in listed["components"])
    assert button["package"] == "html"
    assert any(prop["name"] == "disabled" and prop["kind"] == "boolean" for prop in button["props"])


def test_mcp_resources_and_mutating_tools_follow_the_draft_lifecycle():
    async def lifecycle() -> None:
        server = create_mcp(StudioSession(document.model_copy(deep=True)))
        assert await server.read_resource("spaday://project")
        assert await server.read_resource("spaday://catalog")

        operation = {"kind": "set_prop", "id": "headline", "name": "textContent", "value": "Draft"}
        preview = await server.call_tool("preview_operations", {"expected_revision": 0, "operations": [operation]})
        preview_id = preview.structured_content["preview_id"]
        updated = await server.call_tool(
            "preview_operations",
            {
                "expected_revision": 0,
                "preview_id": preview_id,
                "operations": [{"kind": "set_prop", "id": "app", "name": "title", "value": "Updated"}],
            },
        )
        assert updated.structured_content["document"]["root"]["props"]["title"] == "Updated"
        committed = await server.call_tool("commit_preview", {"preview_id": preview_id})
        assert committed.structured_content["revision"] == 1

        applied = await server.call_tool(
            "apply_operations",
            {
                "expected_revision": 1,
                "operations": [{"kind": "set_state", "name": "ready", "value": True}],
            },
        )
        assert applied.structured_content["revision"] == 2
        undone = await server.call_tool("undo", {"expected_revision": 2})
        assert undone.structured_content["revision"] == 3

        discarded = await server.call_tool(
            "preview_operations",
            {"expected_revision": 3, "operations": [operation]},
        )
        result = await server.call_tool("discard_preview", {"preview_id": discarded.structured_content["preview_id"]})
        assert result.structured_content["revision"] == 3

    asyncio.run(lifecycle())
