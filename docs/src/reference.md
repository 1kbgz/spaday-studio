# Studio pilot reference

## Document model

`StudioDocument` contains `title`, initial runtime `state`, and one `root` `StudioNode`.

`StudioNode` fields are:

| Field      | Type                              | Description                                    |
| ---------- | --------------------------------- | ---------------------------------------------- |
| `id`       | `str`                             | Globally unique stable authoring identity.     |
| `tag`      | `str`                             | HTML or registered custom-element tag.         |
| `key`      | `str \| None`                     | Optional sibling reconciliation key.           |
| `props`    | `dict[str, JsonValue]`            | Untagged authored property values.             |
| `bindings` | `dict[str, dict[str, JsonValue]]` | Core-validated Spaday bindings by target prop. |
| `events`   | `dict[str, dict[str, JsonValue]]` | Core-validated Spaday actions by event name.   |
| `slots`    | `dict[str, list[StudioNode]]`     | Ordered children grouped by named Spaday slot. |

Compilation adds `data-spaday-studio-id` and uses `id` as the default reconciliation key. Authored
property values are converted to spaday's tagged wire representation by the normal component API.

## Operations

All operation models reject unknown fields.

| Kind            | Required fields             | Effect                                    |
| --------------- | --------------------------- | ----------------------------------------- |
| `set_prop`      | `id`, `name`, `value`       | Sets one JSON-compatible property.        |
| `unset_prop`    | `id`, `name`                | Removes one authored property.            |
| `set_binding`   | `id`, `name`, `binding`     | Sets one core-validated reactive binding. |
| `unset_binding` | `id`, `name`                | Removes one reactive binding.             |
| `set_event`     | `id`, `name`, `action`      | Sets one core-validated event action.     |
| `unset_event`   | `id`, `name`                | Removes one event action.                 |
| `set_state`     | `name`, `value`             | Sets one initial Store field.             |
| `unset_state`   | `name`                      | Removes one initial Store field.          |
| `insert`        | `parent_id`, `slot`, `node` | Inserts a new subtree.                    |
| `move`          | `id`, `parent_id`, `slot`   | Moves an existing subtree by identity.    |
| `remove`        | `id`                        | Removes a non-root subtree.               |

`insert` and `move` accept one optional position: `index`, `before_id`, or `after_id`. No position
appends to the destination slot. Anchors refer to stable Studio IDs and behave better than indices when
other edits change the collection.

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

`export_python()` returns deterministic source containing `INITIAL_STATE` and a `page() -> Component`
function. Generated nodes use stable numbered variables, retain explicit keys and Studio IDs, emit
validated `bind_wire` and `on_wire` calls, sort property and slot names, and preserve child order within
each slot. The export contains the canonical document, never a private draft.

The `spaday-studio --project PATH` option loads `PATH` when present. Otherwise it creates `PATH` from the
initial document. Without `--project`, the session remains in memory.

## Component catalogs

`ComponentCatalog` contains `available_packages`, `selected_packages`, and `components`.
`available_packages` is read from `spaday.component_packages` entry-point metadata without importing the
packages. `selected_packages` contains packages passed through `--package` or `create_app(packages=...)`.
The package reference `"*"` selects every available package; quote it when passing it through a shell.
Only selected entry-point modules are imported and only their assets are mounted.

Each `ComponentSchema` contains `package`, `tag`, `class_name`, optional `summary`, ordered `props`,
`events`, and `slots`. Studio uses a component's core `Component.schema` when present, including property-
only fields. Signature inspection remains the fallback for hand-authored components without a core schema.
It maps Python constructor parameters to their emitted wire property names and classifies annotations as:

| Kind      | Python annotation                        | Editor control      |
| --------- | ---------------------------------------- | ------------------- |
| `string`  | `str`                                    | Text input or area. |
| `boolean` | `bool`                                   | Tri-state selector. |
| `number`  | `int` or `float`                         | Number input.       |
| `enum`    | `Literal[...]`                           | Choice selector.    |
| `json`    | `Any` or another structured/unknown type | JSON text area.     |

Built-in HTML schemas are always present. Common properties are `id`, `class`, `style`, `title`, and
`hidden`; leaf text elements also expose `textContent`.

```{eval-rst}
.. autoclass:: spaday_studio.ComponentCatalog
   :members:

.. autoclass:: spaday_studio.ComponentSchema
   :members:

.. autoclass:: spaday_studio.PropertySchema
   :members:

.. autofunction:: spaday_studio.discover_catalog
```

## HTTP and WebSocket endpoints

| Endpoint                        | Purpose                                            |
| ------------------------------- | -------------------------------------------------- |
| `GET /`                         | Studio editor shell.                               |
| `GET /tree.json`                | Current compiled Spaday tree.                      |
| `GET /api/project`              | Canonical Studio state and transports model ID.    |
| `GET /api/export/python`        | Download Python for the canonical revision.        |
| `GET /api/catalog`              | Selected schemas and installed package names.      |
| `GET /api/schema/behavior`      | Core action, expression, and binding JSON Schemas. |
| `POST /api/operations`          | Commit a revision-checked batch directly.          |
| `POST /api/drafts`              | Create or append to an actor's private draft.      |
| `POST /api/drafts/{id}/commit`  | Commit and, when safe, rebase a private draft.     |
| `POST /api/drafts/{id}/discard` | Discard a private draft.                           |
| `WS /ws`                        | Transports mirror carrying canonical state.        |
| `WS /ws/buffers/{actor_id}`     | CRDT text buffers and cursor awareness.            |
| `/mcp`                          | MCP Streamable HTTP endpoint.                      |

`POST /api/operations` accepts `expected_revision` and `operations`. A stale revision returns HTTP
409\. Validation failures return HTTP 422.

## MCP surface

The `spaday://project` resource returns current state. `spaday://catalog` returns installed/selected
package names and compact component summaries. Catalog tools are `list_components` and
`get_component_schema`. Editing tools are `inspect_component`, `export_python`, `preview_operations`,
`commit_preview`, `discard_preview`, `apply_operations`, and `undo`.

Draft tools accept an `actor_id`. An actor can append to its draft by passing the returned `preview_id` to
`preview_operations`. Other actors cannot inspect, commit, or discard that draft. Disjoint stale drafts
rebase over accepted revisions; overlapping operations return a conflict naming the target.
