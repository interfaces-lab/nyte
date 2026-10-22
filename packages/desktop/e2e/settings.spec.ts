import { expect, test } from "./fixtures.ts";
import { leaveSettings, mac, openSettings, settingsNav, sidebar } from "./ui.ts";

test.use({ chapter: "settings" });

test("the settings journey", async ({ desktop }) => {
  const { page } = desktop;

  await test.step("the settings list opens on General and the sidebar swaps to it", async () => {
    await sidebar(page).getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("heading", { name: "General", level: 1 })).toBeVisible();
    const names = await settingsNav(page).getByRole("link").allInnerTexts();
    expect(names.filter((name) => name !== "Usage")).toEqual([
      "Settings",
      "Profile",
      "General",
      "Appearance",
      "Agent",
      "Editor",
      "Terminal",
      "Providers",
    ]);
  });

  await test.step("Profile names this Mac", async () => {
    await openSettings(page, "Profile");
    await expect(page.getByRole("region", { name: "This Mac" })).toContainText(/\S/u);
  });

  await test.step("General shows startup, chat and link defaults", async () => {
    await openSettings(page, "General");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(["Startup", "Chat", "Links", "Updates"]);
    await expect(page.getByRole("combobox", { name: "Window restoration" })).toHaveText("New chat");
    await expect(page.getByRole("combobox", { name: "Messages while running" })).toHaveText(
      "Steer",
    );
    await expect(page.getByRole("combobox", { name: "Open links in" })).toHaveText(
      "Built-in browser",
    );
    await expect(page.getByRole("switch", { name: "Ask before opening links" })).toBeChecked();
    await expect(page.getByRole("button", { name: "Clear" })).toBeDisabled();
  });

  await test.step("Appearance exposes theme, density, colors and typography", async () => {
    await openSettings(page, "Appearance");
    await expect(page.getByRole("combobox", { name: "Theme" })).toHaveText("System");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText([
      "Agent conversations",
      "Colors",
      "Typography",
    ]);
    await expect(page.getByRole("slider", { name: "Tool call density" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
    await expect(page.getByRole("slider", { name: "Tint hue" })).toHaveAttribute(
      "aria-valuenow",
      "250",
    );
    await expect(page.getByRole("slider", { name: "Tint intensity" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
    const fontSmoothing = page.getByRole("switch", { name: "Font smoothing" });

    if (mac) await expect(fontSmoothing).toBeChecked();
    else await expect(fontSmoothing).toHaveCount(0);

    await expect(page.getByRole("switch", { name: "Reduce transparency" })).not.toBeChecked();

    const uiFontSize = page.getByRole("textbox", { name: "UI font size" });
    await expect(uiFontSize).toHaveValue("13");
    const group = page.getByRole("group").filter({ has: uiFontSize });
    await group.getByRole("button", { name: "Increase" }).click();
    await expect(uiFontSize).toHaveValue("14");
    await group.getByRole("button", { name: "Decrease" }).click();
    await expect(uiFontSize).toHaveValue("13");
    await expect(page.getByRole("combobox", { name: "UI font family" })).toHaveText("Inter");
    await expect(page.getByRole("combobox", { name: "Code font family" })).toHaveText(
      "System Mono",
    );
  });

  await test.step("Usage charts the seeded spend by model", async (step) => {
    await openSettings(page, "General");
    step.skip(
      !(await settingsNav(page).getByRole("link", { name: "Usage", exact: true }).isVisible()),
      "this build has no Usage page",
    );
    await openSettings(page, "Usage");
    const range = page.getByRole("tablist", { name: "Usage range" });
    await expect(range.getByRole("tab", { name: "30 days" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("region", { name: "Spend" })).toContainText("0% cache hit");
    await expect(page.getByRole("img", { name: "Spend per day" })).toBeVisible();
    const split = page.getByRole("tablist", { name: "Split spend by" });
    await expect(split.getByRole("tab")).toHaveText(["Models", "Folders", "Chats", "Tools"]);
    const models = page.getByRole("table", { name: "Spend by model" });
    await expect(models.getByRole("columnheader")).toHaveText([
      "Model",
      "Cache hit",
      "Trend",
      "Cost",
    ]);
    await expect(models.getByRole("row", { name: /scripted/u })).toBeVisible();
    await split.getByRole("tab", { name: "Chats" }).click();
    await expect(page.getByRole("tabpanel", { name: "Chats" })).toBeVisible();
    await range.getByRole("tab", { name: "All time" }).click();
    await expect(range.getByRole("tab", { name: "All time" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  await test.step("Agent starts new chats on the scripted model", async () => {
    await openSettings(page, "Agent");
    await expect(page.getByRole("heading", { name: "New chats", level: 2 })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Default model" })).toHaveText(
      "Scripted · E2E",
    );
  });

  await test.step("Editor lists file and diff defaults", async () => {
    await openSettings(page, "Editor");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(["Files", "Changes"]);
    await expect(page.getByRole("switch", { name: "Line numbers" })).toBeChecked();
    await expect(page.getByRole("switch", { name: "Git blame" })).not.toBeChecked();
    await expect(page.getByRole("combobox", { name: "Diff layout" })).toHaveText("Unified");
    await expect(page.getByRole("switch", { name: "Word wrap" })).toHaveCount(2);
  });

  await test.step("Terminal keeps its scrollback and cursor settings", async () => {
    await openSettings(page, "Terminal");
    await expect(page.getByRole("textbox", { name: "Scrollback" })).toHaveValue("10,000");
    await expect(page.getByRole("switch", { name: "Blinking cursor" })).toBeVisible();
  });

  await test.step("the settings search narrows the list and Back returns to the chat", async () => {
    await openSettings(page, "General");
    const links = settingsNav(page).getByRole("link");
    const count = await links.count();
    const search = settingsNav(page).getByRole("searchbox", { name: "Search Settings" });
    await search.fill("theme");
    await expect(links.filter({ hasNotText: "Settings" })).toHaveText(["Appearance"]);
    await search.fill("");
    await expect(links).toHaveCount(count);
    await leaveSettings(page);
    await expect(page.getByRole("form", { name: "Message", exact: true })).toBeVisible();
  });
});
