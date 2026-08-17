# Why Studio edits a structured document

Spaday applications are authored in Python, but the browser ultimately receives a serializable component
tree. That tree is a stronger editing boundary than the DOM: it retains component tags, named slots,
bindings, actions, ordinary property values, and stable keyed identity without exposing browser-internal
state.

Studio places a structured project document one level above that wire tree. Properties remain ordinary
JSON values, and every component gains a globally stable authoring ID. Semantic operations can therefore
refer to a component without depending on its current DOM path or confusing authoring identity with a key
that is only meaningful among siblings.

This boundary also constrains an agent. Instead of producing arbitrary JavaScript or replacing HTML, the
agent proposes a small validated operation batch against an expected revision. Studio compiles the draft,
spaday computes its normal tree diff, and the browser applies that diff to the real application. Unaffected
custom elements keep their identity and live state.

The structured document does not claim to represent every possible Python program. Loops, data-dependent
factories, side effects, and arbitrary callables cannot be reconstructed reliably from visual changes.
Starting with a document makes preview, validation, undo, collaboration, and deterministic export tractable.
A later source adapter can support recognized constructor expressions or editor-owned source regions while
leaving unrestricted Python components as opaque extension points.

The persisted JSON document is therefore the editable source of truth. Python export is deliberately
one-way: it produces normal, readable spaday authoring code for deployment or further manual work without
pretending Studio can reconstruct the structured document after arbitrary Python edits. This keeps file
saves lossless for Studio while making its output useful outside Studio.

Transports connects the ownership layers. Python holds the authoritative state, browser canvases mirror its
revisions, and MCP clients use the same session. Runtime datasets stay outside the document so a large table
or fast chart feed does not become editor state or model context. Pyodide can eventually host the same
compiler and session in a worker for zero-install previews, while filesystem and git workflows remain on a
server.
