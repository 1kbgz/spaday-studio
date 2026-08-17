# AGENTS.md — spaday-studio

## Project

spaday-studio is the AI-native visual development peer package for spaday. It owns structured project
documents, semantic edit operations, editor UI, MCP tools, and source adapters. Spaday core continues to
own component serialization, keyed diffing, DOM patching, actions, and generic hosting.

Current package version: `0.1.0`.

## Architecture

- `spaday_studio/models.py` defines editable nodes, documents, and discriminated edit operations.
- `spaday_studio/session.py` owns canonical revisions, one pilot preview, commit/discard, and undo.
- `spaday_studio/mcp.py` exposes inspection and transactional edits through MCP.
- `spaday_studio/server.py` mounts the canvas, transports mirror, operation endpoint, and MCP server.
- `spaday_studio/example.py` is the runnable pilot document.
- `js/src/ts/index.ts` compiles documents to spaday nodes, patches the real canvas, and drives selection
  and the inspector.
- `docs/src/` follows Diátaxis: tutorial, task guide, reference, and bounded architecture explanation.

## Invariants

- Editor IDs are globally stable authoring identities. They are not reconciliation keys, even when the
  pilot uses the ID as a default key during compilation.
- Every canonical edit carries an expected revision and is validated atomically before mutation.
- MCP changes preview before commit by default. Preview must never trigger arbitrary application side
  effects.
- Canvas updates use spaday's tree diff and `applyPatch`; do not replace the canvas wholesale.
- Browser, MCP, and Python use the same structured document and operation vocabulary.
- Large runtime datasets do not belong in the project document or model context.
- Behavior remains serializable. Do not add `eval` or generated inline JavaScript.
- Installing Studio must not load its assets into unrelated spaday applications.
- Generated browser assets under `spaday_studio/extension` are ignored build products.
- Do not increment versions unless explicitly requested.

## Development

```bash
make develop
make build
make lint
make checks
make test
```

Run the pilot with `spaday-studio` and open <http://127.0.0.1:8020>. Browser behavior needs Playwright
coverage; document/revision behavior needs focused pytest coverage.
