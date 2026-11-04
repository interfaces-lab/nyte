import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { FIXTURES } from "./baseline.ts";
import { expect, test } from "./fixtures.ts";
import {
  chatPane,
  clearComposer,
  composer,
  messages,
  openChat,
  openNewChat,
  send,
  setTheme,
} from "./ui.ts";

const run = promisify(execFile);

test.use({ chapter: "composer" });

const DOT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test("the composer journey", async ({ desktop }) => {
  const { page } = desktop;

  await test.step("typing enables Send and clearing disables it again", async () => {
    await openNewChat(page);
    const field = composer(page);
    const sendButton = page.getByRole("button", { name: "Send message" });
    await expect(field).toBeFocused();
    await field.fill("Not yet sent");
    await expect(sendButton).toBeEnabled();
    await clearComposer(page);
    await expect(sendButton).toBeDisabled();
    await expect(field).toHaveAttribute("data-placeholder", /^Ask Nyte/u);
  });

  await test.step("Shift+Enter breaks the line instead of sending", async () => {
    const field = composer(page);
    await field.fill("First line");
    await field.press("End");
    await field.press("Shift+Enter");
    await page.keyboard.type("Second line");
    await expect(field.locator("br")).toHaveCount(1);
    await expect(field).toHaveText("First lineSecond line");
    await expect(chatPane(page).getByRole("region", { name: "Messages" })).toHaveCount(0);
    await clearComposer(page);
  });

  await test.step("a draft survives switching chats and coming back", async () => {
    await openChat(page, FIXTURES.composer);
    const field = composer(page);
    await expect(field).toHaveAttribute("data-placeholder", "Add a follow-up");
    await field.fill("A draft left behind");
    await openChat(page, FIXTURES.alpha);
    await expect(composer(page)).toHaveText("");
    await openChat(page, FIXTURES.composer);
    await expect(composer(page)).toHaveText("A draft left behind");
    await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
    await clearComposer(page);
  });

  await test.step("a slash opens the skills list and Escape closes it", async () => {
    const field = composer(page);
    await field.pressSequentially("/");
    await expect(field).toHaveAttribute("aria-expanded", "true");
    const skills = page.getByRole("listbox", { name: "Commands and skills" });
    await expect(skills.getByRole("option")).toHaveText([
      /^rename/u,
      /^websearch-key/u,
      /^compact/u,
      /^sidechat/u,
    ]);
    await expect(
      skills.getByRole("option", { name: "compact Summarize the chat to free up context" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(skills).toBeHidden();
    await expect(field).toHaveText("/");
    await clearComposer(page);
  });

  await test.step("Add to message opens the attachment picker", async () => {
    await chatPane(page).getByRole("button", { name: "Add to message" }).click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });

  await test.step("the model button names the scripted catalog", async () => {
    await chatPane(page).getByRole("button", { name: "Scripted" }).click();

    const picker = page
      .getByRole("dialog")
      .or(page.getByRole("menu"))
      .or(page.getByRole("listbox"));

    await expect(picker.first()).toBeVisible();
    await expect(picker.first()).toContainText("Scripted");
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
  });

  await test.step("Ctrl+/ opens the model picker, and closing it returns to the composer", async () => {
    const field = composer(page);
    await field.focus();
    await page.keyboard.press("ControlOrMeta+/");
    const picker = page.getByRole("menu");
    await expect(picker).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(picker).toBeHidden();
    await expect(field).toBeFocused();
  });

  await test.step("pasting with no field focused lands in the composer", async () => {
    await desktop.application.evaluate(({ clipboard }) =>
      clipboard.writeText("Pasted from nowhere"),
    );
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await page.keyboard.press("ControlOrMeta+v");
    await expect(composer(page)).toBeFocused();
    await expect(composer(page)).toHaveText("Pasted from nowhere");
    await clearComposer(page);
  });

  await test.step("while a response runs, the placeholder names what Enter does", async () => {
    await send(page, "/hold");
    const stop = chatPane(page).getByRole("button", { name: "Stop response" });
    await expect(stop).toBeVisible();
    await expect(composer(page)).toHaveAttribute("data-placeholder", "Steer without stopping");
    await stop.click();
    await expect(stop).toBeHidden();
    await expect(composer(page)).toHaveAttribute("data-placeholder", "Add a follow-up");
  });

  await test.step("Ctrl+Alt+Up and Down walk this chat's prompts, then return to the draft", async () => {
    const field = composer(page);
    await field.fill("Not sent yet");
    await field.press("Control+Alt+ArrowUp");
    await expect(field).toHaveText("/hold");
    await field.press("Control+Alt+ArrowUp");
    await expect(field).toHaveText("A first draft");
    await field.press("Control+Alt+ArrowDown");
    await expect(field).toHaveText("/hold");
    await field.press("Control+Alt+ArrowDown");
    await expect(field).toHaveText("Not sent yet");
    await clearComposer(page);
  });
});

test("an attached image starts a new chat with its first message", async ({ desktop }) => {
  const { page, application, home } = desktop;
  const folder = join(home, "project");
  await mkdir(folder);
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, folder);
  await page.keyboard.press("ControlOrMeta+o");
  await openNewChat(page);
  await expect(page.getByRole("button", { name: "project", exact: true })).toBeVisible();
  const pane = chatPane(page);
  const chooser = page.waitForEvent("filechooser");
  await pane.getByRole("button", { name: "Add to message" }).click();
  await page.getByRole("menuitem", { name: "Attach Files…" }).click();
  await (await chooser).setFiles({ name: "dot.png", mimeType: "image/png", buffer: DOT_PNG });
  await expect(
    pane
      .getByRole("list", { name: "Image attachments" })
      .getByRole("button", { name: "Preview dot.png" }),
  ).toBeVisible();
  await send(page, "Describe the dot");
  const log = messages(page);
  await expect(log.getByRole("paragraph")).toHaveText([
    "Describe the dot",
    `Echo: Describe the dot[File Image 1, ${String(DOT_PNG.byteLength)} bytes, image/png]`,
  ]);
  await expect(log.getByRole("img", { name: "Image 1" })).toBeVisible();
});

test("the footer under the composer shows where the chat runs, and its branch menu checks out and creates branches", async ({
  desktop,
}, testInfo) => {
  const { page, application, home } = desktop;
  const repo = join(home, "repo");

  const git = async (...args: readonly string[]): Promise<string> =>
    (await run("git", [...args], { cwd: repo })).stdout.trim();

  await mkdir(repo);
  await git("init", "-q", "-b", "main");
  await git("config", "user.name", "Ada");
  await git("config", "user.email", "ada@example.com");
  await git("config", "commit.gpgsign", "false");
  await writeFile(join(repo, "a.txt"), "main\n");
  await git("add", "-A");
  await git("commit", "-q", "-m", "first");
  await git("switch", "-q", "-c", "topic");
  await writeFile(join(repo, "a.txt"), "topic\n");
  await git("commit", "-q", "-am", "topic");
  await git("switch", "-q", "main");
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, repo);
  await page.keyboard.press("ControlOrMeta+o");
  await openNewChat(page);

  const pane = chatPane(page);
  const footer = pane.locator("[data-composer-footer]");
  const branch = (name: string) => footer.getByRole("button", { name, exact: true });
  const search = page.getByRole("combobox", { name: "Search branches" });

  await test.step("the new-chat row and the chat's footer name the same branch and machine", async () => {
    await expect(pane.getByRole("button", { name: "main", exact: true })).toBeVisible();
    await send(page, "Hello from the repo");
    await expect(messages(page).getByText("Echo: Hello from the repo")).toBeVisible();
    await expect(branch("main")).toBeVisible();
    await expect(footer.getByRole("button", { name: "This Mac" })).toBeVisible();
  });

  await test.step("the title bar no longer shows the folder or branch", async () => {
    const banner = page.getByRole("banner");
    await expect(banner.getByText("Hello from the repo").first()).toBeVisible();
    await expect(banner.getByText("repo", { exact: true })).toHaveCount(0);
    await expect(banner.getByText("main", { exact: true })).toHaveCount(0);
  });

  await test.step("picking a branch from the search checks it out", async () => {
    await branch("main").click();
    await expect(search).toBeFocused();
    await expect(page.getByRole("option")).toHaveText(["main", "topic", "Create Branch…"]);
    await search.pressSequentially("top");
    await expect(page.getByRole("option")).toHaveText(["topic", "Create Branch…"]);
    await search.press("Enter");
    await expect(branch("topic")).toBeVisible();
    expect(await git("branch", "--show-current")).toBe("topic");
  });

  await test.step("Create Branch… creates a branch from the search and switches to it", async () => {
    await branch("topic").click();
    await search.pressSequentially("feature");
    await expect(page.getByText("No branches found")).toBeVisible();
    await page.getByRole("option", { name: "Create Branch…" }).click();
    const name = page.getByRole("textbox", { name: "New branch name" });
    await expect(name).toHaveValue("feature");
    await name.press("Enter");
    await expect(branch("feature")).toBeVisible();
    expect(await git("branch", "--show-current")).toBe("feature");
  });

  await test.step("the footer row is 26 px tall with 20 px segments in light and dark", async () => {
    const measured = await footer.evaluate((row) => ({
      row: row.getBoundingClientRect().height,
      segments: [...row.querySelectorAll("button")].map((button) => button.offsetHeight),
    }));

    expect(measured.row).toBe(26);
    expect(measured.segments).toEqual([20, 20]);

    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });

    for (const scheme of ["light", "dark"] as const) {
      await setTheme(desktop, scheme);
      await page.mouse.move(0, 0);
      await pane
        .locator("[data-composer-region]")
        .screenshot({ path: testInfo.outputPath(`composer-footer-${scheme}.png`) });
      await page
        .getByRole("banner")
        .screenshot({ path: testInfo.outputPath(`title-bar-${scheme}.png`) });
    }

    await testInfo.attach("footer-proportions", {
      body: JSON.stringify(measured),
      contentType: "application/json",
    });
  });

  await test.step("git's refusal to switch shows its own message", async () => {
    await writeFile(join(repo, "a.txt"), "local edit\n");
    await branch("feature").click();
    await search.pressSequentially("main");
    await search.press("Enter");
    await expect(page.getByText("Couldn’t switch to main")).toBeVisible();
    await expect(page.getByText(/would be overwritten by checkout/u)).toBeVisible();
    await expect(branch("feature")).toBeVisible();
  });

  await test.step("the machine segment opens the environment menu", async () => {
    await footer.getByRole("button", { name: "This Mac" }).click();
    await expect(page.getByRole("menuitem", { name: "Server Settings…" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menuitem", { name: "Server Settings…" })).toBeHidden();
  });
});
