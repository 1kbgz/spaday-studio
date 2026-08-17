# Studio pilot reference

## Document model

`StudioDocument` contains `title` and one `root` `StudioNode`.

`StudioNode` fields are:

| Field   | Type                          | Description                                    |
| ------- | ----------------------------- | ---------------------------------------------- |
| `id`    | `str`                         | Globally unique stable authoring identity.     |
| `tag`   | `str`                         | HTML or registered custom-element tag.         |
| `key`   | `str \| None`                 | Optional sibling reconciliation key.           |
| `props` | `dict[str, JsonValue]`        | Untagged authored property values.             |
| `slots` | `dict[str, list[StudioNode]]` | Ordered children grouped by named spaday slot. |

Compilation adds `data-spaday-studio-id` and uses `id` as the default reconciliation key. Authored
property values are converted to spaday's tagged wire representation by the normal component API.

## Operations

All operation models reject unknown fields.

| Kind         | Required fields                      | Effect                                 |
| ------------ | ------------------------------------ | -------------------------------------- |
| `set_prop`   | `id`, `name`, `value`                | Sets one JSON-compatible property.     |
| `unset_prop` | `id`, `name`                         | Removes one authored property.         |
| `insert`     | `parent_id`, `slot`, `index`, `node` | Inserts a new subtree.                 |
| `move`       | `id`, `parent_id`, `slot`, `index`   | Moves an existing subtree by identity. |
| `remove`     | `id`                                 | Removes a non-root subtree.            |

Operation batches are atomic. Unknown IDs, duplicate IDs, invalid indices, root removal, root movement,
and malformed values reject the complete batch.

## `StudioSession`

```{eval-rst}
.. autoclass:: spaday_studio.StudioSession
   :members:

.. autoclass:: spaday_studio.StudioDocument
   :members:

.. autoclass:: spaday_studio.StudioNode
   :members:

.. autoclass:: spaday_studio.ProjectFile
   :members:

.. autofunction:: spaday_studio.export_python
```

## Project persistence and Python export

`ProjectFile.save()` serializes canonical documents as indented, key-sorted UTF-8 JSON and replaces the
target atomically. `ProjectFile.load()` validates the complete file as a `StudioDocument`.

`export_python()` returns deterministic source containing a `page() -> Component` function. Generated
nodes use stable numbered variables, retain explicit keys and Studio IDs, sort property and slot names,
and preserve child order within each slot. The export contains the canonical document, never an active
preview.

The `spaday-studio --project PATH` option loads `PATH` when present. Otherwise it creates `PATH` from the
initial document. Without `--project`, the session remains in memory.

## HTTP and WebSocket endpoints

| Endpoint                 | Purpose                                                 |
| ------------------------ | ------------------------------------------------------- |
| `GET /`                  | Studio editor shell.                                    |
| `GET /tree.json`         | Current compiled spaday tree.                           |
| `GET /api/project`       | Plain Studio state and transports model ID.             |
| `GET /api/export/python` | Download Python for the canonical revision.             |
| `POST /api/operations`   | Commit a revision-checked operation batch.              |
| `WS /ws`                 | Transports mirror carrying canonical and preview state. |
| `/mcp`                   | MCP Streamable HTTP endpoint.                           |

`POST /api/operations` accepts `expected_revision` and `operations`. A stale revision returns HTTP
409\. Validation failures return HTTP 422.

## MCP surface

The `spaday://project` resource returns current state. Tools are `inspect_component`, `export_python`,
`preview_operations`, `commit_preview`, `discard_preview`, `apply_operations`, and `undo`.

The pilot supports one shared preview. Creating another preview replaces it.
