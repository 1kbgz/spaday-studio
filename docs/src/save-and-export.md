# Save and export a Studio project

This guide shows how to keep canonical Studio edits across restarts and export them as ordinary spaday
Python.

## Start with a project file

Pass a project path when starting Studio:

```bash
spaday-studio --project applications/orbit.studio.json
```

Studio loads an existing file or creates its parent directories and seeds a new file from the example
document. Canonical inspector edits, committed previews, and undo results replace this file atomically.
Uncommitted previews are never written.

## Export Python in the browser

Click **Export Python** in the Studio header. The browser downloads `spaday_app.py`, which exports a
`page()` function returning the accepted component tree.

To fetch the same source directly, request:

```bash
curl --fail http://127.0.0.1:8020/api/export/python --output spaday_app.py
```

The MCP `export_python` tool returns the canonical revision and source as structured content.

Treat the JSON project as the editable source and the Python file as generated output. Export again after
later edits instead of modifying generated Python and expecting Studio to import those changes.
