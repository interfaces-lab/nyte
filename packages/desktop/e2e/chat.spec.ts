import { FIXTURES } from "./baseline.ts";
import { expect, test } from "./fixtures.ts";
import {
  chatPane,
  chatRow,
  chatTab,
  composer,
  messages,
  openChat,
  openNewChat,
  send,
  sidebar,
} from "./ui.ts";

test.use({ chapter: "chat" });

test("the five newest seeded chats are listed and Show 2 More reveals the rest", async ({
  desktop,
}) => {
  const { page } = desktop;
  const oldest: readonly string[] = [FIXTURES.alpha, FIXTURES.beta];
  const newest = Object.values(FIXTURES).filter((name) => !oldest.includes(name));

  for (const name of newest) await expect(chatRow(page, name)).toBeVisible();

  for (const name of oldest) await expect(chatRow(page, name)).toBeHidden();

  await sidebar(page).getByRole("button", { name: "Show 2 More", exact: true }).click();

  for (const name of oldest) await expect(chatRow(page, name)).toBeVisible();

  await expect(sidebar(page).getByRole("button", { name: /^Show \d+ More$/u })).toHaveCount(0);
});

test("a seeded chat shows both of its turns", async ({ desktop }) => {
  const { page } = desktop;
  await openChat(page, FIXTURES.beta);
  const log = messages(page);
  await expect(log.getByRole("paragraph")).toHaveText([
    "Hello from beta",
    "Echo: Hello from beta",
    "Second beta turn",
    "Echo: Second beta turn",
  ]);
  await expect(log.getByRole("button", { name: "Edit Message" })).toHaveCount(2);
  await expect(composer(page)).toHaveAttribute("data-placeholder", "Add a follow-up");
});

test("a new chat is created by its first message, answered and named", async ({ desktop }) => {
  const { page } = desktop;
  await openNewChat(page);
  await send(page, "Hello desktop");
  await expect(messages(page).getByRole("paragraph")).toHaveText([
    "Hello desktop",
    "Echo: Hello desktop",
  ]);
  await expect(chatTab(page, "Hello desktop")).toHaveAttribute("aria-selected", "true");
  await expect(chatRow(page, "Hello desktop")).toBeVisible();
  await expect(sidebar(page).getByRole("button", { name: /^Draft /u })).toHaveCount(0);
});

test("a follow-up appends to the open chat", async ({ desktop }) => {
  const { page } = desktop;
  await send(page, "And again");
  await expect(messages(page).getByRole("paragraph")).toHaveText([
    "Hello desktop",
    "Echo: Hello desktop",
    "And again",
    "Echo: And again",
  ]);
});

test("a held response can be stopped", async ({ desktop }, testInfo) => {
  const { page } = desktop;
  await openNewChat(page);
  await send(page, "/hold");
  const stop = chatPane(page).getByRole("button", { name: "Stop response" });
  await expect(stop).toBeVisible();
  await expect(messages(page).getByRole("paragraph").last()).toContainText("Holding");
  await expect(
    page.getByRole("tab", { selected: true }).getByRole("img", { name: "Running" }),
  ).toBeVisible();
  await stop.click();
  await expect(stop).toBeHidden();
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
  await send(page, "After stopping");
  await expect(messages(page).getByRole("paragraph").last()).toHaveText("Echo: After stopping");
  await testInfo.attach("chat-after-stop", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await testInfo.attach("chat-after-stop-accessibility", {
    body: await page.locator("body").ariaSnapshot(),
    contentType: "text/plain",
  });
});

test("a steer sent during a response shows in the transcript, never in the queue", async ({
  desktop,
}, testInfo) => {
  const { page } = desktop;
  await openNewChat(page);
  await send(page, "/hold");
  await expect(messages(page).getByRole("paragraph").last()).toContainText("Holding");
  await page.evaluate(() => {
    const tray = 'section[aria-label="Queued messages"]';

    new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.addedNodes) {
          const queued =
            (record.target instanceof Element && record.target.closest(tray) !== null) ||
            (node instanceof Element && (node.matches(tray) || node.querySelector(tray) !== null));

          if (queued && node.textContent?.includes("Steer in") === true)
            document.body.dataset.queuedSteer = "seen";
        }
    }).observe(document.body, { childList: true, subtree: true });
  });

  const field = composer(page);
  await field.fill("Steer in");
  await field.press("Enter");
  await expect(messages(page).getByRole("paragraph").filter({ hasText: "Steer in" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Queued messages" })).toHaveCount(0);
  await expect(page.locator("body")).not.toHaveAttribute("data-queued-steer", "seen");
  await testInfo.attach("steer-pending", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await chatPane(page).getByRole("button", { name: "Stop response" }).click();
  await expect(messages(page).getByRole("paragraph").last()).toHaveText("Echo: Steer in");
});

test("a refused turn shows the provider's error", async ({ desktop }) => {
  const { page } = desktop;
  await openNewChat(page);
  await send(page, "/error");
  await expect(chatPane(page).getByRole("alert")).toContainText(
    "The provider refused this request.",
  );
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();
});

test("a thinking reply folds its thought behind a toggle", async ({ desktop }) => {
  const { page } = desktop;
  await openChat(page, FIXTURES.thinking);
  const log = messages(page);
  await expect(log.getByText("Thought about it: the answer is 42.")).toBeVisible();
  const thought = log.getByRole("button", { name: "Thought" });
  await expect(log.getByText("Weighing the options before answering.")).toBeHidden();
  await thought.click();
  await expect(log.getByText("Weighing the options before answering.")).toBeVisible();
  await thought.click();
  await expect(log.getByText("Weighing the options before answering.")).toBeHidden();
});
