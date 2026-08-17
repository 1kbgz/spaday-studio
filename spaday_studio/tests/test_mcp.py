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
