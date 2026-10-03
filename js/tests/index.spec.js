import { test, expect } from "./fixtures.js";

test.describe("Studio document compiler", () => {
  test("adds stable editor identity and compiles nested slots", async ({
    page,
  }) => {
    await page.goto("/dist/index.html");
    const compiled = await page.evaluate(async () => {
      const { compileNode } = await import("/dist/esm/index.js");
      return compileNode(
        {
          id: "root",
          tag: "main",
          props: { title: "Pilot" },
          bindings: { title: { field: "title", mode: "one-way" } },
          events: { click: { kind: "toggle-field", field: "open" } },
          event_options: {
            click: { capture: true, once: true, passive: false },
          },
          slots: {
            default: [
              {
                id: "child",
                tag: "button",
                props: { textContent: "Edit" },
                bindings: {},
                events: {},
                slots: {},
              },
            ],
          },
        },
        (value) => value,
      );
    });

    expect(compiled.key).toBe("root");
    expect(compiled.props["data-spaday-studio-id"]).toBe("root");
    expect(compiled.bindings.title.field).toBe("title");
    expect(compiled.events.click.kind).toBe("toggle-field");
    expect(compiled.event_options.click).toEqual({
      capture: true,
      once: true,
      passive: false,
    });
    expect(compiled.slots.default[0].event_options).toBeUndefined();
    expect(compiled.slots.default[0].key).toBe("child");
    expect(compiled.slots.default[0].props.textContent).toBe("Edit");
  });

  test("previews privately and commits without remounting the canvas", async ({
    page,
    studioURL,
  }) => {
    let releaseDraftRecovery;
    const draftRecoveryReleased = new Promise((resolve) => {
      releaseDraftRecovery = resolve;
    });
    await page.route("**/api/drafts?actor_id=*", async (route) => {
      await draftRecoveryReleased;
      await route.continue();
    });
    await page.goto(studioURL);
    await expect(
      page.getByRole("button", { name: "Preview changes" }),
    ).toBeDisabled();
    const recovered = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        response.url().includes("/api/drafts?actor_id="),
    );
    releaseDraftRecovery();
    await recovered;
    await expect(page.locator("#connection-status")).toHaveText("Live");
    const initialRevision = Number(
      (await page.locator("#revision-status").textContent()).match(/\d+/)[0],
    );
    await page.locator('[data-spaday-studio-id="app"]').evaluate((element) => {
      element.dataset.identityProbe = "preserved";
    });

    await page.locator('[data-spaday-studio-id="headline"]').click();
    await page
      .locator('[data-studio-prop="textContent"]')
      .fill("Ship the interface while it is running.");
    const externalEdit = await page.request.post(
      `${studioURL}/api/operations`,
      {
        data: {
          expected_revision: initialRevision,
          actor_id: "external-test",
          operations: [{ kind: "set_title", value: "External update" }],
        },
      },
    );
    expect(externalEdit.ok()).toBe(true);
    await expect(page.locator("#revision-status")).toHaveText(
      `Revision ${initialRevision + 1}`,
    );
    await expect(page.locator('[data-studio-prop="textContent"]')).toHaveValue(
      "Ship the interface while it is running.",
    );
    const previewResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/drafts"),
    );
    await page.getByRole("button", { name: "Preview changes" }).click();
    await expect(page.locator("#studio-message")).toHaveText(
      "Private draft updated. Commit when the preview is ready.",
    );
    const previewResult = await previewResponse;
    expect(previewResult.ok()).toBe(true);
    const previewDocument = await previewResult.json();
    expect(
      previewDocument.document.root.slots.default.find(
        (node) => node.id === "headline",
      ).props.textContent,
    ).toBe("Ship the interface while it is running.");

    await expect(page.locator("#revision-status")).toHaveText(
      `Revision ${initialRevision + 1}`,
    );
    await expect(page.locator("#preview-status")).toHaveText("Private draft");
    await expect(page.locator('[data-spaday-studio-id="app"]')).toHaveAttribute(
      "data-identity-probe",
      "preserved",
    );
    await page.getByRole("button", { name: "Commit" }).click();
    await expect(page.locator("#revision-status")).toHaveText(
      `Revision ${initialRevision + 2}`,
    );
    await expect(
      page.getByRole("link", { name: "Export Python" }),
    ).toHaveAttribute("download", "spaday_app.py");

    const rootTreeButton = page.locator('[data-studio-tree-id="app"]');
    await rootTreeButton.evaluate((element) => {
      element.dataset.identityProbe = "preserved";
    });
    await rootTreeButton.click();
    await page.locator("#component-type").selectOption("p");
    await page.getByRole("button", { name: "Add component" }).click();
    await expect(page.locator("#preview-status")).toHaveText("Private draft");
    await page.getByRole("button", { name: "Commit" }).click();
    await expect(page.locator("#revision-status")).toHaveText(
      `Revision ${initialRevision + 3}`,
    );
    await expect(
      page.locator("#canvas p", { hasText: "New p" }).last(),
    ).toBeVisible();
    await expect(page.locator('[data-spaday-studio-id="app"]')).toHaveAttribute(
      "data-identity-probe",
      "preserved",
    );
    await expect(rootTreeButton).toHaveAttribute(
      "data-identity-probe",
      "preserved",
    );

    await rootTreeButton.click();
    await page.locator("#component-type").selectOption("input");
    await page.getByRole("button", { name: "Add component" }).click();
    await page.locator('[data-studio-prop="type"]').fill("checkbox");
    await page.locator('[data-studio-prop="checked"]').selectOption("true");
    await page.getByRole("button", { name: "Preview changes" }).click();
    await page.getByRole("button", { name: "Commit" }).click();
    await expect(page.locator("#revision-status")).toHaveText(
      `Revision ${initialRevision + 4}`,
    );
    await expect(page.locator("#canvas input").last()).toBeChecked();
  });

  test("runs authored state, bindings, and actions through one persistent Store", async ({
    page,
    studioURL,
  }) => {
    await page.goto(studioURL);
    await expect(page.locator("#connection-status")).toHaveText("Live");
    await page.locator('[data-spaday-studio-id="headline"]').click();

    const replaceEditor = async (selector, value) => {
      await page.locator(selector).evaluate((editor, next) => {
        const view = editor.view;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: next },
        });
      }, value);
    };
    await page.getByText("Runtime state", { exact: true }).click();
    await replaceEditor(
      "#state-editor",
      JSON.stringify({ query: "Bound" }, null, 2),
    );
    await page.getByRole("button", { name: "Preview state" }).click();
    await expect(page.locator("#preview-status")).toHaveText("Private draft");
    await page.getByText("Bindings", { exact: true }).click();
    await page.getByRole("button", { name: "Add binding" }).click();
    const binding = page.locator(".studio-binding-row");
    await binding.locator("[data-studio-binding-name]").fill("textContent");
    await binding.locator("[data-studio-binding-field]").fill("query");
    await binding.locator("[data-studio-binding-field]").press("Tab");

    await page.getByText("Events", { exact: true }).click();
    await page.getByRole("button", { name: "Add event" }).click();
    const action = page.locator(".studio-event-row");
    await action.locator("[data-studio-event-name]").fill("click");
    await action
      .locator("[data-studio-action-kind]")
      .selectOption("set-field-literal");
    await action.locator("[data-studio-action-field]").fill("query");
    await action.locator("[data-studio-action-value]").fill('"Clicked"');
    await action.locator("[data-studio-action-value]").press("Tab");
    const changesResponse = page.waitForResponse((response) =>
      response.url().endsWith("/api/drafts"),
    );
    await page.getByRole("button", { name: "Preview changes" }).click();
    const changes = await (await changesResponse).json();
    expect(
      changes.document.root.slots.default.find((node) => node.id === "headline")
        .bindings.textContent,
    ).toEqual({ field: "query", mode: "one-way" });
    expect(
      changes.document.root.slots.default.find((node) => node.id === "headline")
        .events.click,
    ).toEqual({
      kind: "set-field",
      field: "query",
      value: { expr: "lit", value: "Clicked" },
    });

    await expect(page.locator('[data-spaday-studio-id="headline"]')).toHaveText(
      "Bound",
    );
    await page.getByRole("button", { name: "Commit" }).click();
    await page.locator('[data-spaday-studio-id="headline"]').click();
    await expect(page.locator('[data-spaday-studio-id="headline"]')).toHaveText(
      "Clicked",
    );
  });

  test("undoes and redoes the actor's latest accepted edit", async ({
    page,
    studioURL,
  }) => {
    await page.goto(studioURL);
    await expect(page.locator("#connection-status")).toHaveText("Live");
    const initialRevision = Number(
      (await page.locator("#revision-status").textContent()).match(/\d+/)[0],
    );
    await page.locator('[data-spaday-studio-id="intro"]').click();
    const before = await page
      .locator('[data-spaday-studio-id="intro"]')
      .textContent();
    await page.locator('[data-studio-prop="textContent"]').fill("History test");
    await page.getByRole("button", { name: "Preview changes" }).click();
    await page.getByRole("button", { name: "Commit" }).click();
    await expect(page.locator("#revision-status")).toHaveText(
      `Revision ${initialRevision + 1}`,
    );
    await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator("#revision-status")).toHaveText(
      `Revision ${initialRevision + 2}`,
    );
    await expect(page.locator('[data-spaday-studio-id="intro"]')).toHaveText(
      before,
    );
    await expect(page.getByRole("button", { name: "Redo" })).toBeEnabled();

    await page.getByRole("button", { name: "Redo" }).click();
    await expect(page.locator("#revision-status")).toHaveText(
      `Revision ${initialRevision + 3}`,
    );
    await expect(page.locator('[data-spaday-studio-id="intro"]')).toHaveText(
      "History test",
    );
  });

  test("moves components in both directions and duplicates subtrees", async ({
    page,
    studioURL,
  }) => {
    await page.goto(studioURL);
    await expect(page.locator("#connection-status")).toHaveText("Live");
    await page.locator('[data-spaday-studio-id="intro"]').click();
    const childIds = () =>
      page
        .locator("#canvas main > *")
        .evaluateAll((elements) =>
          elements.map((element) =>
            element.getAttribute("data-spaday-studio-id"),
          ),
        );
    const beforeMove = await childIds();
    const introIndex = beforeMove.indexOf("intro");
    const movedDown = [...beforeMove];
    [movedDown[introIndex], movedDown[introIndex + 1]] = [
      movedDown[introIndex + 1],
      movedDown[introIndex],
    ];

    await page.getByRole("button", { name: "Move down" }).click();
    await expect(page.locator("#preview-status")).toHaveText("Private draft");
    await expect.poll(childIds).toEqual(movedDown);
    await page.getByRole("button", { name: "Move up" }).click();
    await expect.poll(childIds).toEqual(beforeMove);

    const sourceText = await page
      .locator('[data-spaday-studio-id="intro"]')
      .textContent();
    await page.getByRole("button", { name: "Duplicate" }).click();
    await expect(page.locator("#component-label")).toHaveValue(
      /p · intro-copy-/,
    );
    const copyId = (await page.locator("#component-label").inputValue()).split(
      " · ",
    )[1];
    await expect(
      page.locator(`[data-spaday-studio-id="${copyId}"]`),
    ).toHaveText(sourceText);
    await page.getByRole("button", { name: "Discard" }).click();
  });

  test("collaborates in bounded CRDT buffers before a private commit", async ({
    context,
    page,
    studioURL,
  }) => {
    const peer = await context.newPage();
    await Promise.all([page.goto(studioURL), peer.goto(studioURL)]);
    await Promise.all([
      expect(page.locator("#connection-status")).toHaveText("Live"),
      expect(peer.locator("#connection-status")).toHaveText("Live"),
    ]);
    await page.locator('[data-spaday-studio-id="headline"]').click();
    await peer.locator('[data-spaday-studio-id="headline"]').click();

    const initialRevision = await page
      .locator("#revision-status")
      .textContent();
    await page.locator("#events-editor").evaluate((editor) => {
      const view = editor.view;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: "{" },
      });
    });
    await expect
      .poll(() =>
        peer.locator("#events-editor").evaluate((editor) => editor.doc),
      )
      .toBe("{");
    await page.getByRole("button", { name: "Preview changes" }).click();
    await expect(page.locator("#studio-message")).toHaveClass(/studio-error/);
    await expect(page.locator("#revision-status")).toHaveText(initialRevision);

    const action = JSON.stringify(
      { click: { kind: "toggle-field", field: "selected" } },
      null,
      2,
    );
    await page.locator("#events-editor").evaluate((editor, value) => {
      const view = editor.view;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        selection: { anchor: value.length },
      });
    }, action);

    await expect
      .poll(() =>
        peer.locator("#events-editor").evaluate((editor) => editor.doc),
      )
      .toBe(action);
    await expect
      .poll(() =>
        peer
          .locator("#events-editor")
          .evaluate((editor) => editor.remote_cursors.length),
      )
      .toBeGreaterThan(0);

    const revision = await page.locator("#revision-status").textContent();
    const previewResponse = peer.waitForResponse((response) =>
      response.url().endsWith("/api/drafts"),
    );
    await peer.getByRole("button", { name: "Preview changes" }).click();
    expect((await previewResponse).ok()).toBe(true);
    await expect(peer.locator("#preview-status")).toHaveText("Private draft");
    await expect(page.locator("#preview-status")).toHaveText("Canonical");
    await expect(page.locator("#revision-status")).toHaveText(revision);

    await peer.getByRole("button", { name: "Commit" }).click();
    await expect(page.locator("#revision-status")).not.toHaveText(revision);
    await peer.close();
  });

  test("keeps unfinished behavior controls during shared buffer updates", async ({
    context,
    page,
    studioURL,
  }) => {
    const peer = await context.newPage();
    await Promise.all([page.goto(studioURL), peer.goto(studioURL)]);
    await expect(page.locator("#connection-status")).toHaveText("Live");
    await expect(peer.locator("#connection-status")).toHaveText("Live");
    await page.locator('[data-spaday-studio-id="headline"]').click();
    await peer.locator('[data-spaday-studio-id="headline"]').click();
    await page.getByText("Bindings", { exact: true }).click();
    await page.getByRole("button", { name: "Add binding" }).click();
    await page.locator("[data-studio-binding-name]").fill("textContent");
    await page.getByText("Events", { exact: true }).click();
    await page.getByRole("button", { name: "Add event" }).click();
    const name = page.locator("[data-studio-event-name]");
    await name.fill("click");
    await peer.locator("#state-editor").evaluate((editor) => {
      editor.view.dispatch({
        changes: {
          from: 0,
          to: editor.view.state.doc.length,
          insert: '{"query":"Remote"}',
        },
      });
    });
    await expect
      .poll(() =>
        page.locator("#state-editor").evaluate((editor) => editor.doc),
      )
      .toBe('{"query":"Remote"}');
    await expect(name).toHaveValue("click");
    await expect(name).toBeFocused();
    await expect(page.locator("[data-studio-binding-name]")).toHaveValue(
      "textContent",
    );

    await page
      .locator("[data-studio-action-kind]")
      .selectOption("set-field-literal");
    await page.locator("[data-studio-action-field]").fill("query");
    const value = page.locator("[data-studio-action-value]");
    await value.fill('"Unfinished');
    await expect
      .poll(() =>
        peer.locator("#events-editor").evaluate((editor) => editor.doc),
      )
      .toContain('"click"');
    await peer.locator("#events-editor").evaluate((editor) => {
      const events = JSON.parse(editor.doc);
      events.mouseover = { kind: "toggle-field", field: "hovered" };
      editor.view.dispatch({
        changes: {
          from: 0,
          to: editor.view.state.doc.length,
          insert: JSON.stringify(events, null, 2),
        },
      });
    });
    await expect
      .poll(() =>
        page.locator("#events-editor").evaluate((editor) => editor.doc),
      )
      .toContain('"mouseover"');
    await expect(value).toHaveValue('"Unfinished');
    await expect(value).toBeFocused();
    await value.fill('"Clicked"');
    await value.press("Tab");
    await page.getByRole("button", { name: "Preview changes" }).click();
    await expect(page.locator("[data-studio-event-name]")).toHaveCount(2);
    await expect
      .poll(() =>
        peer
          .locator("#events-editor")
          .evaluate((editor) => JSON.parse(editor.doc)),
      )
      .toEqual({
        click: {
          kind: "set-field",
          field: "query",
          value: { expr: "lit", value: "Clicked" },
        },
        mouseover: { kind: "toggle-field", field: "hovered" },
      });
    const remoteAction = page.locator(".studio-event-row").last();
    await expect(remoteAction.locator("[data-studio-event-name]")).toHaveValue(
      "mouseover",
    );
    await remoteAction.getByRole("button", { name: "Remove" }).click();
    await expect(page.locator("[data-studio-event-name]")).toHaveCount(1);
    await peer.close();
  });

  test("recovers a private draft after a browser refresh", async ({
    page,
    studioURL,
  }) => {
    await page.goto(studioURL);
    await expect(page.locator("#connection-status")).toHaveText("Live");
    await page.locator('[data-spaday-studio-id="headline"]').click();
    await page
      .locator('[data-studio-prop="textContent"]')
      .fill("Recovered draft");
    const previewResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/api/drafts"),
    );
    await page.getByRole("button", { name: "Preview changes" }).click();
    await expect(page.locator("#studio-message")).toHaveText(
      "Private draft updated. Commit when the preview is ready.",
    );
    expect((await previewResponse).ok()).toBe(true);
    await expect(page.locator("#preview-status")).toHaveText("Private draft");

    await page.reload();

    await expect(page.locator("#preview-status")).toHaveText("Private draft");
    await expect(page.locator('[data-spaday-studio-id="headline"]')).toHaveText(
      "Recovered draft",
    );
    await page.getByRole("button", { name: "Discard" }).click();
    await expect(page.locator("#preview-status")).toHaveText("Canonical");
  });
});
