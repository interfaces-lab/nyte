import { expect, test } from "./fixtures.ts";
import { chatPane, messages, openNewChat, send } from "./ui.ts";

test.use({ chapter: "subagents" });

test("background agents share one block, report in one line each, and wake the parent", async ({
  desktop,
}, testInfo) => {
  const { page } = desktop;
  await openNewChat(page);
  await send(page, "/agents");
  const log = messages(page);

  await expect(log.getByText("2 agents completed")).toBeVisible();
  await expect(log.getByRole("paragraph").last()).toHaveText("An agent reported back.");
  await expect(log.getByText("Finished", { exact: true })).toHaveCount(2);
  await expect(log.getByText(/Child \S+ completed/u)).toHaveCount(0);
  await expect(log.getByText(/Echo: Trace part/u)).toHaveCount(0);
  await expect(log.getByRole("button", { name: "Edit Message" })).toHaveCount(1);
  await expect(chatPane(page).getByText(/queued/u)).toHaveCount(0);

  await page.screenshot({ path: testInfo.outputPath("agents.png") });
  await testInfo.attach("agents-accessibility", {
    body: await page.locator("body").ariaSnapshot(),
    contentType: "text/plain",
  });

  const tabs = page.getByRole("tablist", { name: "Tabs" }).getByRole("tab");
  const child = log.getByRole("button", { name: /^Map the core/u }).first();
  await expect(tabs).toHaveCount(1);
  await child.click();
  await expect(tabs, "the child opens next to its parent, not in its place").toHaveCount(2);
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "false");
  await expect(tabs.nth(1)).toHaveAccessibleName("Map the core, preview");
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(messages(page).getByText("Echo: Trace part 1.")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("agents-child.png") });

  await tabs.nth(0).click();
  await expect(log.getByText("2 agents completed")).toBeVisible();
  await child.click();
  await expect(tabs, "an open child is shown in its tab").toHaveCount(2);
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
});
