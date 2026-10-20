import { FIXTURES, LONG_TURNS } from "./baseline.ts";
import { expect, test } from "./fixtures.ts";
import { composer, messages, openChat } from "./ui.ts";

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
