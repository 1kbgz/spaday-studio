import { test, expect } from "./fixtures.js";

async function exposeHandle(page, studioURL) {
  await page
    .context()
    .grantPermissions(["local-network-access"], { origin: studioURL });
  await page.route(`${studioURL}/`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace(
        "connectStudio({ runtime, transport });",
        "window.startStudio = () => connectStudio({ runtime, transport }); window.studioHandle = window.startStudio();",
      ),
    });
  });
  await page.addInitScript(() => {
    window.studioSockets = [];
    const Socket = window.WebSocket;
    window.WebSocket = class extends Socket {
      constructor(...args) {
        super(...args);
        window.studioSockets.push(this);
      }
    };
  });
}

test("stop disposes both mounted trees and closes reconnected sockets", async ({
  page,
  studioURL,
}) => {
  await exposeHandle(page, studioURL);
  await page.goto(studioURL);
  await expect(page.locator("#connection-status")).toHaveText("Live");
  await page.evaluate(() => window.studioSockets[0].close());
  await expect
    .poll(() => page.evaluate(() => window.studioSockets.length))
    .toBe(3);
  await expect
    .poll(() => page.evaluate(() => window.studioSockets[2].readyState))
    .toBe(1);
  const disposed = await page.evaluate(async () => {
    const runtime = await import("/js/cdn/index.js");
    const disposed = [];
    for (const id of ["canvas", "component-tree"]) {
      runtime.attachController(
        document.getElementById(id).firstElementChild,
        "test",
        () => () => disposed.push(id),
      );
    }
    window.studioHandle.stop();
    window.studioHandle.stop();
    return disposed;
  });
  expect(disposed).toEqual(["canvas", "component-tree"]);
  await expect(page.locator("#canvas > *")).toHaveCount(0);
  await expect(page.locator("#component-tree > *")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.studioSockets.every((socket) => socket.readyState === 3),
      ),
    )
    .toBe(true);
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => window.studioSockets.length)).toBe(3);

  const drafts = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/drafts"))
      drafts.push(request);
  });
  await page.evaluate(() => {
    window.studioHandle = window.startStudio();
  });
  await expect(page.locator("#canvas > *")).toHaveCount(1);
  await expect(page.locator("#connection-status")).toHaveText("Live");
  await page.locator('[data-studio-tree-id="headline"]').click();
  await page.locator('[data-studio-prop="textContent"]').fill("After restart");
  await page.getByRole("button", { name: "Preview changes" }).click();
  await expect(
    page.locator('#canvas [data-spaday-studio-id="headline"]'),
  ).toHaveText("After restart");
  expect(drafts).toHaveLength(1);
  await page.evaluate(() => window.studioHandle.stop());
});

test("late startup responses cannot remount a stopped Studio", async ({
  page,
  studioURL,
}) => {
  await exposeHandle(page, studioURL);
  let releaseCatalog;
  const released = new Promise((resolve) => {
    releaseCatalog = resolve;
  });
  await page.route("**/api/catalog", async (route) => {
    const response = await route.fetch();
    await released;
    await route.fulfill({ response });
  });
  await page.goto(studioURL);
  await expect(page.locator("#canvas > *")).toHaveCount(1);
  await page.evaluate(() => window.studioHandle.stop());
  const response = page.waitForResponse("**/api/catalog");
  releaseCatalog();
  await response;
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await expect(page.locator("#canvas > *")).toHaveCount(0);
  await expect(page.locator("#component-tree > *")).toHaveCount(0);
});

test("listener options execute in the canvas and survive duplication", async ({
  page,
  studioURL,
}) => {
  await page.goto(studioURL);
  await expect(page.locator("#connection-status")).toHaveText("Live");
  const options = { capture: true, once: true, passive: false };
  const response = await page.request.post(`${studioURL}/api/operations`, {
    data: {
      expected_revision: 0,
      operations: [
        { kind: "set_state", name: "clicked", value: false },
        {
          kind: "insert",
          parent_id: "app",
          node: {
            id: "listener-button",
            tag: "button",
            bindings: { textContent: { field: "clicked", mode: "one-way" } },
            events: { click: { kind: "toggle-field", field: "clicked" } },
            event_options: { click: options },
          },
        },
      ],
    },
  });
  expect(response.ok()).toBe(true);
  const button = page.locator(
    '#canvas [data-spaday-studio-id="listener-button"]',
  );
  await expect(button).toHaveText("false");
  await button.click();
  await expect(button).toHaveText("true");
  await button.click();
  await expect(button).toHaveText("true");
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(
    page.locator('#canvas [data-spaday-studio-id^="listener-button-copy-"]'),
  ).toHaveCount(1);
  const actorId = await page.evaluate(() =>
    sessionStorage.getItem("spaday-studio-actor"),
  );
  const draft = await (
    await page.request.get(
      `${studioURL}/api/drafts?actor_id=${encodeURIComponent(actorId)}`,
    )
  ).json();
  const copy = draft.document.root.slots.default.find((node) =>
    node.id.startsWith("listener-button-copy-"),
  );
  expect(copy.event_options).toEqual({ click: options });
});

test("a stopped instance cannot clear edits after a late draft response", async ({
  page,
  studioURL,
}) => {
  await exposeHandle(page, studioURL);
  await page.goto(studioURL);
  await expect(page.locator("#connection-status")).toHaveText("Live");
  let releaseDraft;
  let draftAccepted;
  const released = new Promise((resolve) => {
    releaseDraft = resolve;
  });
  const accepted = new Promise((resolve) => {
    draftAccepted = resolve;
  });
  await page.route("**/api/drafts", async (route) => {
    const response = await route.fetch();
    draftAccepted();
    await released;
    await route.fulfill({ response });
  });
  await page.locator('[data-studio-tree-id="headline"]').click();
  const input = page.locator('[data-studio-prop="textContent"]');
  await input.fill("First edit");
  await page.getByRole("button", { name: "Preview changes" }).click();
  await accepted;
  await page.evaluate(() => {
    window.studioHandle.stop();
    window.studioHandle = window.startStudio();
  });
  await expect(
    page.locator('#canvas [data-spaday-studio-id="headline"]'),
  ).toHaveText("First edit");
  await page.locator('[data-studio-tree-id="headline"]').click();
  await input.fill("New unfinished edit");
  const response = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/api/drafts"),
  );
  releaseDraft();
  await response;
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await expect(input).toHaveValue("New unfinished edit");
  await expect(input).toHaveAttribute("data-dirty", "true");
  await page.evaluate(() => window.studioHandle.stop());
});
