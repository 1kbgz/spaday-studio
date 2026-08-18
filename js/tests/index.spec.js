import { test, expect } from "@playwright/test";

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
          slots: {
            default: [
              {
                id: "child",
                tag: "button",
                props: { textContent: "Edit" },
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
    expect(compiled.slots.default[0].key).toBe("child");
    expect(compiled.slots.default[0].props.textContent).toBe("Edit");
  });

  test("applies an authoritative edit without remounting the canvas", async ({
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
    await page.getByRole("button", { name: "Apply properties" }).click();

    await expect(page.locator("#revision-status")).toHaveText(
      `Revision ${initialRevision + 1}`,
    );
    await expect(page.locator('[data-spaday-studio-id="headline"]')).toHaveText(
      "Ship the interface while it is running.",
    );
    await expect(page.locator('[data-spaday-studio-id="app"]')).toHaveAttribute(
      "data-identity-probe",
      "preserved",
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
    await expect(page.locator("#revision-status")).toHaveText(
      `Revision ${initialRevision + 2}`,
    );
    await expect(page.locator("#canvas p", { hasText: "New p" })).toBeVisible();
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
    await expect(page.locator("#revision-status")).toHaveText(
      `Revision ${initialRevision + 3}`,
    );
    await page.locator('[data-studio-prop="type"]').fill("checkbox");
    await page.locator('[data-studio-prop="checked"]').selectOption("true");
    await page.getByRole("button", { name: "Apply properties" }).click();
    await expect(page.locator("#revision-status")).toHaveText(
      `Revision ${initialRevision + 4}`,
    );
    await expect(page.locator("#canvas input")).toBeChecked();
  });
});
