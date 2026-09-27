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

The result contains the private draft document, a component-tree patch, its base revision, and a
`preview_id`. The shared browser canvas and canonical revision remain unchanged. Pass the same `actor_id`
and `preview_id` to another `preview_operations` call to append operations. Call `commit_preview` to accept
the draft or `discard_preview` to remove it.

If another client commits first, Studio rebases changes to different fields. Independent appends and
anchor-based placements also rebase while their parent and anchor remain valid. Edits to the same property,
binding, event, state field, or node return a conflict naming the overlapping target. Numeric positions also
conflict after an intervening structural edit because their index is no longer stable.
