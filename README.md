<a href="https://github.com/1kbgz/spaday-studio">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://github.com/1kbgz/spaday-studio/raw/main/docs/img/logo-dark.webp?raw=true">
    <img alt="spaday-studio logo, DJ turntables and a mixer inside a browser window" src="https://github.com/1kbgz/spaday-studio/raw/main/docs/img/logo-light.webp?raw=true" width="800">
  </picture>
</a>

AI-native visual development environment for spaday

[![Build Status](https://github.com/1kbgz/spaday-studio/actions/workflows/build.yaml/badge.svg?branch=main&event=push)](https://github.com/1kbgz/spaday-studio/actions/workflows/build.yaml)
[![codecov](https://codecov.io/gh/1kbgz/spaday-studio/branch/main/graph/badge.svg)](https://codecov.io/gh/1kbgz/spaday-studio)
[![License](https://img.shields.io/github/license/1kbgz/spaday-studio)](https://github.com/1kbgz/spaday-studio)
[![PyPI](https://img.shields.io/pypi/v/spaday-studio.svg)](https://pypi.python.org/pypi/spaday-studio)

## Overview

spaday-studio is a pilot AI-native visual development environment built on spaday's real component
runtime. A structured project document is mirrored through transports; browser and MCP clients submit
validated semantic edits; spaday applies the resulting tree diff without remounting unaffected elements.

The pilot includes:

- a selectable live application canvas with schema-driven property, binding, action, and state controls;
- component catalogs that retain Spaday property, field, event, and named-slot metadata;
- revision-checked property, binding, event, state, insert, move, and remove operations;
- private browser and MCP drafts with commit, discard, semantic rebase, conflict reporting, inspection,
  and actor-aware undo;
- revision-scoped CodeMirror buffers using transports sequence CRDTs and cursor awareness;
- atomic structured-project persistence and deterministic Python export;
- a persistent Spaday `Store` in the preview canvas, so authored bindings and actions run normally;
- a Python+JavaScript Copier scaffold, Playwright coverage, and Yardang/Sphinx documentation.

## Run the pilot

```bash
make develop
make build
spaday-studio --project orbit.studio.json
```

Open <http://127.0.0.1:8020>. Select the headline, change its text or style, and preview the edit. The
draft remains private until you click **Commit**. Accepted documents arrive through transports and the
canvas applies a Spaday component-tree patch without replacing unaffected elements. Canonical edits are
saved to `orbit.studio.json`. Use **Export Python** to download an ordinary Spaday `page()` function and
its initial runtime state.

The MCP endpoint is `http://127.0.0.1:8020/mcp`. Start with the
[guided tutorial](docs/src/tutorial.md), connect an agent with the
[MCP how-to guide](docs/src/how-to.md), [save and export a project](docs/src/save-and-export.md),
[use an installed component package](docs/src/use-component-package.md), consult the
[API reference](docs/src/reference.md), or read
[why Studio uses a structured document](docs/src/explanation.md).

## Pilot boundaries

- Binding, event-action, and runtime-state surfaces use validated JSON editors. Dedicated form controls
  for common binding and action variants are not implemented.
- Concurrent leaf edits rebase when they touch different fields. Concurrent structural edits to the same
  parent slot report a conflict instead of guessing an order.
- Revision-scoped collaborative buffers are in-memory and are not part of the saved project.
- Component packages are selected when the server starts; the browser cannot activate a package live.
- Arbitrary handwritten Python is not losslessly round-tripped.
- Python export is one-way generated output; the structured JSON project remains the editable source.

> [!NOTE]
> This library was generated using [copier](https://copier.readthedocs.io/en/stable/) from the [Base Python Project Template repository](https://github.com/python-project-templates/base).
