import { test, expect } from "@playwright/test";

test.describe("Studio document compiler", () => {
  test.describe.configure({ mode: "serial" });
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
    expect(compiled.slots.default[0].key).toBe("child");
    expect(compiled.slots.default[0].props.textContent).toBe("Edit");
  });

  test("previews privately and commits without remounting the canvas", async ({
    page,
  }) => {
    await page.goto("http://127.0.0.1:8020");
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
    await page.getByRole("button", { name: "Preview changes" }).click();

    await expect(page.locator("#revision-status")).toHaveText(
      `Revision ${initialRevision}`,
    );
    await expect(page.locator("#preview-status")).toHaveText("Private draft");
    await expect(page.locator('[data-spaday-studio-id="headline"]')).toHaveText(
      "Ship the interface while it is running.",
    );
    await expect(page.locator('[data-spaday-studio-id="app"]')).toHaveAttribute(
      "data-identity-probe",
      "preserved",
    );
    await page.getByRole("button", { name: "Commit" }).click();
    await expect(page.locator("#revision-status")).toHaveText(
      `Revision ${initialRevision + 1}`,
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
      `Revision ${initialRevision + 2}`,
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
      `Revision ${initialRevision + 3}`,
    );
    await expect(page.locator("#canvas input").last()).toBeChecked();
  });

  test("runs authored state, bindings, and actions through one persistent Store", async ({
    page,
  }) => {
    await page.goto("http://127.0.0.1:8020");
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

    await expect(page.locator('[data-spaday-studio-id="headline"]')).toHaveText(
      "Bound",
    );
    await page.getByRole("button", { name: "Commit" }).click();
    await page.locator('[data-spaday-studio-id="headline"]').click();
    await expect(page.locator('[data-spaday-studio-id="headline"]')).toHaveText(
      "Clicked",
    );
  });

  test("collaborates in bounded CRDT buffers before a private commit", async ({
    context,
    page,
  }) => {
    const peer = await context.newPage();
    await Promise.all([
      page.goto("http://127.0.0.1:8020"),
      peer.goto("http://127.0.0.1:8020"),
    ]);
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
});
