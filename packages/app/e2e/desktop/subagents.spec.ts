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

  await log
    .getByRole("button", { name: /^Map the core/u })
    .first()
    .click();
  const expand = chatPane(page).getByRole("button", { name: "Open as full chat" });
  await expect(expand).toBeVisible();
  await expect(chatPane(page).getByText("Echo: Trace part 1.")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("agents-tray.png") });
  await chatPane(page).getByRole("button", { name: "Close agents" }).click();
  await expect(expand).toBeHidden();
});
