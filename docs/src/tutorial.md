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
spaday-studio
```

Open <http://127.0.0.1:8020>. You should see a component tree on the left, an operations dashboard in
the center, and an inspector on the right. The header should show `Revision 0` and `Canonical`.

## Select and edit the headline

Click the large headline in the canvas. The inspector should identify `h1 · headline`.

Replace its text with:

```text
Ship the interface while it is running.
```

Click **Apply edit**. The revision changes to `Revision 1`, and the live headline changes without the
canvas flashing or reloading.

## Make a structural edit

Select `section · metrics` in the component tree and click **Add text child**. A new paragraph appears
inside the metric grid, and the revision advances again.

Select the new paragraph and click **Move up** or **Remove**. Each accepted operation arrives as a new
authoritative transports revision and is reconciled through spaday's keyed tree patch.

You now have a running structured-document editing loop. Continue with
[preview an edit through MCP](how-to.md) to drive the same canvas from an agent client.
