# Use an installed component package

This guide shows how to load an installed spaday peer package into Studio and use its typed component
properties in the editor.

## Install and select the package

Install the package in Studio's environment. For example:

```bash
uv pip install spaday-webawesome
```

Select its spaday entry-point name when starting Studio:

```bash
spaday-studio --project orbit.studio.json --package webawesome
```

Repeat `--package` to select more than one package. Studio lists other installed package names, but it
imports schemas and injects browser assets only for selected packages.

Select every installed component package with a quoted wildcard:

```bash
spaday-studio --project orbit.studio.json --package '*'
```

The quotes prevent your shell from expanding `*` into filenames before Studio receives it.

## Insert and configure a component

Select a container in the component tree. In **Insert into selection**, open the `webawesome` group,
choose `WaButton · <wa-button>`, and click **Add component**.

Select the inserted button. Its inspector controls come from the typed Python constructor: booleans use
true/false selectors, literal choices use enumerated selectors, numbers use number inputs, and structured
values use JSON text areas. Change a property and click **Apply properties**.

Use **Unset** beside an authored property to remove it instead of assigning another value. Studio submits
the resulting `set_prop` or `unset_prop` operation through the same revision-checked editing path as a
built-in HTML component.
