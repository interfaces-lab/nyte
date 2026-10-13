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

test("the seeded chats are listed", async ({ desktop }) => {
  for (const name of Object.values(FIXTURES))
    await expect(chatRow(desktop.page, name)).toBeVisible();
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

test("a new chat is created by its first message and answered", async ({ desktop }) => {
  const { page } = desktop;
  await openNewChat(page);
  await send(page, "Hello desktop");
  await expect(messages(page).getByRole("paragraph")).toHaveText([
    "Hello desktop",
    "Echo: Hello desktop",
  ]);
  await expect(chatTab(page, "New chat")).toHaveAttribute("aria-selected", "true");
  await expect(chatRow(page, "New chat")).toBeVisible();
  await expect(sidebar(page).getByRole("button", { name: /^Draft /u })).toHaveCount(0);
});

test("a follow-up appends to the open chat", async ({ desktop }) => {
  test.fixme(true, "A second send in a live chat is never admitted; the host logs no admission.");
  const { page } = desktop;
  await send(page, "And again");
  await expect(messages(page).getByRole("paragraph")).toHaveText([
    "Hello desktop",
    "Echo: Hello desktop",
    "And again",
    "Echo: And again",
  ]);
});

test("a held response can be stopped", async ({ desktop }) => {
  test.fixme(
    true,
    "The renderer posts /run.stop but the host never answers it; Stop stays visible.",
  );
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
