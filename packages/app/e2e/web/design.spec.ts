import { appendFile, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { WARM_PROMPT, WARM_REPLY } from "../server/design-edit.ts";
import { DESIGN_SAMPLE } from "../utils/design-sample.ts";
import { designWorkspace, openDesignTab, pairedPage } from "../utils/design-workspace.ts";

const HOSTILE_STYLES = [
  "",
  "* { outline: 0 !important; color: red !important; box-shadow: none !important; }",
  ":root, * { --nyte-stroke-accent: red !important; --nyte-content-tertiary: red !important }",
  "",
].join("\n");

const RED = "rgb(255, 0, 0)";

const sample = (path: string): Promise<string> => readFile(join(DESIGN_SAMPLE, path), "utf8");

test("the Design tab draws the workspace's designs in the board's sandbox, selects them, and keeps its chrome from their styles", async ({
  browser,
}) => {
  await using stack = new AsyncDisposableStack();
  const workspace = await designWorkspace(stack);
  const { page, errors } = await pairedPage(browser, stack);
  const tab = await openDesignTab(page, workspace);
  const { board, list, workbench } = tab;

  await test.step("every sheet draws its frames inside the sandboxed board, not in the app's document", async () => {
    await expect(page.getByTitle("Design board", { exact: true })).toHaveAttribute(
      "sandbox",
      "allow-scripts",
    );
    await expect(tab.frame("Controls")).toBeVisible();
    await expect(tab.frame("Phase card")).toBeVisible();
    await expect(tab.label("Tonight · night")).toBeAttached();
    await expect(tab.frame("Tonight").getByText("Low tide, slow water")).toBeVisible();
    await expect(page.getByText("Low tide, slow water")).toHaveCount(0);
  });

  await test.step("a click selects on the board and in the design list, and a double click on words from a prop says they are read-only", async () => {
    await workbench.getByRole("button", { name: "Show designs", exact: true }).click();
    await expect(list).toBeVisible();
    await tab.frame("Controls").getByText("Not tonight").click();
    await expect(board.locator('[data-ring="you"]')).toBeVisible();
    await expect(list.getByRole("button", { name: "Controls", exact: true })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await tab.frame("Controls").getByText("Not tonight").dblclick();
    await expect(board.getByText("Read-only", { exact: true })).toBeVisible();
  });

  await test.step("hostile design CSS reaches the designs but not the board's label and ring", async () => {
    await workbench.getByRole("button", { name: /^\d+%$/u }).click();
    await page.getByRole("menuitem", { name: "Zoom to Fit", exact: true }).click();
    await expect(tab.stage).not.toHaveAttribute("data-moving");
    const title = tab.frame("Tonight").getByText("Tonight", { exact: true });
    await title.click();
    const ring = board.locator('[data-ring="you"]').first();
    await expect(ring).toBeVisible();

    const chrome = async (): Promise<readonly string[]> => [
      await tab.label("Tonight").evaluate((node) => getComputedStyle(node).color),
      await ring.evaluate((node) => getComputedStyle(node).outlineStyle),
      await ring.evaluate((node) => getComputedStyle(node).outlineColor),
    ];

    const before = await chrome();
    expect(before[1]).toBe("solid");
    expect(before).not.toContain(RED);
    await appendFile(workspace.file("design/tokens.css"), HOSTILE_STYLES);
    await expect.poll(() => title.evaluate((node) => getComputedStyle(node).color)).toBe(RED);
    await expect(ring).toBeVisible();
    expect(await chrome()).toEqual(before);
  });

  expect(errors).toEqual({ pageErrors: [], consoleErrors: [] });
});

test("retyped words on the board reach the file once typing pauses, and Escape leaves the file as it was", async ({
  browser,
}) => {
  await using stack = new AsyncDisposableStack();
  const workspace = await designWorkspace(stack);
  const { page, errors } = await pairedPage(browser, stack);
  const tab = await openDesignTab(page, workspace);
  const tonight = tab.frame("Tonight");
  const before = await sample("screens/tonight.jsx");

  await test.step("Escape puts the words back", async () => {
    await tonight.getByText("Low tide, slow water", { exact: true }).dblclick();
    await page.keyboard.type("Rough water");
    await expect(tonight.getByText("Rough water", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tonight.getByText("Low tide, slow water", { exact: true })).toBeVisible();
    await expect(tonight.getByText("Rough water", { exact: true })).toHaveCount(0);
  });

  await test.step("a pause in typing writes only the new words to the file, and nothing of the escaped ones", async () => {
    await tonight.getByText("NIGHT SOUNDS · 42 MIN", { exact: true }).dblclick();
    await page.keyboard.type("Night sounds");
    await expect
      .poll(() => readFile(workspace.file("design/screens/tonight.jsx"), "utf8"))
      .toBe(before.replace("NIGHT SOUNDS · 42 MIN", "Night sounds"));
    await expect(tonight.getByText("Night sounds", { exact: true })).toBeVisible();
  });

  expect(errors).toEqual({ pageErrors: [], consoleErrors: [] });
});

test("dragging a frame by its label writes its new place to the file when it is let go", async ({
  browser,
}) => {
  await using stack = new AsyncDisposableStack();
  const workspace = await designWorkspace(stack);
  const { page, errors } = await pairedPage(browser, stack);
  const tab = await openDesignTab(page, workspace);
  const file = workspace.file("design/blocks/phase-card.jsx");
  const before = await sample("blocks/phase-card.jsx");

  await tab.workbench.getByRole("button", { name: "Show designs", exact: true }).click();
  await tab.list.getByRole("button", { name: "Phase card", exact: true }).click();
  await expect(tab.stage).not.toHaveAttribute("data-moving");
  const label = tab.label("Phase card");
  await expect(label).toBeVisible();
  const box = await label.boundingBox();

  if (box === null) throw new Error("The Phase card label is not on screen.");
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 60, from.y + 30, { steps: 6 });
  await page.mouse.move(from.x + 120, from.y + 60, { steps: 6 });
  const place = tab.board.locator("[data-place]");
  await expect(place).toHaveText(/^[1-9]\d*, [1-9]\d*$/u);
  const [x, y] = ((await place.textContent()) ?? "").split(", ");
  expect(await readFile(file, "utf8"), "nothing is written while the frame is held").toBe(before);

  await page.mouse.up();
  await expect
    .poll(() => readFile(file, "utf8"))
    .toBe(
      before.replace(
        'data-frame="Phase card" data-x="0" data-y="0"',
        `data-frame="Phase card" data-x="${x ?? ""}" data-y="${y ?? ""}"`,
      ),
    );
  await expect(place).toHaveCount(0);
  expect(errors).toEqual({ pageErrors: [], consoleErrors: [] });
});

test("a design file the agent edits lights the change on the board, in the board's colours", async ({
  browser,
}) => {
  await using stack = new AsyncDisposableStack();
  const workspace = await designWorkspace(stack);
  const { page, errors } = await pairedPage(browser, stack);
  const tab = await openDesignTab(page, workspace);
  const glow = tab.board.locator('[data-glow="on"]').first();
  const tokens = workspace.file("design/tokens.css");

  await appendFile(tokens, HOSTILE_STYLES);
  await expect
    .poll(() =>
      tab
        .frame("Tonight")
        .getByText("Tonight", { exact: true })
        .evaluate((node) => getComputedStyle(node).color),
    )
    .toBe(RED);
  await expect(glow).toHaveCount(0);

  const composer = page.getByRole("combobox", { name: "Message" });
  await composer.fill(WARM_PROMPT);
  await composer.press("Enter");
  await expect(
    page.getByRole("region", { name: "Active chat pane" }).getByText(WARM_REPLY, { exact: true }),
  ).toBeVisible();
  expect(await readFile(tokens, "utf8")).toBe(
    `${(await sample("tokens.css"))
      .replace("--accent: #3f58a8;", "--accent: #b4532a;")
      .replace("--accent: #c1d0f6;", "--accent: #ffcf9a;")}${HOSTILE_STYLES}`,
  );
  await expect(glow).toBeAttached();
  expect(await glow.evaluate((node) => getComputedStyle(node).outlineColor)).not.toBe(RED);
  expect(errors).toEqual({ pageErrors: [], consoleErrors: [] });
});

test("a design file that throws shows its error in the design list, and the other designs still draw", async ({
  browser,
}) => {
  await using stack = new AsyncDisposableStack();

  const workspace = await designWorkspace(stack, {
    "design/screens/broken.jsx": [
      "// A screen that throws while it loads.",
      'throw new Error("The broken design threw.");',
      "export default function Broken() { return null; }",
      "",
    ].join("\n"),
  });

  const { page, errors } = await pairedPage(browser, stack);
  const tab = await openDesignTab(page, workspace);

  await tab.workbench.getByRole("button", { name: "Show designs", exact: true }).click();
  const row = tab.list.getByRole("button", { name: /^broken\b/u });
  await expect(row).toBeVisible();
  await expect(
    row.getByRole("img", {
      name: /^design\/screens\/broken\.jsx:2:\d+: The broken design threw\.$/u,
    }),
  ).toBeVisible();
  await expect(tab.frame("Controls")).toBeVisible();
  await expect(tab.frame("Phase card")).toBeVisible();
  await expect(tab.frame("Tonight").getByText("Low tide, slow water")).toBeVisible();

  for (const name of ["Tonight", "Phase card", "Controls"])
    await expect(
      tab.list.getByRole("button", { name, exact: true }).getByRole("img"),
      `${name} shows no error`,
    ).toHaveCount(0);
  expect(errors).toEqual({ pageErrors: [], consoleErrors: [] });
});

test("an edit on the board that meets a change on disk keeps the person's words, and both ways out of the conflict work", async ({
  browser,
}) => {
  await using stack = new AsyncDisposableStack();
  const workspace = await designWorkspace(stack);
  const { context, page, errors } = await pairedPage(browser, stack);
  const tab = await openDesignTab(page, workspace);
  const tonight = tab.frame("Tonight");
  const file = workspace.file("design/screens/tonight.jsx");
  const before = await sample("screens/tonight.jsx");
  const notice = tab.workbench.getByRole("alert");
  let meanwhile: ((text: string) => string) | undefined;

  await context.route("**/documents.write", async (route) => {
    const change = meanwhile;
    meanwhile = undefined;

    if (change !== undefined) await writeFile(file, change(await readFile(file, "utf8")));
    await route.continue();
  });

  const retype = async (words: string, typed: string): Promise<void> => {
    await tonight.getByText(words, { exact: true }).dblclick();
    await page.keyboard.type(typed);
    await page.keyboard.press("Enter");
  };

  await test.step("the conflict notice names the file, and the board keeps the person's words", async () => {
    meanwhile = (text) => text.replace("NIGHT SOUNDS · 42 MIN", "NIGHT SOUNDS · 40 MIN");
    await retype("Low tide, slow water", "Rough water");
    await expect(notice).toHaveText("design/screens/tonight.jsx changed on disk.");
    await expect(tonight.getByText("Rough water", { exact: true })).toBeVisible();
    await expect(tonight.getByText("NIGHT SOUNDS · 42 MIN", { exact: true })).toBeVisible();
    expect(await readFile(file, "utf8")).toBe(
      before.replace("NIGHT SOUNDS · 42 MIN", "NIGHT SOUNDS · 40 MIN"),
    );
  });

  await test.step("Overwrite with Mine writes the person's text over the file", async () => {
    await tab.workbench.getByRole("button", { name: "Overwrite with Mine", exact: true }).click();
    await expect(notice).toHaveCount(0);
    await expect
      .poll(() => readFile(file, "utf8"))
      .toBe(before.replace("Low tide, slow water", "Rough water"));
  });

  await test.step("Use File on Disk drops the person's text for the file's", async () => {
    meanwhile = (text) => text.replace("Rough water", "Calm water");
    await retype("NIGHT SOUNDS · 42 MIN", "Night sounds");
    await expect(notice).toHaveText("design/screens/tonight.jsx changed on disk.");
    await expect(tonight.getByText("Night sounds", { exact: true })).toBeVisible();
    await tab.workbench.getByRole("button", { name: "Use File on Disk", exact: true }).click();
    await expect(notice).toHaveCount(0);
    await expect(tonight.getByText("Calm water", { exact: true })).toBeVisible();
    await expect(tonight.getByText("NIGHT SOUNDS · 42 MIN", { exact: true })).toBeVisible();
    expect(await readFile(file, "utf8")).toBe(before.replace("Low tide, slow water", "Calm water"));
  });

  expect(errors).toEqual({ pageErrors: [], consoleErrors: [] });
});

test("Add to Chat puts the selected element in the composer as a design reference", async ({
  browser,
}) => {
  await using stack = new AsyncDisposableStack();
  const workspace = await designWorkspace(stack);
  const { page, errors } = await pairedPage(browser, stack);
  const tab = await openDesignTab(page, workspace);
  const add = tab.workbench.getByRole("button", { name: "Add to Chat", exact: true });
  const form = page.getByRole("form", { name: "Message", exact: true });

  await expect(add, "nothing is selected yet").toHaveCount(0);
  await tab.frame("Controls").getByText("Not tonight").click();
  await add.click();
  await expect(form.getByRole("button", { name: "Remove Controls", exact: true })).toBeVisible();
  await form.getByText("Controls", { exact: true }).hover();
  await expect(page.getByLabel("Controls in design/controls.jsx", { exact: true })).toHaveText(
    '<Button label="Not tonight" quiet />',
  );
  expect(errors).toEqual({ pageErrors: [], consoleErrors: [] });
});

test("a page frame shows its address and loads nothing, selected or not, where there is no browser", async ({
  browser,
}) => {
  await using stack = new AsyncDisposableStack();
  const requests: string[] = [];

  const server = createServer((request, response) => {
    requests.push(request.url ?? "");
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end("<!doctype html><title>Live page</title>");
  });

  stack.defer(async () => {
    server.closeAllConnections();
    await new Promise<void>((closed) => server.close(() => closed()));
  });
  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
  const port = Value.Parse(Type.Object({ port: Type.Number() }), server.address()).port;
  const address = `127.0.0.1:${String(port)}/`;

  const workspace = await designWorkspace(stack, {
    "design/pages.jsx": [
      "export default function Pages() {",
      `  return <div data-frame="Live page" data-x="0" data-y="900" data-page="http://${address}" style={{ width: 800, height: 600 }} />;`,
      "}",
      "",
    ].join("\n"),
  });

  const { page, errors } = await pairedPage(browser, stack);
  const tab = await openDesignTab(page, workspace);
  const frame = tab.board.locator('[data-frame-box]:has([data-name="Live page"])');

  await tab.workbench.getByRole("button", { name: "Show designs", exact: true }).click();
  await tab.list.getByRole("button", { name: "Live page", exact: true }).click();
  await expect(tab.stage).not.toHaveAttribute("data-moving");
  await expect(frame).toHaveAttribute("data-page-state", "still");
  await expect(frame.getByText(address, { exact: true })).toBeVisible();
  await expect(tab.workbench.getByRole("button", { name: "Design Mode" })).toHaveCount(0);

  await tab.frame("Live page").click();
  await expect(frame).toHaveAttribute("data-page-state", "live");
  await expect(frame.getByText(address, { exact: true })).toBeVisible();
  await expect(
    tab.workbench.locator('img[src^="data:image/"]'),
    "no still of the page, which sits outside the accessibility tree",
  ).toHaveCount(0);
  expect(requests).toEqual([]);
  expect(errors).toEqual({ pageErrors: [], consoleErrors: [] });
});
