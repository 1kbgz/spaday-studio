type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

type EventOptions = Partial<Record<"capture" | "once" | "passive", boolean>>;

export interface StudioNode {
  id: string;
  tag: string;
  key?: string | null;
  props: Record<string, JsonValue>;
  bindings: Record<string, Record<string, JsonValue>>;
  events: Record<string, Record<string, JsonValue>>;
  event_options?: Record<string, EventOptions>;
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
  event_options?: Record<string, EventOptions>;
  slots?: Record<string, WireNode[]>;
}

interface JsonEditor extends HTMLElement {
  doc: string;
  read_only: boolean;
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
  unmount(root: Element): void;
  diff(oldTree: string, newTree: string): string;
  applyPatch(root: Element, patch: unknown, store?: RuntimeStore): Element;
}

interface ClientMirror {
  onChange(listener: (change: { id: number }) => void): () => void;
  onConnect(listener: () => void): () => void;
  onAwareness(
    listener: (change: { id: number; peer: string; state: unknown }) => void,
  ): () => void;
  awareness(id: number): ReadonlyMap<string, unknown>;
  ids(): number[];
  proposeCrdt(id: number, mutations: unknown[]): boolean;
  setAwareness(id: number, state: unknown | null): boolean;
  value(id: number): unknown;
  connect(url: string): WebSocket;
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
    ...(Object.keys(node.event_options ?? {}).length
      ? { event_options: node.event_options }
      : {}),
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
  let stopped = false;
  const listeners = new AbortController();
  const listen = (
    target: EventTarget,
    type: string,
    callback: (event: Event) => void,
    capture = false,
  ) =>
    target.addEventListener(type, callback, {
      capture,
      signal: listeners.signal,
    });
  class StudioClient extends transport.Client {
    private socket?: WebSocket;

    connect(url: string): WebSocket {
      this.socket = super.connect(url);
      return this.socket;
    }

    close() {
      this.socket?.close();
    }
  }
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
  const moveDown = requiredElement<HTMLButtonElement>("#move-down");
  const duplicate = requiredElement<HTMLButtonElement>("#duplicate-component");
  const remove = requiredElement<HTMLButtonElement>("#remove-component");
  const commitDraft = requiredElement<HTMLButtonElement>("#commit-draft");
  const discardDraft = requiredElement<HTMLButtonElement>("#discard-draft");
  const undoEdit = requiredElement<HTMLButtonElement>("#undo-edit");
  const redoEdit = requiredElement<HTMLButtonElement>("#redo-edit");
  const bindingControls = requiredElement<HTMLElement>("#binding-controls");
  const eventControls = requiredElement<HTMLElement>("#event-controls");
  const addBinding = requiredElement<HTMLButtonElement>("#add-binding");
  const addEvent = requiredElement<HTMLButtonElement>("#add-event");
  const bindingJsonHelp = requiredElement<HTMLElement>("#binding-json-help");
  const eventJsonHelp = requiredElement<HTMLElement>("#event-json-help");
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
  const pendingPropertyValues = new Map<string, Map<string, string>>();
  let bufferModelId: number | undefined;
  let bufferValues: Record<string, string> = {};
  let renderBehaviorControls = (_node: StudioNode) => {};
  let behaviorRenderPending = false;
  const scheduleBehaviorControls = () => {
    if (behaviorRenderPending) return;
    behaviorRenderPending = true;
    requestAnimationFrame(() => {
      behaviorRenderPending = false;
      if (stopped) return;
      const active = draft?.document ?? state?.document;
      const selected =
        active && selectedId ? findNode(active.root, selectedId) : undefined;
      if (selected) renderBehaviorControls(selected);
    });
  };
  let accessRole: "read" | "edit" | "admin" = "read";
  let catalogReady = false;
  let accessReady = false;
  let draftRecoveryReady = false;
  let bufferReady = false;
  let committedRevision: number | undefined;
  let historyRequest = 0;
  const isReady = () =>
    Boolean(
      !stopped &&
      state &&
      catalogReady &&
      accessReady &&
      draftRecoveryReady &&
      bufferReady,
    );

  const configureAccess = () => {
    const readOnly = accessRole === "read" || !isReady();
    for (const control of [
      componentType,
      componentSlot,
      addBinding,
      addEvent,
      applyState,
    ])
      control.disabled = readOnly;
    for (const control of form.querySelectorAll<
      | HTMLInputElement
      | HTMLSelectElement
      | HTMLTextAreaElement
      | HTMLButtonElement
    >(
      ".studio-property-control, button[type='submit'], .studio-behavior-row input, .studio-behavior-row select, .studio-behavior-row button",
    ))
      control.disabled = readOnly;
    if (readOnly) {
      addComponent.disabled = true;
      moveUp.disabled = true;
      moveDown.disabled = true;
      duplicate.disabled = true;
      remove.disabled = true;
    }
    for (const editor of [bindingsEditor, eventsEditor, stateEditor])
      editor.read_only = readOnly;
  };
  configureAccess();

  const bufferKey = (surface: string, nodeId?: string) =>
    `${draft?.base_revision ?? state?.revision ?? 0}:${nodeId ? `${nodeId}:` : ""}${surface}`;

  const ensureBuffer = (editor: JsonEditor) => {
    const key = bufferKeys.get(editor);
    const initial = bufferInitial.get(editor);
    if (!key || initial === undefined || bufferModelId === undefined) return;
    if (!(key in bufferValues)) {
      editor.doc = initial;
      return;
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

  const writeBuffer = (
    editor: JsonEditor,
    next: string,
    updateEditor = false,
  ) => {
    if (accessRole === "read") return;
    const key = bufferKeys.get(editor);
    if (!key || bufferModelId === undefined) return;
    const shared = key in bufferValues;
    const current = bufferValues[key] ?? bufferInitial.get(editor) ?? "";
    const splice = spliceText(current, next);
    bufferValues[key] = next;
    if (updateEditor) editor.doc = next;
    if (splice.delete_count || splice.values.length) {
      bufferClient.proposeCrdt(
        bufferModelId,
        shared
          ? [
              {
                kind: "sequence_splice",
                path: [{ kind: "key", key }],
                ...splice,
              },
            ]
          : [{ kind: "map_set", path: [], key, value: next }],
      );
    }
    publishCursor(editor);
  };

  const handleBufferEdit = (editor: JsonEditor, event: Event) => {
    writeBuffer(editor, (event as CustomEvent<{ doc: string }>).detail.doc);
  };

  for (const editor of [bindingsEditor, eventsEditor, stateEditor]) {
    listen(editor, "editor-change", (event) => handleBufferEdit(editor, event));
    listen(editor, "editor-selection", () => publishCursor(editor));
  }

  const bufferClient = new StudioClient();
  const offBufferChange = bufferClient.onChange((change) => {
    const becameReady = !bufferReady;
    bufferReady = true;
    bufferModelId = change.id;
    bufferValues = transport.fromValue(bufferClient.value(change.id)) as Record<
      string,
      string
    >;
    for (const editor of bufferKeys.keys()) ensureBuffer(editor);
    scheduleBehaviorControls();
    renderRemoteCursors();
    if (becameReady && state) render();
  });
  const offAwareness = bufferClient.onAwareness(() => renderRemoteCursors());
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
    if (stopped) return;
    message.textContent = value;
    message.classList.toggle("studio-error", error);
  };

  const refreshHistory = async () => {
    if (stopped) return;
    const request = ++historyRequest;
    if (draft || accessRole === "read") {
      undoEdit.disabled = true;
      redoEdit.disabled = true;
      return;
    }
    const response = await fetch(
      `/api/history?actor_id=${encodeURIComponent(actorId)}`,
    );
    if (!response.ok) return;
    const available = (await response.json()) as {
      can_undo: boolean;
      can_redo: boolean;
    };
    if (stopped || request !== historyRequest || draft) return;
    undoEdit.disabled = !available.can_undo;
    redoEdit.disabled = !available.can_redo;
  };

  const changeHistory = async (action: "undo" | "redo") => {
    if (stopped || !state || draft) return;
    undoEdit.disabled = true;
    redoEdit.disabled = true;
    const response = await fetch(`/api/history/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expected_revision: state.revision,
        actor_id: actorId,
      }),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      showMessage(result.error ?? `${action} failed`, true);
      await refreshHistory();
      return;
    }
    showMessage(`${action === "undo" ? "Undo" : "Redo"} accepted.`);
  };

  listen(undoEdit, "click", () => void changeHistory("undo"));
  listen(redoEdit, "click", () => void changeHistory("redo"));

  const schemaFor = (tag: string): ComponentSchema | undefined =>
    catalog?.components.find((component) => component.tag === tag);

  const submitOperations = async (operations: unknown[]): Promise<boolean> => {
    if (stopped || !state) return false;
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
    if (stopped) return false;
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
    if (stopped || !draft) return;
    const response = await fetch(
      `/api/drafts/${encodeURIComponent(draft.preview_id)}/${action}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actor_id: actorId }),
      },
    );
    const result = (await response.json()) as {
      error?: string;
      revision: number;
    };
    if (!response.ok) {
      showMessage(result.error ?? `Draft ${action} failed`, true);
      return;
    }
    if (action === "discard") {
      draft = undefined;
      showMessage("Draft discarded.");
      render();
      return;
    }
    committedRevision = result.revision;
    showMessage(
      "Draft committed; waiting for the authoritative transports patch.",
    );
    if (
      state &&
      committedRevision !== undefined &&
      state.revision >= committedRevision
    ) {
      draft = undefined;
      committedRevision = undefined;
      render();
    }
  };

  listen(commitDraft, "click", () => void finishDraft("commit"));
  listen(discardDraft, "click", () => void finishDraft("discard"));

  const recoverDraft = async () => {
    if (stopped) return;
    const draftAtStart = draft;
    const response = await fetch(
      `/api/drafts?actor_id=${encodeURIComponent(actorId)}`,
    );
    let recovered: typeof draft;
    if (response.status === 204) recovered = undefined;
    else if (response.ok)
      recovered = (await response.json()) as {
        preview_id: string;
        base_revision: number;
        document: StudioDocument;
      };
    else {
      draftRecoveryReady = true;
      if (state) render();
      return;
    }
    draftRecoveryReady = true;
    if (draft === draftAtStart) draft = recovered;
    if (state) render();
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
    onEdit: (value: string) => void,
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
    control.dataset.dirty = "false";
    const markDirty = () => {
      control.dataset.dirty = "true";
      onEdit(control.value);
    };
    listen(control, "input", markDirty);
    listen(control, "change", markDirty);
    return control;
  };

  const renderProperties = (node: StudioNode) => {
    const pending = pendingPropertyValues.get(node.id);
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
        listen(unset, "click", () => {
          pending?.delete(property.name);
          void postOperations([
            { kind: "unset_prop", id: node.id, name: property.name },
          ]);
        });
        heading.append(unset);
      }
      const control = propertyControl(property, value, (next) => {
        const edits =
          pendingPropertyValues.get(node.id) ?? new Map<string, string>();
        edits.set(property.name, next);
        pendingPropertyValues.set(node.id, edits);
      });
      if (pending?.has(property.name)) {
        control.value = pending.get(property.name)!;
        control.dataset.dirty = "true";
      }
      field.append(heading, control);
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
    renderBehaviorControls(node);
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

  const behaviorField = (
    text: string,
    control: HTMLInputElement | HTMLSelectElement,
  ) => {
    const label = document.createElement("label");
    const caption = document.createElement("span");
    caption.textContent = text;
    label.append(caption, control);
    return label;
  };

  const behaviorInput = (value: string, placeholder: string) => {
    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    input.placeholder = placeholder;
    return input;
  };

  const objectValue = (
    value: JsonValue | undefined,
  ): Record<string, JsonValue> | undefined =>
    value && !Array.isArray(value) && typeof value === "object"
      ? value
      : undefined;

  const commonBinding = (binding: Record<string, JsonValue>) => {
    const keys = Object.keys(binding);
    return (
      keys.every((key) => ["field", "mode", "event"].includes(key)) &&
      typeof binding.field === "string" &&
      ["one-way", "two-way"].includes(String(binding.mode)) &&
      (binding.event === undefined || typeof binding.event === "string")
    );
  };

  type CommonActionKind =
    | "toggle-field"
    | "set-field-event"
    | "set-field-literal";

  const commonActionKind = (
    action: Record<string, JsonValue>,
  ): CommonActionKind | undefined => {
    if (
      action.kind === "toggle-field" &&
      typeof action.field === "string" &&
      Object.keys(action).every((key) => ["kind", "field"].includes(key))
    )
      return "toggle-field";
    if (
      action.kind !== "set-field" ||
      typeof action.field !== "string" ||
      !Object.keys(action).every((key) =>
        ["kind", "field", "value"].includes(key),
      )
    )
      return undefined;
    const value = objectValue(action.value);
    if (!value) return undefined;
    if (
      value.expr === "event" &&
      Object.keys(value).every((key) => ["expr", "path"].includes(key)) &&
      (value.path === undefined || typeof value.path === "string")
    )
      return "set-field-event";
    if (
      value.expr === "lit" &&
      Object.keys(value).every((key) => ["expr", "value"].includes(key)) &&
      Object.prototype.hasOwnProperty.call(value, "value")
    )
      return "set-field-literal";
    return undefined;
  };

  const updateBehaviorMap = (
    editor: JsonEditor,
    value: Record<string, Record<string, JsonValue>>,
  ) => writeBuffer(editor, JSON.stringify(value, null, 2), true);

  const renderBindingRow = (
    name = "",
    binding: Record<string, JsonValue> = {
      field: "",
      mode: "one-way",
    },
  ) => {
    const row = document.createElement("div");
    row.className = "studio-behavior-row studio-binding-row";
    const property = behaviorInput(name, "property");
    property.dataset.studioBindingName = "";
    const field = behaviorInput(String(binding.field ?? ""), "Store field");
    field.dataset.studioBindingField = "";
    const mode = document.createElement("select");
    mode.dataset.studioBindingMode = "";
    mode.append(
      new Option("One-way", "one-way"),
      new Option("Two-way", "two-way"),
    );
    mode.value = String(binding.mode ?? "one-way");
    const event = behaviorInput(String(binding.event ?? ""), "default");
    event.dataset.studioBindingEvent = "";
    const eventField = behaviorField("Change event", event);
    const configureEvent = () => {
      eventField.hidden = mode.value !== "two-way";
    };
    configureEvent();
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    let storedName = name;
    const persist = () => {
      try {
        const nextName = property.value.trim();
        if (!nextName || !field.value.trim()) return;
        const next = jsonObject(bindingsEditor.doc, "Bindings");
        if (storedName && storedName !== nextName) delete next[storedName];
        next[nextName] = {
          field: field.value.trim(),
          mode: mode.value,
          ...(event.value.trim() ? { event: event.value.trim() } : {}),
        };
        storedName = nextName;
        updateBehaviorMap(bindingsEditor, next);
      } catch (error) {
        showMessage(
          error instanceof Error ? error.message : "Invalid binding",
          true,
        );
      }
    };
    for (const control of [property, field, event])
      listen(control, "change", persist);
    listen(mode, "change", () => {
      configureEvent();
      persist();
    });
    listen(remove, "click", () => {
      if (!storedName) {
        row.remove();
        return;
      }
      try {
        const next = jsonObject(bindingsEditor.doc, "Bindings");
        delete next[storedName];
        updateBehaviorMap(bindingsEditor, next);
        row.remove();
      } catch (error) {
        showMessage(
          error instanceof Error ? error.message : "Invalid binding",
          true,
        );
      }
    });
    row.append(
      behaviorField("Property", property),
      behaviorField("Store field", field),
      behaviorField("Direction", mode),
      eventField,
      remove,
    );
    return row;
  };

  const renderEventRow = (
    name = "",
    action: Record<string, JsonValue> = {
      kind: "toggle-field",
      field: "",
    },
  ) => {
    const row = document.createElement("div");
    row.className = "studio-behavior-row studio-event-row";
    const eventName = behaviorInput(name, "event");
    eventName.dataset.studioEventName = "";
    const kind = document.createElement("select");
    kind.dataset.studioActionKind = "";
    kind.append(
      new Option("Toggle Store field", "toggle-field"),
      new Option("Set field from event", "set-field-event"),
      new Option("Set field to value", "set-field-literal"),
    );
    kind.value = commonActionKind(action) ?? "toggle-field";
    const field = behaviorInput(String(action.field ?? ""), "Store field");
    field.dataset.studioActionField = "";
    const detail = behaviorInput("", "");
    detail.dataset.studioActionValue = "";
    const value = objectValue(action.value);
    if (kind.value === "set-field-event")
      detail.value = String(value?.path ?? "");
    if (kind.value === "set-field-literal")
      detail.value = JSON.stringify(value?.value ?? null);
    const detailField = behaviorField("Event path", detail);
    const configureDetail = () => {
      detailField.hidden = kind.value === "toggle-field";
      detailField.querySelector("span")!.textContent =
        kind.value === "set-field-literal" ? "JSON value" : "Event path";
      detail.placeholder =
        kind.value === "set-field-literal" ? '"value"' : "optional path";
      if (kind.value === "set-field-literal" && !detail.value)
        detail.value = "null";
    };
    configureDetail();
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    let storedName = name;
    const persist = () => {
      try {
        const nextName = eventName.value.trim();
        if (!nextName || !field.value.trim()) return;
        const next = jsonObject(eventsEditor.doc, "Events");
        if (storedName && storedName !== nextName) delete next[storedName];
        const actionKind = kind.value as CommonActionKind;
        next[nextName] =
          actionKind === "toggle-field"
            ? { kind: "toggle-field", field: field.value.trim() }
            : {
                kind: "set-field",
                field: field.value.trim(),
                value:
                  actionKind === "set-field-event"
                    ? {
                        expr: "event",
                        ...(detail.value.trim()
                          ? { path: detail.value.trim() }
                          : {}),
                      }
                    : {
                        expr: "lit",
                        value: JSON.parse(detail.value) as JsonValue,
                      },
              };
        storedName = nextName;
        updateBehaviorMap(eventsEditor, next);
      } catch (error) {
        showMessage(
          error instanceof Error ? error.message : "Invalid action",
          true,
        );
      }
    };
    for (const control of [eventName, field, detail])
      listen(control, "change", persist);
    listen(kind, "change", () => {
      configureDetail();
      persist();
    });
    listen(remove, "click", () => {
      if (!storedName) {
        row.remove();
        return;
      }
      try {
        const next = jsonObject(eventsEditor.doc, "Events");
        delete next[storedName];
        updateBehaviorMap(eventsEditor, next);
        row.remove();
      } catch (error) {
        showMessage(
          error instanceof Error ? error.message : "Invalid action",
          true,
        );
      }
    });
    row.append(
      behaviorField("Event", eventName),
      behaviorField("Action", kind),
      behaviorField("Store field", field),
      detailField,
      remove,
    );
    return row;
  };

  const renderedBehaviorBuffers = new Map<
    JsonEditor,
    { key: string | undefined; source: string }
  >();
  const shouldRenderBehavior = (editor: JsonEditor, controls: HTMLElement) => {
    const previous = renderedBehaviorBuffers.get(editor);
    const key = bufferKeys.get(editor);
    if (
      previous?.key === key &&
      (previous?.source === editor.doc ||
        controls.contains(document.activeElement))
    )
      return false;
    renderedBehaviorBuffers.set(editor, { key, source: editor.doc });
    return true;
  };
  for (const controls of [bindingControls, eventControls])
    listen(controls, "focusout", scheduleBehaviorControls);

  renderBehaviorControls = (node: StudioNode) => {
    let bindings = node.bindings;
    let events = node.events;
    try {
      bindings = jsonObject(bindingsEditor.doc, "Bindings");
    } catch {}
    try {
      events = jsonObject(eventsEditor.doc, "Events");
    } catch {}
    const simpleBindings = Object.entries(bindings).filter(([, binding]) =>
      commonBinding(binding),
    );
    const simpleEvents = Object.entries(events).filter(([, action]) =>
      Boolean(commonActionKind(action)),
    );
    if (shouldRenderBehavior(bindingsEditor, bindingControls))
      bindingControls.replaceChildren(
        ...simpleBindings.map(([name, binding]) =>
          renderBindingRow(name, binding),
        ),
      );
    if (shouldRenderBehavior(eventsEditor, eventControls))
      eventControls.replaceChildren(
        ...simpleEvents.map(([name, action]) => renderEventRow(name, action)),
      );
    const complexBindings =
      Object.keys(bindings).length - simpleBindings.length;
    const complexEvents = Object.keys(events).length - simpleEvents.length;
    bindingJsonHelp.textContent = complexBindings
      ? `${complexBindings} advanced binding ${complexBindings === 1 ? "is" : "are"} available only in this complete validated map.`
      : "Edit the complete validated binding map.";
    eventJsonHelp.textContent = complexEvents
      ? `${complexEvents} advanced action ${complexEvents === 1 ? "is" : "are"} available only in this complete validated map.`
      : "Edit the complete validated action map.";
  };

  listen(addBinding, "click", () => {
    bindingControls.append(renderBindingRow());
    bindingControls
      .querySelector<HTMLInputElement>(".studio-binding-row:last-child input")
      ?.focus();
  });
  listen(addEvent, "click", () => {
    eventControls.append(renderEventRow());
    eventControls
      .querySelector<HTMLInputElement>(".studio-event-row:last-child input")
      ?.focus();
  });

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
    moveDown.disabled =
      !location ||
      location.index === location.parent.slots[location.slot].length - 1;
    duplicate.disabled = !location;
    configureAccess();
    renderTree();
  };

  const renderTree = () => {
    const active = activeDocument();
    if (!active) return;
    treeStore.set("treeItems", flattenTree(active.root, selectedId));
  };

  listen(tree, "click", (event) => {
    const target =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-studio-tree-id]")
        : null;
    const id = target?.dataset.studioTreeId;
    if (id) select(id);
  });

  const render = () => {
    const active = activeDocument();
    if (stopped || !active || !state) return;
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
    void refreshHistory();
    activateBuffer(
      stateEditor,
      bufferKey("state"),
      JSON.stringify(active.state, null, 2),
    );
    connection.textContent = isReady() ? "Live" : "Loading";
    if (pendingSelection && findNode(active.root, pendingSelection)) {
      selectedId = pendingSelection;
      pendingSelection = undefined;
    }
    if (selectedId && findNode(active.root, selectedId)) select(selectedId);
    else select(active.root.id);
  };

  listen(form, "submit", (event) => {
    event.preventDefault();
    if (!selectedId) return;
    const operations: unknown[] = [];
    try {
      const node = findNode(activeDocument()!.root, selectedId);
      if (!node) throw new Error("Selected component no longer exists.");
      for (const control of propertyFields.querySelectorAll<PropertyControl>(
        ".studio-property-control",
      )) {
        const name = control.dataset.studioProp!;
        const authored = Object.prototype.hasOwnProperty.call(node.props, name);
        if (control.dataset.dirty !== "true" && !authored) continue;
        const value = readControl(control);
        if (value === undefined) {
          if (authored) {
            operations.push({ kind: "unset_prop", id: selectedId, name });
          }
        } else if (JSON.stringify(value) !== JSON.stringify(node.props[name])) {
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
      pendingPropertyValues.delete(selectedId);
      for (const control of propertyFields.querySelectorAll<PropertyControl>(
        ".studio-property-control[data-dirty='true']",
      ))
        control.dataset.dirty = "false";
      showMessage("No property changes to apply.");
      return;
    }
    const submittedId = selectedId;
    void postOperations(operations).then((accepted) => {
      if (!accepted) return;
      pendingPropertyValues.delete(submittedId);
      if (selectedId !== submittedId) return;
      for (const control of propertyFields.querySelectorAll<PropertyControl>(
        ".studio-property-control[data-dirty='true']",
      ))
        control.dataset.dirty = "false";
    });
  });

  listen(applyState, "click", () => {
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

  listen(addComponent, "click", () => {
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

  listen(moveUp, "click", () => {
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

  listen(moveDown, "click", () => {
    if (!selectedId) return;
    const location = findLocation(activeDocument()!.root, selectedId);
    if (
      !location ||
      location.index === location.parent.slots[location.slot].length - 1
    )
      return;
    void postOperations([
      {
        kind: "move",
        id: selectedId,
        parent_id: location.parent.id,
        slot: location.slot,
        after_id: location.parent.slots[location.slot][location.index + 1].id,
      },
    ]);
  });

  const duplicateNode = (source: StudioNode): StudioNode => {
    const ids = new Map<string, string>();
    let fallbackId = 0;
    const collect = (node: StudioNode) => {
      const suffix =
        globalThis.crypto?.randomUUID?.() ??
        `${Date.now().toString(36)}-${fallbackId++}`;
      ids.set(node.id, `${node.id}-copy-${suffix}`);
      for (const children of Object.values(node.slots))
        for (const child of children) collect(child);
    };
    collect(source);
    const references = (value: JsonValue): JsonValue => {
      if (Array.isArray(value)) return value.map(references);
      if (!value || typeof value !== "object") return value;
      const mapped = Object.fromEntries(
        Object.entries(value).map(([name, child]) => [name, references(child)]),
      ) as Record<string, JsonValue>;
      if (
        mapped.ref === "id" &&
        typeof mapped.id === "string" &&
        ids.has(mapped.id)
      )
        mapped.id = ids.get(mapped.id)!;
      return mapped;
    };
    const clone = (node: StudioNode): StudioNode => ({
      id: ids.get(node.id)!,
      tag: node.tag,
      key: null,
      props: structuredClone(node.props),
      bindings: structuredClone(node.bindings),
      events: references(node.events) as Record<
        string,
        Record<string, JsonValue>
      >,
      event_options: structuredClone(node.event_options ?? {}),
      slots: Object.fromEntries(
        Object.entries(node.slots).map(([slot, children]) => [
          slot,
          children.map(clone),
        ]),
      ),
    });
    return clone(source);
  };

  listen(duplicate, "click", () => {
    if (!selectedId) return;
    const active = activeDocument();
    if (!active) return;
    const location = findLocation(active.root, selectedId);
    const selected = findNode(active.root, selectedId);
    if (!location || !selected) return;
    const copy = duplicateNode(selected);
    pendingSelection = copy.id;
    void postOperations([
      {
        kind: "insert",
        parent_id: location.parent.id,
        slot: location.slot,
        after_id: selectedId,
        node: copy,
      },
    ]).then((accepted) => {
      if (!accepted) pendingSelection = undefined;
    });
  });

  listen(remove, "click", () => {
    if (selectedId) void postOperations([{ kind: "remove", id: selectedId }]);
  });

  listen(
    canvas,
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
      if (stopped) return;
      catalogReady = true;
      renderComponentOptions();
      if (state) render();
    })
    .catch((error: unknown) => {
      showMessage(
        error instanceof Error
          ? error.message
          : "Component catalog failed to load.",
        true,
      );
    });

  void fetch(`/api/access?actor_id=${encodeURIComponent(actorId)}`)
    .then(async (response) => {
      if (!response.ok) throw new Error("Studio access lookup failed.");
      const access = (await response.json()) as {
        role: "read" | "edit" | "admin";
      };
      if (stopped) return;
      accessRole = access.role;
      accessReady = true;
      if (state) render();
      else configureAccess();
      void refreshHistory();
    })
    .catch((error: unknown) => {
      showMessage(
        error instanceof Error ? error.message : "Studio access lookup failed.",
        true,
      );
    });

  const client = new StudioClient();
  const offConnect = client.onConnect(() => void recoverDraft());
  const offChange = client.onChange((change) => {
    state = transport.fromValue(client.value(change.id)) as StudioState;
    if (
      committedRevision !== undefined &&
      state.revision >= committedRevision
    ) {
      draft = undefined;
      committedRevision = undefined;
    }
    render();
  });
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const link = client.run(`${scheme}://${location.host}/ws`);

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      listeners.abort();
      offConnect();
      offChange();
      offBufferChange();
      offAwareness();
      if (bufferModelId !== undefined)
        bufferClient.setAwareness(bufferModelId, null);
      link.stop();
      bufferLink.stop();
      client.close();
      bufferClient.close();
      if (root) runtime.unmount(root);
      runtime.unmount(treeRoot);
    },
  };
}
