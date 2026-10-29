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

  await expect(log.getByText("2 agents done")).toBeVisible();
  await expect(log.getByRole("paragraph").last()).toHaveText("An agent reported back.");
  await expect(
    log.getByText("Done", { exact: true }),
    "each agent's card and its report say Done",
  ).toHaveCount(4);
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
  const back = chatPane(page).getByRole("button", { name: "Back to parent chat" });
  await expect(tabs).toHaveCount(1);
  await expect(back, "a root chat has no parent link").toHaveCount(0);
  await child.click();
  await expect(tabs, "the child opens next to its parent, not in its place").toHaveCount(2);
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "false");
  await expect(tabs.nth(1)).toHaveAccessibleName("Map the core, preview");
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(messages(page).getByText("Echo: Trace part 1.")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("agents-child.png") });

  await back.click();
  await expect(tabs, "the parent link returns to the parent's tab").toHaveCount(2);
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
  await expect(log.getByText("2 agents done")).toBeVisible();
  await child.click();
  await expect(tabs, "an open child is shown in its tab").toHaveCount(2);
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await tabs.nth(0).click();
  await expect(log.getByText("2 agents done")).toBeVisible();
});

test("the agents tray previews a finished agent, opens it as a full chat, and clears finished ones", async ({
  desktop,
}) => {
  const { page } = desktop;
  const pane = chatPane(page);
  const tabs = page.getByRole("tablist", { name: "Tabs" }).getByRole("tab");
  const pill = pane.getByRole("button", { name: "Agents", exact: true });

  await expect(pill, "finished agents stay listed until cleared").toHaveAccessibleDescription(
    "Agents, 0 active, 2 done",
  );
  await pill.click();
  await pane.getByRole("button", { name: "Open Map the app", exact: true }).click();
  const expand = pane.getByRole("button", { name: "Open as full chat" });
  await expect(expand, "a tray row opens the tray's preview").toBeVisible();
  await expect(tabs).toHaveCount(2);
  await expect(pane.getByText("Echo: Trace part 2.")).toBeVisible();

  await expand.click();
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(1)).toHaveAccessibleName("Map the app, preview");
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");

  await tabs.nth(0).click();
  await pill.click();
  await pane.getByRole("button", { name: "Clear Finished" }).click();
  await expect(pill).toHaveCount(0);
});
