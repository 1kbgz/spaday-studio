type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface StudioNode {
  id: string;
  tag: string;
  key?: string | null;
  props: Record<string, JsonValue>;
  slots: Record<string, StudioNode[]>;
}

interface StudioDocument {
  title: string;
  root: StudioNode;
}

interface StudioState {
  revision: number;
  document: StudioDocument;
  preview: StudioDocument | null;
  preview_id: string | null;
}

type PropertyKind = "string" | "boolean" | "number" | "enum" | "json";

interface PropertySchema {
  name: string;
  kind: PropertyKind;
  choices: JsonValue[];
}

interface ComponentSchema {
  package: string;
  tag: string;
  class_name: string;
  summary?: string | null;
  props: PropertySchema[];
}

interface ComponentCatalog {
  available_packages: string[];
  selected_packages: string[];
  components: ComponentSchema[];
}

type PropertyControl =
  | HTMLInputElement
  | HTMLSelectElement
  | HTMLTextAreaElement;

interface WireNode {
  tag: string;
  key?: string;
  props?: Record<string, unknown>;
  slots?: Record<string, WireNode[]>;
}

interface RuntimeModule {
  mount(container: Element, tree: WireNode): Element;
  diff(oldTree: string, newTree: string): string;
  applyPatch(root: Element, patch: unknown): Element;
}

interface ClientMirror {
  onChange(listener: (change: { id: number }) => void): () => void;
  value(id: number): unknown;
  run(url: string, options?: { onMessage?: () => void }): { stop(): void };
}

interface TransportModule {
  Client: new () => ClientMirror;
  fromValue(value: unknown): unknown;
  toValue(value: unknown): unknown;
}

interface ConnectOptions {
  runtime: RuntimeModule;
  transport: TransportModule;
}

export function compileNode(
  node: StudioNode,
  toValue: (value: unknown) => unknown,
): WireNode {
  const props = Object.fromEntries(
    Object.entries({ ...node.props, "data-spaday-studio-id": node.id }).map(
      ([name, value]) => [name, toValue(value)],
    ),
  );
  const slots = Object.fromEntries(
    Object.entries(node.slots).map(([name, children]) => [
      name,
      children.map((child) => compileNode(child, toValue)),
    ]),
  );
  return {
    tag: node.tag,
    key: node.key ?? node.id,
    ...(Object.keys(props).length ? { props } : {}),
    ...(Object.keys(slots).length ? { slots } : {}),
  };
}

function findNode(node: StudioNode, id: string): StudioNode | undefined {
  if (node.id === id) return node;
  for (const children of Object.values(node.slots)) {
    for (const child of children) {
      const found = findNode(child, id);
      if (found) return found;
    }
  }
  return undefined;
}

function findLocation(
  node: StudioNode,
  id: string,
): { parent: StudioNode; slot: string; index: number } | undefined {
  for (const [slot, children] of Object.entries(node.slots)) {
    const index = children.findIndex((child) => child.id === id);
    if (index >= 0) return { parent: node, slot, index };
    for (const child of children) {
      const found = findLocation(child, id);
      if (found) return found;
    }
  }
  return undefined;
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Studio element ${selector} is missing`);
  return element;
}

export function connectStudio({ runtime, transport }: ConnectOptions): {
  stop(): void;
} {
  const canvas = requiredElement<HTMLElement>("#canvas");
  const tree = requiredElement<HTMLElement>("#component-tree");
  const form = requiredElement<HTMLFormElement>("#inspector-form");
  const empty = requiredElement<HTMLElement>("#selection-empty");
  const label = requiredElement<HTMLInputElement>("#component-label");
  const summary = requiredElement<HTMLElement>("#component-summary");
  const propertyFields = requiredElement<HTMLElement>("#property-fields");
  const message = requiredElement<HTMLElement>("#studio-message");
  const revision = requiredElement<HTMLElement>("#revision-status");
  const preview = requiredElement<HTMLElement>("#preview-status");
  const connection = requiredElement<HTMLElement>("#connection-status");
  const componentType = requiredElement<HTMLSelectElement>("#component-type");
  const addComponent = requiredElement<HTMLButtonElement>("#add-component");
  const catalogNote = requiredElement<HTMLElement>("#catalog-note");
  const moveUp = requiredElement<HTMLButtonElement>("#move-up");
  const remove = requiredElement<HTMLButtonElement>("#remove-component");

  let state: StudioState | undefined;
  let catalog: ComponentCatalog | undefined;
  let currentTree: WireNode | undefined;
  let root: Element | undefined;
  let selectedId: string | undefined;
  let pendingSelection: string | undefined;

  const activeDocument = (): StudioDocument | undefined =>
    state?.preview ?? state?.document;

  const showMessage = (value: string, error = false) => {
    message.textContent = value;
    message.classList.toggle("studio-error", error);
  };

  const schemaFor = (tag: string): ComponentSchema | undefined =>
    catalog?.components.find((component) => component.tag === tag);

  const postOperations = async (operations: unknown[]): Promise<boolean> => {
    if (!state) return false;
    if (state.preview) {
      showMessage(
        "Discard or commit the active MCP preview before editing in the inspector.",
        true,
      );
      return false;
    }
    const response = await fetch("/api/operations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expected_revision: state.revision, operations }),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      showMessage(result.error ?? "Edit failed", true);
      return false;
    }
    showMessage(
      "Edit accepted; waiting for the authoritative transports patch.",
    );
    return true;
  };

  const inferredProperty = (
    name: string,
    value: JsonValue,
  ): PropertySchema => ({
    name,
    kind:
      typeof value === "boolean"
        ? "boolean"
        : typeof value === "number"
          ? "number"
          : typeof value === "string"
            ? "string"
            : "json",
    choices: [],
  });

  const propertyControl = (
    property: PropertySchema,
    value: JsonValue | undefined,
  ): PropertyControl => {
    let control: PropertyControl;
    if (property.kind === "boolean" || property.kind === "enum") {
      const select = document.createElement("select");
      select.append(new Option("Not set", ""));
      const choices =
        property.kind === "boolean" ? [true, false] : property.choices;
      for (const choice of choices) {
        select.append(new Option(String(choice), JSON.stringify(choice)));
      }
      if (value !== undefined) {
        const encoded = JSON.stringify(value);
        if (![...select.options].some((option) => option.value === encoded)) {
          select.append(new Option(String(value), encoded));
        }
        select.value = encoded;
      }
      control = select;
    } else if (
      property.kind === "json" ||
      property.name === "style" ||
      property.name === "textContent"
    ) {
      const textarea = document.createElement("textarea");
      textarea.rows = property.name === "style" ? 5 : 3;
      textarea.value =
        value === undefined
          ? ""
          : property.kind === "json"
            ? JSON.stringify(value, null, 2)
            : String(value);
      control = textarea;
    } else {
      const input = document.createElement("input");
      input.type = property.kind === "number" ? "number" : "text";
      input.value = value === undefined ? "" : String(value);
      control = input;
    }
    control.className = "studio-property-control";
    control.dataset.studioProp = property.name;
    control.dataset.kind = property.kind;
    control.dataset.present = String(value !== undefined);
    control.dataset.dirty = "false";
    const markDirty = () => {
      control.dataset.dirty = "true";
    };
    control.addEventListener("input", markDirty);
    control.addEventListener("change", markDirty);
    return control;
  };

  const renderProperties = (node: StudioNode) => {
    const component = schemaFor(node.tag);
    summary.textContent =
      component?.summary ??
      (component
        ? `${component.package} component`
        : "No selected catalog schema; showing authored properties only.");
    const properties = new Map(
      (component?.props ?? []).map((property) => [property.name, property]),
    );
    for (const [name, value] of Object.entries(node.props)) {
      if (!properties.has(name))
        properties.set(name, inferredProperty(name, value));
    }
    const hasChildren = Object.values(node.slots).some(
      (children) => children.length > 0,
    );
    if (
      hasChildren &&
      !Object.prototype.hasOwnProperty.call(node.props, "textContent")
    ) {
      properties.delete("textContent");
    }
    propertyFields.replaceChildren();
    for (const property of [...properties.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const field = document.createElement("div");
      field.className = "studio-property-field";
      const heading = document.createElement("div");
      heading.className = "studio-property-heading";
      const name = document.createElement("strong");
      name.textContent = property.name;
      const kind = document.createElement("code");
      kind.textContent = property.kind;
      heading.append(name, kind);
      const value = node.props[property.name];
      if (Object.prototype.hasOwnProperty.call(node.props, property.name)) {
        const unset = document.createElement("button");
        unset.type = "button";
        unset.textContent = "Unset";
        unset.addEventListener("click", () => {
          void postOperations([
            { kind: "unset_prop", id: node.id, name: property.name },
          ]);
        });
        heading.append(unset);
      }
      field.append(heading, propertyControl(property, value));
      propertyFields.append(field);
    }
  };

  const readControl = (control: PropertyControl): JsonValue | undefined => {
    const kind = control.dataset.kind as PropertyKind;
    if (kind === "string") return control.value;
    if (!control.value) return undefined;
    if (kind === "number") {
      const value = Number(control.value);
      if (!Number.isFinite(value)) throw new Error("Enter a finite number.");
      return value;
    }
    return JSON.parse(control.value) as JsonValue;
  };

  const renderComponentOptions = () => {
    if (!catalog) return;
    componentType.replaceChildren();
    const packages = new Map<string, ComponentSchema[]>();
    for (const component of catalog.components) {
      const components = packages.get(component.package) ?? [];
      components.push(component);
      packages.set(component.package, components);
    }
    for (const [packageName, components] of packages) {
      const group = document.createElement("optgroup");
      group.label = packageName;
      for (const component of components) {
        group.append(
          new Option(
            `${component.class_name} · <${component.tag}>`,
            component.tag,
          ),
        );
      }
      componentType.append(group);
    }
    if (schemaFor("p")) componentType.value = "p";
    const inactive = catalog.available_packages.filter(
      (name) => !catalog!.selected_packages.includes(name),
    );
    catalogNote.textContent = inactive.length
      ? `Also installed: ${inactive.join(", ")}. Select with --package NAME.`
      : `${catalog.components.length} components available.`;
  };

  const treeBranch = (node: StudioNode): HTMLLIElement => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${node.tag}  ${node.id}`;
    button.classList.toggle("studio-tree-selected", selectedId === node.id);
    button.addEventListener("click", () => select(node.id));
    item.append(button);
    const children = Object.values(node.slots).flat();
    if (children.length) {
      const list = document.createElement("ul");
      children.forEach((child) => list.append(treeBranch(child)));
      item.append(list);
    }
    return item;
  };

  const select = (id: string) => {
    const active = activeDocument();
    if (!active) return;
    const selected = findNode(active.root, id);
    if (!selected) return;
    selectedId = id;
    canvas
      .querySelectorAll(".spaday-studio-selected")
      .forEach((element) => element.classList.remove("spaday-studio-selected"));
    canvas
      .querySelector<HTMLElement>(`[data-spaday-studio-id="${CSS.escape(id)}"]`)
      ?.classList.add("spaday-studio-selected");
    empty.hidden = true;
    form.hidden = false;
    label.value = `${selected.tag} · ${selected.id}`;
    renderProperties(selected);
    addComponent.disabled = Object.prototype.hasOwnProperty.call(
      selected.props,
      "textContent",
    );
    remove.disabled = selected.id === active.root.id;
    const location = findLocation(active.root, selected.id);
    moveUp.disabled = !location || location.index === 0;
    renderTree();
  };

  const renderTree = () => {
    const active = activeDocument();
    if (!active) return;
    tree.replaceChildren();
    const list = document.createElement("ul");
    list.append(treeBranch(active.root));
    tree.append(list);
  };

  const render = () => {
    const active = activeDocument();
    if (!active || !state) return;
    const nextTree = compileNode(active.root, transport.toValue);
    if (!root) root = runtime.mount(canvas, nextTree);
    else {
      const patch = JSON.parse(
        runtime.diff(JSON.stringify(currentTree), JSON.stringify(nextTree)),
      ) as unknown;
      root = runtime.applyPatch(root, patch);
    }
    currentTree = nextTree;
    revision.textContent = `Revision ${state.revision}`;
    preview.textContent = state.preview ? "Preview draft" : "Canonical";
    preview.classList.toggle("studio-preview-active", Boolean(state.preview));
    connection.textContent = "Live";
    renderTree();
    if (pendingSelection && findNode(active.root, pendingSelection)) {
      selectedId = pendingSelection;
      pendingSelection = undefined;
    }
    if (selectedId && findNode(active.root, selectedId)) select(selectedId);
    else select(active.root.id);
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!selectedId) return;
    const operations: unknown[] = [];
    try {
      for (const control of propertyFields.querySelectorAll<PropertyControl>(
        ".studio-property-control",
      )) {
        if (control.dataset.dirty !== "true") continue;
        const name = control.dataset.studioProp!;
        const value = readControl(control);
        if (value === undefined) {
          if (control.dataset.present === "true") {
            operations.push({ kind: "unset_prop", id: selectedId, name });
          }
        } else {
          operations.push({ kind: "set_prop", id: selectedId, name, value });
        }
      }
    } catch (error) {
      showMessage(
        error instanceof Error ? error.message : "Invalid property value",
        true,
      );
      return;
    }
    if (!operations.length) {
      showMessage("No property changes to apply.");
      return;
    }
    void postOperations(operations);
  });

  addComponent.addEventListener("click", () => {
    if (!selectedId) return;
    const parent = findNode(activeDocument()!.root, selectedId);
    const index = parent?.slots.default?.length ?? 0;
    const component = schemaFor(componentType.value);
    if (!component) return;
    const suffix = globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36);
    const id = `${component.tag.replace(/[^a-z0-9]+/g, "-")}-${suffix}`;
    const props = component.props.some(
      (property) => property.name === "textContent",
    )
      ? { textContent: `New ${component.class_name}` }
      : {};
    pendingSelection = id;
    void postOperations([
      {
        kind: "insert",
        parent_id: selectedId,
        slot: "default",
        index,
        node: {
          id,
          tag: component.tag,
          props,
          slots: {},
        },
      },
    ]).then((accepted) => {
      if (!accepted) pendingSelection = undefined;
    });
  });

  moveUp.addEventListener("click", () => {
    if (!selectedId) return;
    const location = findLocation(activeDocument()!.root, selectedId);
    if (!location || location.index === 0) return;
    void postOperations([
      {
        kind: "move",
        id: selectedId,
        parent_id: location.parent.id,
        slot: location.slot,
        index: location.index - 1,
      },
    ]);
  });

  remove.addEventListener("click", () => {
    if (selectedId) void postOperations([{ kind: "remove", id: selectedId }]);
  });

  canvas.addEventListener(
    "click",
    (event) => {
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("[data-spaday-studio-id]")
          : null;
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      const id = target.dataset.spadayStudioId;
      if (id) select(id);
    },
    true,
  );

  void fetch("/api/catalog")
    .then(async (response) => {
      if (!response.ok) throw new Error("Component catalog failed to load.");
      catalog = (await response.json()) as ComponentCatalog;
      renderComponentOptions();
      if (selectedId) select(selectedId);
    })
    .catch((error: unknown) => {
      showMessage(
        error instanceof Error
          ? error.message
          : "Component catalog failed to load.",
        true,
      );
    });

  const client = new transport.Client();
  client.onChange((change) => {
    state = transport.fromValue(client.value(change.id)) as StudioState;
    render();
  });
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const link = client.run(`${scheme}://${location.host}/ws`);

  return {
    stop() {
      link.stop();
      root?.remove();
    },
  };
}
