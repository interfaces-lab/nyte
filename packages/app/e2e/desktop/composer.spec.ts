import { FIXTURES } from "./baseline.ts";
import { expect, test } from "./fixtures.ts";
import { chatPane, clearComposer, composer, openChat, openNewChat } from "./ui.ts";

test.use({ chapter: "composer" });

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
    await expect(skills.getByRole("option")).toHaveCount(1);
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
});
