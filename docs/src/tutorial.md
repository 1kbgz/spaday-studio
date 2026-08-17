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

Click **Apply properties**. The revision changes to `Revision 1`, and the live headline changes without the
canvas flashing or reloading.

## Make a structural edit

Select `main · app` at the top of the component tree. Choose `p · <p>` under the `html` catalog and click
**Add component**. A new paragraph appears at the bottom of the canvas, and the revision advances again.

Select the new paragraph and click **Move up** or **Remove**. Each accepted operation arrives as a new
authoritative transports revision and is reconciled through spaday's keyed tree patch.

## Export the accepted application

Click **Export Python** in the header. The downloaded `spaday_app.py` contains a standard spaday
`page()` function for the current canonical revision. Your edits also remain in `orbit.studio.json`, so
stopping and restarting the same command restores the project.

You now have a running structured-document editing loop. Continue with
[use an installed component package](use-component-package.md) or
[preview an edit through MCP](how-to.md) to drive the same canvas from an agent client.
