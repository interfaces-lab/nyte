import type { Locator, Page } from "@playwright/test";
import { FIXTURES, LONG_TURNS, READ_TURNS, UNREAD_TURNS } from "./baseline.ts";
import { expect, test } from "./fixtures.ts";
import { chatPane, chatRow, composer, messages, openChat, send } from "./ui.ts";

test.use({ chapter: "transcript" });

const FIRST = "/long 3 turn 1";

const LAST = `/long 3 turn ${String(LONG_TURNS)}`;

test("the transcript journey", async ({ desktop }) => {
  const { page } = desktop;

  await test.step("a long chat opens scrolled to its latest turn", async () => {
    await openChat(page, FIXTURES.long);
    const log = messages(page);
    await expect(log.getByText(LAST, { exact: true })).toBeInViewport();
    await expect(log.getByText("Paragraph 3 of 3.", { exact: false }).last()).toBeInViewport();
    await expect(composer(page)).toHaveAttribute("data-placeholder", "Add a follow-up");
  });

  await test.step("only a window of turns is rendered", async () => {
    const log = messages(page);
    const rendered = await log.getByRole("button", { name: "Edit Message" }).count();
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(LONG_TURNS);
    await expect(log.getByText(FIRST, { exact: true })).toHaveCount(0);
  });

  await test.step("scrolling to the top reaches the first turn", async () => {
    const log = messages(page);
    const first = log.getByText(FIRST, { exact: true });
    await expect(async () => {
      await log.hover();
      await page.mouse.wheel(0, -20_000);
      await expect(first).toBeVisible({ timeout: 500 });
    }).toPass();
    await expect(first).toBeInViewport();
    await expect(log.getByText(LAST, { exact: true })).toHaveCount(0);
  });

  await test.step("scrolling back down reaches the latest turn again", async () => {
    const log = messages(page);
    const last = log.getByText(LAST, { exact: true });
    await expect(async () => {
      await log.hover();
      await page.mouse.wheel(0, 20_000);
      await expect(last).toBeVisible({ timeout: 500 });
    }).toPass();
    await expect(last).toBeInViewport();
  });

  await test.step("every other chat keeps its full short transcript", async () => {
    await openChat(page, FIXTURES.alpha);
    await expect(messages(page).getByRole("paragraph")).toHaveText([
      "Hello from alpha",
      "Echo: Hello from alpha",
    ]);
  });
});

const FIRST_UNREAD = `/long 6 reply ${String(READ_TURNS + 1)}`;

const LATEST_UNREAD = `/long 6 reply ${String(UNREAD_TURNS)}`;

function divider(page: Page): Locator {
  return messages(page).getByText("New messages below", { exact: true });
}

/** The top of the divider's row against the top of the transcript, which the up pill places at a third of its height. */
async function dividerOffset(page: Page): Promise<number> {
  const row = messages(page).locator("[data-row-key^='unread-divider:']");

  const [box, region, height] = await Promise.all([
    row.boundingBox(),
    messages(page).boundingBox(),
    messages(page).evaluate((element) => element.clientHeight),
  ]);

  return (box?.y ?? 0) - (region?.y ?? 0) - height / 3;
}

/** Sends `/hold`, queues another `/hold` behind it, leaves the end, and stops the first, so a new reply streams in below the reader. */
async function replyBelow(page: Page): Promise<void> {
  const log = messages(page);
  const field = composer(page);
  await send(page, "/hold");
  await expect(log.getByRole("paragraph").last()).toContainText("Holding");
  await field.fill("/hold");
  await field.press("ControlOrMeta+Enter");
  await expect(page.getByRole("region", { name: "Queued messages" })).toBeVisible();
  await log.hover();
  await page.mouse.wheel(0, -400);
  await expect(page.getByRole("button", { name: "Scroll to bottom" })).toBeVisible();
  await chatPane(page).getByRole("button", { name: "Stop response" }).click();
  await expect(page.getByRole("region", { name: "Queued messages" })).toHaveCount(0);
}

async function scrollUpTo(page: Page, target: Locator): Promise<void> {
  const log = messages(page);
  await expect(async () => {
    await log.hover();
    await page.mouse.wheel(0, -300);
    await expect(target).toBeInViewport({ timeout: 300 });
  }).toPass();
}

test("the unread journey", async ({ desktop }) => {
  const { page, application } = desktop;
  const log = messages(page);
  const stop = chatPane(page).getByRole("button", { name: "Stop response" });
  const pills = page.getByRole("button", { name: /New Messages?$/u });

  await test.step("a chat with unread replies opens at the end and points up to them", async () => {
    await openChat(page, FIXTURES.unread);
    await expect(log.getByText(LATEST_UNREAD, { exact: true })).toBeInViewport();
    await expect(pills).toHaveText(["3 New Messages"]);
  });

  await test.step("the up pill puts the divider a third of the way down and goes", async () => {
    await pills.click();
    await expect(pills).toHaveCount(0);
    await expect(divider(page)).toBeInViewport();
    await expect.poll(() => dividerOffset(page).then(Math.abs)).toBeLessThanOrEqual(2);
    const prompt = await log.getByText(FIRST_UNREAD, { exact: true }).boundingBox();
    const line = await divider(page).boundingBox();
    expect(prompt?.y ?? Infinity).toBeLessThan(line?.y ?? 0);
  });

  await test.step("scroll to bottom returns to the end and focuses the composer", async () => {
    await page.getByRole("button", { name: "Scroll to bottom" }).click();
    await expect(composer(page)).toBeFocused();
    await expect(log.getByText(LATEST_UNREAD, { exact: true })).toBeInViewport();
  });

  await test.step("a reply arriving below the reader counts once, and its pill returns to the end", async () => {
    await replyBelow(page);
    await expect(pills).toHaveText(["1 New Message"]);
    await expect(log.getByRole("paragraph").last()).toContainText("Holding");
    await expect(pills).toHaveText(["1 New Message"]);
    await pills.click();
    await expect(pills).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Scroll to bottom" })).toBeHidden();
    await stop.click();
    await scrollUpTo(page, divider(page));
  });

  await test.step("dismissing the down pill leaves the view where it is", async () => {
    await page.getByRole("button", { name: "Scroll to bottom" }).click();
    await replyBelow(page);
    await expect(pills).toHaveText(["1 New Message"]);
    const offset = await log.evaluate((element) => element.scrollTop);
    await page.getByRole("button", { name: "Dismiss new messages" }).click();
    await expect(pills).toHaveCount(0);
    expect(
      Math.abs((await log.evaluate((element) => element.scrollTop)) - offset),
    ).toBeLessThanOrEqual(1);
    await expect(page.getByRole("button", { name: "Scroll to bottom" })).toBeVisible();
    await stop.click();
  });

  await test.step("leaving the chat and coming back clears the divider", async () => {
    await openChat(page, FIXTURES.alpha);
    await openChat(page, FIXTURES.unread);
    await scrollUpTo(page, log.getByText(FIRST_UNREAD, { exact: true }));
    await expect(divider(page)).toHaveCount(0);
    await expect(pills).toHaveCount(0);
  });

  await test.step("replies that arrive while the window is away get a divider", async () => {
    const field = composer(page);
    await page.getByRole("button", { name: "Scroll to bottom" }).click();
    await send(page, "/hold");
    await expect(log.getByRole("paragraph").last()).toContainText("Holding");
    await field.fill("Arrived while away");
    await field.press("ControlOrMeta+Enter");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: false });
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.blur());
    await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(false);
    await stop.dispatchEvent("click");
    await expect(log.getByRole("paragraph").last()).toHaveText("Echo: Arrived while away");
    await expect(divider(page)).toBeInViewport();
    await expect(chatRow(page, FIXTURES.unread)).toHaveAccessibleName(
      new RegExp(`^Unread ${FIXTURES.unread} `, "u"),
    );
    await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(chatRow(page, FIXTURES.unread)).toHaveAccessibleName(
      new RegExp(`^${FIXTURES.unread} `, "u"),
    );
    await expect(divider(page)).toBeInViewport();
  });
});
