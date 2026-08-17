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
  const text = requiredElement<HTMLTextAreaElement>("#prop-text");
  const style = requiredElement<HTMLTextAreaElement>("#prop-style");
  const message = requiredElement<HTMLElement>("#studio-message");
  const revision = requiredElement<HTMLElement>("#revision-status");
  const preview = requiredElement<HTMLElement>("#preview-status");
  const connection = requiredElement<HTMLElement>("#connection-status");
  const addChild = requiredElement<HTMLButtonElement>("#add-child");
  const moveUp = requiredElement<HTMLButtonElement>("#move-up");
  const remove = requiredElement<HTMLButtonElement>("#remove-component");

  let state: StudioState | undefined;
  let currentTree: WireNode | undefined;
  let root: Element | undefined;
  let selectedId: string | undefined;

  const activeDocument = (): StudioDocument | undefined =>
    state?.preview ?? state?.document;

  const showMessage = (value: string, error = false) => {
    message.textContent = value;
    message.classList.toggle("studio-error", error);
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
    text.value =
      typeof selected.props.textContent === "string"
        ? selected.props.textContent
        : "";
    style.value =
      typeof selected.props.style === "string" ? selected.props.style : "";
    remove.disabled = selected.id === active.root.id;
    const location = findLocation(active.root, selected.id);
    moveUp.disabled = !location || location.index === 0;
    renderTree();
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
    if (selectedId && findNode(active.root, selectedId)) select(selectedId);
    else select(active.root.id);
  };

  const postOperations = async (operations: unknown[]) => {
    if (!state) return;
    if (state.preview) {
      showMessage(
        "Discard or commit the active MCP preview before editing in the inspector.",
        true,
      );
      return;
    }
    const response = await fetch("/api/operations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expected_revision: state.revision, operations }),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      showMessage(result.error ?? "Edit failed", true);
      return;
    }
    showMessage(
      "Edit accepted; waiting for the authoritative transports patch.",
    );
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!selectedId) return;
    void postOperations([
      {
        kind: "set_prop",
        id: selectedId,
        name: "textContent",
        value: text.value,
      },
      { kind: "set_prop", id: selectedId, name: "style", value: style.value },
    ]);
  });

  addChild.addEventListener("click", () => {
    if (!selectedId) return;
    const parent = findNode(activeDocument()!.root, selectedId);
    const index = parent?.slots.default?.length ?? 0;
    const id = `text-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
    void postOperations([
      {
        kind: "insert",
        parent_id: selectedId,
        slot: "default",
        index,
        node: {
          id,
          tag: "p",
          props: {
            textContent: "New live content",
            style: "margin: 1rem 0; color: #bae6fd",
          },
          slots: {},
        },
      },
    ]);
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
