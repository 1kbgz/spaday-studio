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
  bindings: Record<string, Record<string, JsonValue>>;
  events: Record<string, Record<string, JsonValue>>;
  slots: Record<string, StudioNode[]>;
}

interface StudioDocument {
  title: string;
  state: Record<string, JsonValue>;
  root: StudioNode;
}

interface StudioState {
  revision: number;
  document: StudioDocument;
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
  events: string[];
  slots: string[];
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
  bindings?: Record<string, unknown>;
  events?: Record<string, unknown>;
  slots?: Record<string, WireNode[]>;
}

interface JsonEditor extends HTMLElement {
  doc: string;
  selection: { anchor: number; head: number } | null;
  remote_cursors: Array<{
    peer: string;
    anchor: number;
    head?: number;
    label?: string;
    color?: string;
  }>;
}

interface RuntimeStore {
  set(field: string, value: unknown): void;
}

interface RuntimeModule {
  Store: new (initial?: Record<string, unknown>) => RuntimeStore;
  mount(container: Element, tree: WireNode, store?: RuntimeStore): Element;
  diff(oldTree: string, newTree: string): string;
  applyPatch(root: Element, patch: unknown, store?: RuntimeStore): Element;
}

interface ClientMirror {
  onChange(listener: (change: { id: number }) => void): () => void;
  onAwareness(
    listener: (change: { id: number; peer: string; state: unknown }) => void,
  ): () => void;
  awareness(id: number): ReadonlyMap<string, unknown>;
  ids(): number[];
  proposeCrdt(id: number, mutations: unknown[]): boolean;
  setAwareness(id: number, state: unknown | null): boolean;
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

interface TreeItem {
  id: string;
  label: string;
  className: string;
  style: string;
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
    ...(Object.keys(node.bindings ?? {}).length
      ? { bindings: node.bindings }
      : {}),
    ...(Object.keys(node.events ?? {}).length ? { events: node.events } : {}),
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

function flattenTree(
  node: StudioNode,
  selectedId: string | undefined,
  depth = 0,
  items: TreeItem[] = [],
  slot?: string,
): TreeItem[] {
  items.push({
    id: node.id,
    label: `${slot ? `[${slot}] ` : ""}${node.tag}  ${node.id}`,
    className: selectedId === node.id ? "studio-tree-selected" : "",
    style: `padding-left: ${8 + depth * 14}px`,
  });
  for (const [name, children] of Object.entries(node.slots)) {
    for (const child of children) {
      flattenTree(child, selectedId, depth + 1, items, name);
    }
  }
  return items;
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
  const componentSlot = requiredElement<HTMLSelectElement>("#component-slot");
  const addComponent = requiredElement<HTMLButtonElement>("#add-component");
  const catalogNote = requiredElement<HTMLElement>("#catalog-note");
  const moveUp = requiredElement<HTMLButtonElement>("#move-up");
  const remove = requiredElement<HTMLButtonElement>("#remove-component");
  const commitDraft = requiredElement<HTMLButtonElement>("#commit-draft");
  const discardDraft = requiredElement<HTMLButtonElement>("#discard-draft");
  const bindingsEditor = requiredElement<JsonEditor>("#bindings-editor");
  const eventsEditor = requiredElement<JsonEditor>("#events-editor");
  const stateEditor = requiredElement<JsonEditor>("#state-editor");
  const eventHelp = requiredElement<HTMLElement>("#event-help");
  const applyState = requiredElement<HTMLButtonElement>("#apply-state");

  let state: StudioState | undefined;
  let draft:
    | { preview_id: string; base_revision: number; document: StudioDocument }
    | undefined;
  let catalog: ComponentCatalog | undefined;
  let currentTree: WireNode | undefined;
  let root: Element | undefined;
  let selectedId: string | undefined;
  let pendingSelection: string | undefined;
  let canvasStore: RuntimeStore | undefined;
  let canvasState: Record<string, JsonValue> = {};
  const actorId =
    sessionStorage.getItem("spaday-studio-actor") ??
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random()}`;
  sessionStorage.setItem("spaday-studio-actor", actorId);
  const actorColor = `hsl(${[...actorId].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 360} 65% 45%)`;
  const bufferKeys = new Map<JsonEditor, string>();
  const bufferInitial = new Map<JsonEditor, string>();
  let bufferModelId: number | undefined;
  let bufferValues: Record<string, string> = {};

  const bufferKey = (surface: string, nodeId?: string) =>
    `${draft?.base_revision ?? state?.revision ?? 0}:${nodeId ? `${nodeId}:` : ""}${surface}`;

  const ensureBuffer = (editor: JsonEditor) => {
    const key = bufferKeys.get(editor);
    const initial = bufferInitial.get(editor);
    if (!key || initial === undefined || bufferModelId === undefined) return;
    if (!(key in bufferValues)) {
      bufferValues[key] = initial;
      bufferClient.proposeCrdt(bufferModelId, [
        { kind: "map_set", path: [], key, value: initial },
      ]);
    }
    editor.doc = bufferValues[key];
  };

  const activateBuffer = (editor: JsonEditor, key: string, initial: string) => {
    bufferKeys.set(editor, key);
    bufferInitial.set(editor, initial);
    ensureBuffer(editor);
    if (!(key in bufferValues)) editor.doc = initial;
  };

  const spliceText = (current: string, next: string) => {
    const before = Array.from(current);
    const after = Array.from(next);
    let start = 0;
    while (
      start < before.length &&
      start < after.length &&
      before[start] === after[start]
    )
      start += 1;
    let end = 0;
    while (
      end < before.length - start &&
      end < after.length - start &&
      before[before.length - 1 - end] === after[after.length - 1 - end]
    )
      end += 1;
    return {
      index: start,
      delete_count: before.length - start - end,
      values: after.slice(start, after.length - end),
    };
  };

  const publishCursor = (editor: JsonEditor) => {
    const key = bufferKeys.get(editor);
    if (!key || bufferModelId === undefined || !editor.selection) return;
    bufferClient.setAwareness(bufferModelId, {
      buffer: key,
      selection: editor.selection,
      name: actorId.slice(0, 8),
      color: actorColor,
    });
  };

  const renderRemoteCursors = () => {
    if (bufferModelId === undefined) return;
    for (const [editor, key] of bufferKeys) {
      editor.remote_cursors = [...bufferClient.awareness(bufferModelId)]
        .filter(([, value]) => {
          const candidate = value as {
            buffer?: unknown;
            selection?: unknown;
          } | null;
          return (
            candidate?.buffer === key &&
            candidate.selection &&
            typeof candidate.selection === "object"
          );
        })
        .map(([peer, value]) => {
          const candidate = value as {
            selection: { anchor: number; head?: number };
            name?: string;
            color?: string;
          };
          return {
            peer,
            ...candidate.selection,
            label: candidate.name,
            color: candidate.color,
          };
        });
    }
  };

  const handleBufferEdit = (editor: JsonEditor, event: Event) => {
    const key = bufferKeys.get(editor);
    if (!key || bufferModelId === undefined) return;
    const next = (event as CustomEvent<{ doc: string }>).detail.doc;
    const current = bufferValues[key] ?? bufferInitial.get(editor) ?? "";
    const splice = spliceText(current, next);
    bufferValues[key] = next;
    if (splice.delete_count || splice.values.length)
      bufferClient.proposeCrdt(bufferModelId, [
        {
          kind: "sequence_splice",
          path: [{ kind: "key", key }],
          ...splice,
        },
      ]);
    publishCursor(editor);
  };

  for (const editor of [bindingsEditor, eventsEditor, stateEditor]) {
    editor.addEventListener("editor-change", (event) =>
      handleBufferEdit(editor, event),
    );
    editor.addEventListener("editor-selection", () => publishCursor(editor));
  }

  const bufferClient = new transport.Client();
  bufferClient.onChange((change) => {
    bufferModelId = change.id;
    bufferValues = transport.fromValue(bufferClient.value(change.id)) as Record<
      string,
      string
    >;
    for (const editor of bufferKeys.keys()) ensureBuffer(editor);
    renderRemoteCursors();
  });
  bufferClient.onAwareness(() => renderRemoteCursors());
  const bufferScheme = location.protocol === "https:" ? "wss" : "ws";
  const bufferLink = bufferClient.run(
    `${bufferScheme}://${location.host}/ws/buffers/${encodeURIComponent(actorId)}`,
  );

  const treeStore = new runtime.Store({ treeItems: [] });
  const itemBinding = (path: keyof TreeItem) => ({
    compute: { expr: "item", path },
    mode: "one-way",
  });
  const treeRoot = runtime.mount(
    tree,
    {
      tag: "div",
      props: { className: transport.toValue("studio-tree-list") },
      slots: {
        default: [
          {
            tag: "spa-each",
            props: {
              itemKey: transport.toValue("id"),
              style: transport.toValue("display:contents"),
            },
            bindings: { items: { field: "treeItems", mode: "one-way" } },
            slots: {
              default: [
                {
                  tag: "button",
                  props: { type: transport.toValue("button") },
                  bindings: {
                    textContent: itemBinding("label"),
                    className: itemBinding("className"),
                    style: itemBinding("style"),
                    "data-studio-tree-id": itemBinding("id"),
                  },
                },
              ],
            },
          },
        ],
      },
    },
    treeStore,
  );

  const activeDocument = (): StudioDocument | undefined =>
    draft?.document ?? state?.document;

  const showMessage = (value: string, error = false) => {
    message.textContent = value;
    message.classList.toggle("studio-error", error);
  };

  const schemaFor = (tag: string): ComponentSchema | undefined =>
    catalog?.components.find((component) => component.tag === tag);

  const submitOperations = async (operations: unknown[]): Promise<boolean> => {
    if (!state) return false;
    const response = await fetch("/api/drafts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expected_revision: state.revision,
        preview_id: draft?.preview_id,
        actor_id: actorId,
        operations,
      }),
    });
    const result = (await response.json()) as {
      error?: string;
      preview_id: string;
      base_revision: number;
      document: StudioDocument;
    };
    if (!response.ok) {
      showMessage(result.error ?? "Edit failed", true);
      return false;
    }
    draft = result;
    showMessage("Private draft updated. Commit when the preview is ready.");
    render();
    return true;
  };
  let operationQueue = Promise.resolve();
  const postOperations = (operations: unknown[]): Promise<boolean> => {
    const request = operationQueue.then(() => submitOperations(operations));
    operationQueue = request.then(
      () => undefined,
      () => undefined,
    );
    return request;
  };

  const finishDraft = async (action: "commit" | "discard") => {
    if (!draft) return;
    const response = await fetch(
      `/api/drafts/${encodeURIComponent(draft.preview_id)}/${action}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actor_id: actorId }),
      },
    );
    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      showMessage(result.error ?? `Draft ${action} failed`, true);
      return;
    }
    draft = undefined;
    showMessage(
      action === "commit"
        ? "Draft committed; waiting for the authoritative transports patch."
        : "Draft discarded.",
    );
    render();
  };

  commitDraft.addEventListener("click", () => void finishDraft("commit"));
  discardDraft.addEventListener("click", () => void finishDraft("discard"));

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
    activateBuffer(
      bindingsEditor,
      bufferKey("bindings", node.id),
      JSON.stringify(node.bindings, null, 2),
    );
    activateBuffer(
      eventsEditor,
      bufferKey("events", node.id),
      JSON.stringify(node.events, null, 2),
    );
    eventHelp.textContent = component?.events.length
      ? `Declared events: ${component.events.join(", ")}. Each value must be a Spaday action.`
      : "Map DOM event names to Spaday actions.";
  };

  const jsonObject = (source: string, label: string) => {
    const value = JSON.parse(source) as unknown;
    if (!value || Array.isArray(value) || typeof value !== "object")
      throw new Error(`${label} must be a JSON object.`);
    return value as Record<string, Record<string, JsonValue>>;
  };

  const mapOperations = (
    node: StudioNode,
    kind: "binding" | "event",
    next: Record<string, Record<string, JsonValue>>,
  ): unknown[] => {
    const current = kind === "binding" ? node.bindings : node.events;
    const operations: unknown[] = [];
    for (const name of Object.keys(current)) {
      if (!(name in next))
        operations.push({ kind: `unset_${kind}`, id: node.id, name });
    }
    for (const [name, value] of Object.entries(next)) {
      if (JSON.stringify(value) === JSON.stringify(current[name])) continue;
      operations.push({
        kind: `set_${kind}`,
        id: node.id,
        name,
        [kind === "binding" ? "binding" : "action"]: value,
      });
    }
    return operations;
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
    const component = schemaFor(selected.tag);
    const slots = new Set([
      "default",
      ...(component?.slots ?? []),
      ...Object.keys(selected.slots),
    ]);
    const previousSlot = componentSlot.value;
    componentSlot.replaceChildren(
      ...[...slots].sort().map((slot) => new Option(slot, slot)),
    );
    componentSlot.value = slots.has(previousSlot) ? previousSlot : "default";
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
    treeStore.set("treeItems", flattenTree(active.root, selectedId));
  };

  tree.addEventListener("click", (event) => {
    const target =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-studio-tree-id]")
        : null;
    const id = target?.dataset.studioTreeId;
    if (id) select(id);
  });

  const render = () => {
    const active = activeDocument();
    if (!active || !state) return;
    const nextTree = compileNode(active.root, transport.toValue);
    if (!canvasStore) canvasStore = new runtime.Store(active.state);
    else {
      for (const field of Object.keys(canvasState)) {
        if (!(field in active.state)) canvasStore.set(field, undefined);
      }
      for (const [field, value] of Object.entries(active.state)) {
        if (JSON.stringify(value) !== JSON.stringify(canvasState[field]))
          canvasStore.set(field, value);
      }
    }
    canvasState = structuredClone(active.state);
    if (!root) root = runtime.mount(canvas, nextTree, canvasStore);
    else {
      const patch = JSON.parse(
        runtime.diff(JSON.stringify(currentTree), JSON.stringify(nextTree)),
      ) as unknown;
      root = runtime.applyPatch(root, patch, canvasStore);
    }
    currentTree = nextTree;
    revision.textContent = `Revision ${state.revision}`;
    preview.textContent = draft ? "Private draft" : "Canonical";
    preview.classList.toggle("studio-preview-active", Boolean(draft));
    commitDraft.hidden = !draft;
    discardDraft.hidden = !draft;
    activateBuffer(
      stateEditor,
      bufferKey("state"),
      JSON.stringify(active.state, null, 2),
    );
    connection.textContent = "Live";
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
      const node = findNode(activeDocument()!.root, selectedId);
      if (!node) throw new Error("Selected component no longer exists.");
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
      operations.push(
        ...mapOperations(
          node,
          "binding",
          jsonObject(bindingsEditor.doc, "Bindings"),
        ),
        ...mapOperations(node, "event", jsonObject(eventsEditor.doc, "Events")),
      );
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

  applyState.addEventListener("click", () => {
    const active = activeDocument();
    if (!active) return;
    try {
      const parsed = JSON.parse(stateEditor.doc) as unknown;
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
        throw new Error("Runtime state must be a JSON object.");
      const next = parsed as Record<string, JsonValue>;
      const operations: unknown[] = [];
      for (const name of Object.keys(active.state)) {
        if (!(name in next)) operations.push({ kind: "unset_state", name });
      }
      for (const [name, value] of Object.entries(next)) {
        if (JSON.stringify(value) !== JSON.stringify(active.state[name]))
          operations.push({ kind: "set_state", name, value });
      }
      if (!operations.length) {
        showMessage("No runtime state changes to preview.");
        return;
      }
      void postOperations(operations);
    } catch (error) {
      showMessage(
        error instanceof Error ? error.message : "Invalid runtime state",
        true,
      );
    }
  });

  addComponent.addEventListener("click", () => {
    if (!selectedId) return;
    const parent = findNode(activeDocument()!.root, selectedId);
    const slot = componentSlot.value;
    const siblings = parent?.slots[slot] ?? [];
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
        slot,
        ...(siblings.length
          ? { after_id: siblings[siblings.length - 1].id }
          : {}),
        node: {
          id,
          tag: component.tag,
          props,
          bindings: {},
          events: {},
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
        before_id: location.parent.slots[location.slot][location.index - 1].id,
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
      if (bufferModelId !== undefined)
        bufferClient.setAwareness(bufferModelId, null);
      link.stop();
      bufferLink.stop();
      root?.remove();
      treeRoot.remove();
    },
  };
}
