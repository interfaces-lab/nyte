import type { Page } from "@playwright/test";
import { WARM_REPLY } from "../src/host/fixtures/e2e-models.ts";
import {
  board,
  boardStill,
  CONTINUE,
  expect,
  openFile,
  selectFrom,
  test,
  workbench,
  zoomBoard,
} from "./desk.ts";
import type { Desk } from "./desk.ts";
import { chatPane, composer, messages, openNewChat, sidebar } from "./ui.ts";

test.use({ opened: ["Code", "Studio"] });

async function rest(page: Page): Promise<void> {
  await page.mouse.move(1, 300);
}

async function openTool(page: Page, kind: string): Promise<void> {
  await page.getByRole("button", { name: "New workbench tab" }).click();
  await page
    .getByRole("menu", { name: "New workbench tab" })
    .getByRole("menuitem", { name: kind })
    .click();
}

for (const theme of ["dark", "light"] as const)
  test(`every function of Nyte, Code and Studio, ${theme}`, ({ desk }) =>
    everyFunction(desk, theme));

async function everyFunction(desk: Desk, theme: "dark" | "light"): Promise<void> {
  test.setTimeout(300_000);
  const nyte = desk.page("Nyte");
  const code = desk.page("Code");
  const studio = desk.page("Studio");
  const controls = board(studio).locator('[data-frame="Controls"]');
  const zoom = workbench(studio).getByRole("button", { name: /^\d+%$/u });

  await desk.setTheme(theme);
  await expect(board(studio).locator('[data-frame="Tonight"]')).toBeVisible();
  await boardStill(studio);

  await test.step("what each window opens on", async () => {
    await rest(studio);
    await desk.capture(studio, "01-studio-board");
    await desk.capture(code, "02-code-editor");
    await desk.capture(nyte, "03-nyte-chat");
  });

  await test.step("pointing at and selecting an element on the board", async () => {
    await desk.front(studio);
    await controls.getByText("Continue", { exact: true }).hover();
    await expect(board(studio).locator('[data-ring="hover"]')).toBeVisible();
    await desk.capture(studio, "04-studio-hover");
    await controls.getByText("Not tonight", { exact: true }).click();
    await expect(board(studio).locator('[data-ring="you"]')).toBeVisible();
    await boardStill(studio);
    await rest(studio);
    await desk.capture(studio, "05-studio-selection");
  });

  await test.step("typing words on the board", async () => {
    await controls.getByText("CONTROLS", { exact: true }).dblclick();
    await studio.keyboard.type("Maybe later");
    await expect(controls.getByText("Maybe later", { exact: true })).toBeVisible();
    await boardStill(studio);
    await desk.capture(studio, "06-studio-typing");
    await studio.keyboard.press("Enter");
    await boardStill(studio);
  });

  await test.step("moving a frame by its label", async () => {
    const label = board(studio).locator('[data-label][data-name="Phase card · night"]');
    const box = await label.boundingBox();

    if (box === null) throw new Error("The Phase card · night label is not on screen.");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    await studio.mouse.move(x, y);
    await studio.mouse.down();
    await studio.mouse.move(x + 60, y + 10, { steps: 6 });
    await studio.mouse.move(x + 150, y + 30, { steps: 8 });
    await expect(board(studio).locator("[data-place]")).toBeVisible();
    await desk.capture(studio, "07-studio-moving-frame");
    await studio.mouse.up();
    await boardStill(studio);
  });

  await test.step("going to a screen, and seeing the board by the other light", async () => {
    const before = await zoom.textContent();

    await workbench(studio)
      .getByRole("navigation", { name: "Designs" })
      .getByRole("button", { name: "Tonight", exact: true })
      .click();
    await expect(zoom).not.toHaveText(before ?? "");
    await boardStill(studio);
    await rest(studio);
    await desk.capture(studio, "08-studio-screen");
    await workbench(studio)
      .getByRole("button", { name: theme === "dark" ? "Day" : "Night", exact: true })
      .click();
    await rest(studio);
    await desk.capture(studio, "09-studio-other-light");
    await workbench(studio)
      .getByRole("button", { name: theme === "dark" ? "Night" : "Day", exact: true })
      .click();
    await zoomBoard(studio, "Zoom to Fit");
  });

  await test.step("asking the agent beside the board", async () => {
    await studio.getByRole("button", { name: "Restore split view" }).click();
    await composer(studio).fill("/warm");
    await boardStill(studio);
    await rest(studio);
    await desk.capture(studio, "10-studio-agent-composer");
    await composer(studio).press("Enter");
    await expect(board(studio).locator('[data-glow="on"]').first()).toBeAttached();
    await expect(messages(studio).getByText(WARM_REPLY)).toBeVisible();
    await expect(chatPane(studio).getByRole("button", { name: "Stop response" })).toBeHidden();
    await rest(studio);
    await desk.capture(studio, "11-studio-agent-change");
  });

  await test.step("the editor on a design, with a selection, and on the agent's change", async () => {
    await desk.front(code);
    await openFile(code, "design/controls.jsx");

    await rest(code);
    await desk.capture(code, "12-code-file");
    await selectFrom(code, CONTINUE);
    await desk.capture(code, "13-code-selection");
    const sheet = await openFile(code, "design/tokens.css");

    await expect(sheet).toContainText("--accent: #b4532a;");
    await rest(code);
    await desk.capture(code, "14-code-agent-change");
  });

  await test.step("Code's Changes and Terminal", async () => {
    await openTool(code, "Changes");
    await expect(
      workbench(code).getByRole("tabpanel", { name: "Changes" }).getByRole("status"),
    ).toBeVisible();
    await rest(code);
    await desk.capture(code, "15-code-changes");
    await openTool(code, "Terminal");
    await expect(workbench(code).getByRole("textbox", { name: "Terminal input" })).toBeVisible();
    await desk.capture(code, "16-code-terminal");
  });

  await test.step("Nyte's chats and its workbench", async () => {
    await desk.front(nyte);
    await rest(nyte);
    await desk.capture(nyte, "17-nyte-chat");
    await openNewChat(nyte);
    await desk.capture(nyte, "18-nyte-new-chat");
    await nyte.getByRole("button", { name: "Open workbench panel", exact: true }).click();
    await expect(workbench(nyte)).toBeVisible();
    await rest(nyte);
    await desk.capture(nyte, "19-nyte-workbench");
  });

  await test.step("every window without the sidebar, which they share", async () => {
    await studio.getByRole("button", { name: "Hide sidebar", exact: true }).click();

    for (const shown of [
      { page: studio, name: "20-studio-no-sidebar" },
      { page: code, name: "21-code-no-sidebar" },
      { page: nyte, name: "22-nyte-no-sidebar" },
    ]) {
      await expect(sidebar(shown.page)).toBeHidden();
      await rest(shown.page);
      await desk.capture(shown.page, shown.name);
    }
  });
}
