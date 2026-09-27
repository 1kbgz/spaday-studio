# Edit a live spaday application

In this tutorial, we will run the Studio pilot, select a component, and change it without reloading the
application canvas.

## Install the development environment

From the repository root, run:

```bash
make develop
make build
```

The build creates the Studio browser bundle inside the Python package.

## Start Studio

Run:

```bash
spaday-studio --project orbit.studio.json
```

Open <http://127.0.0.1:8020>. You should see a component tree on the left, an operations dashboard in
the center, and an inspector on the right. The header should show `Revision 0` and `Canonical`.
Studio creates `orbit.studio.json` from the example document.

## Select and edit the headline

Click the large headline in the canvas. The inspector should identify `h1 · headline`.

Replace its text with:

```text
Ship the interface while it is running.
```

Click **Preview changes**. The headline changes, but the header still shows `Revision 0` and marks the
canvas as a private draft. Click **Commit**. The header changes to `Revision 1`; unaffected canvas elements
keep their DOM identity throughout both updates.

## Make a structural edit

Select `main · app` at the top of the component tree. Choose `p · <p>` under the `html` catalog and click
**Add component**. Choose the destination slot when the selected component exposes named slots. A new
paragraph appears at the bottom of the draft canvas. Click **Commit** to advance the revision.

Select the new paragraph and click **Move up** or **Remove**. You can stack several operations in the same
private draft before committing it. Each accepted document arrives as a new authoritative transports
revision and is reconciled through Spaday's keyed tree patch.

## Add runtime behavior

Select a component and expand **Bindings** or **Events**. These are JSON editors backed by transports'
character-level sequence CRDT. Another Studio tab on the same revision sees edits and cursor positions as
they happen. Invalid intermediate JSON stays in the buffer and cannot enter the project document.

Use **Runtime state** for the initial Store fields referenced by bindings and actions. **Preview state**
validates the JSON and stages semantic `set_state` and `unset_state` operations. The canvas keeps one Store
instance while the tree changes, so two-way bindings and actions can update it normally.

## Export the accepted application

Click **Export Python** in the header. The downloaded `spaday_app.py` contains a standard spaday
`page()` function for the current canonical revision. Your edits also remain in `orbit.studio.json`, so
stopping and restarting the same command restores the project.

You now have a running structured-document editing loop. Continue with
[use an installed component package](use-component-package.md) or
[preview an edit through MCP](how-to.md) to drive the same canvas from an agent client.
