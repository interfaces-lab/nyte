import { FIXTURES } from "./baseline.ts";
import { expect, test } from "./fixtures.ts";
import { chatPane, clearComposer, composer, openChat, openNewChat } from "./ui.ts";

test.use({ chapter: "composer" });

test("a new chat invites a first message and cannot send nothing", async ({ desktop }) => {
  const { page } = desktop;
  await openNewChat(page);
  await expect(composer(page)).toHaveAttribute(
    "data-placeholder",
    "Ask Nyte, or type / for skills and @ for context",
  );
  await expect(composer(page)).toBeFocused();
  await expect(page.getByRole("button", { name: "Send message" })).toBeDisabled();
  await expect(chatPane(page).getByRole("button", { name: "Scripted" })).toBeVisible();
  await expect(chatPane(page).getByRole("button", { name: "Add to message" })).toBeVisible();
});

test("typing enables Send and clearing disables it again", async ({ desktop }) => {
  const { page } = desktop;
  const field = composer(page);
  const sendButton = page.getByRole("button", { name: "Send message" });
  await field.fill("Not yet sent");
  await expect(sendButton).toBeEnabled();
  await clearComposer(page);
  await expect(sendButton).toBeDisabled();
  await expect(field).toHaveAttribute("data-placeholder", /^Ask Nyte/u);
});

test("Shift+Enter breaks the line instead of sending", async ({ desktop }) => {
  const { page } = desktop;
  const field = composer(page);
  await field.fill("First line");
  await field.press("End");
  await field.press("Shift+Enter");
  await page.keyboard.type("Second line");
  await expect(field.locator("br")).toHaveCount(1);
  await expect(field).toHaveText("First lineSecond line");
  await expect(chatPane(page).getByRole("log")).toHaveCount(0);
  await clearComposer(page);
});

test("a draft survives switching chats and coming back", async ({ desktop }) => {
  const { page } = desktop;
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

test("a slash opens the skills list and Escape closes it", async ({ desktop }) => {
  const { page } = desktop;
  const field = composer(page);
  await field.pressSequentially("/");
  await expect(field).toHaveAttribute("aria-expanded", "true");
  const skills = page.getByRole("listbox", { name: "Commands and skills" });
  await expect(skills.getByRole("option")).toHaveCount(1);
  await expect(
    skills.getByRole("option", { name: "compact Summarize the conversation to free up context" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(skills).toBeHidden();
  await expect(field).toHaveText("/");
  await clearComposer(page);
});

test("Add to message opens the attachment picker", async ({ desktop }) => {
  const { page } = desktop;
  await chatPane(page).getByRole("button", { name: "Add to message" }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
});

test("the model button names the scripted catalog", async ({ desktop }) => {
  const { page } = desktop;
  await chatPane(page).getByRole("button", { name: "Scripted" }).click();
  const picker = page.getByRole("dialog").or(page.getByRole("menu")).or(page.getByRole("listbox"));
  await expect(picker.first()).toBeVisible();
  await expect(picker.first()).toContainText("Scripted");
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
});
