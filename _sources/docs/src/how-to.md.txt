# How to preview an edit through MCP

This guide shows how to connect an MCP client to Studio and stage an edit before making it canonical.

Start the built pilot:

```bash
spaday-studio
```

Connect the MCP Inspector to `http://127.0.0.1:8020/mcp`:

```bash
npx -y @modelcontextprotocol/inspector
```

Read the `spaday://project` resource and note its `revision`. Call `inspect_component` with
`component_id="headline"` to retrieve only the selected component.

Call `preview_operations` with the current revision and this operation:

```json
{
  "expected_revision": 0,
  "operations": [
    {
      "kind": "set_prop",
      "id": "headline",
      "name": "textContent",
      "value": "Previewed by an MCP client"
    }
  ]
}
```

The browser changes immediately and shows `Preview draft`, while its canonical revision remains
unchanged. Copy the returned `preview_id` and call `commit_preview` to accept it. Call
`discard_preview` instead to restore the canonical canvas without advancing its revision.

If another canonical edit changes the revision first, create a new preview against the new revision.
Studio rejects stale expected revisions rather than silently overwriting them.
