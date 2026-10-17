import { FIXTURES } from "./baseline.ts";
import { expect, test } from "./fixtures.ts";
import { messages, openChat } from "./ui.ts";

test.use({ chapter: "markdown" });

test("the markdown journey", async ({ desktop }) => {
  const { page } = desktop;

  await test.step("headings, inline marks and links render", async () => {
    await openChat(page, FIXTURES.markdown);
    const log = messages(page);
    await expect(log.getByRole("heading", { name: "Release notes", level: 1 })).toBeVisible();
    await expect(log.getByRole("heading", { level: 2 })).toHaveText(["Lists", "Code", "Table"]);
    const paragraph = log.getByRole("paragraph").filter({ hasText: "A paragraph with" });
    await expect(paragraph.getByRole("strong")).toHaveText("bold");
    await expect(paragraph.getByRole("emphasis")).toHaveText("italic");
    await expect(paragraph.getByRole("deletion")).toHaveText("struck");
    await expect(paragraph.getByRole("code")).toHaveText("inline code");
    await expect(paragraph.getByRole("link", { name: "link" })).toHaveAttribute(
      "href",
      "https://example.test/docs",
    );
  });

  await test.step("nested, ordered and task lists render", async () => {
    const log = messages(page);
    const lists = log.getByRole("list");
    await expect(lists).toHaveCount(3);
    await expect(lists.first().getByRole("listitem")).toContainText([
      "First item",
      "Second item with a nested list",
      "Nested item",
      "A done task",
      "An open task",
    ]);
    await expect(lists.nth(1).getByRole("listitem")).toHaveText(["Nested item"]);
    await expect(lists.last().getByRole("listitem")).toHaveText(["Ordered one", "Ordered two"]);
    const boxes = log.getByRole("checkbox");
    await expect(boxes).toHaveCount(2);
    await expect(boxes.first()).toBeChecked();
    await expect(boxes.last()).not.toBeChecked();
    await expect(boxes.first()).toBeDisabled();
    await expect(boxes.last()).toBeDisabled();
  });

  await test.step("a fenced code block has its source and a copy button", async () => {
    const log = messages(page);
    const figure = log.getByRole("figure");
    await expect(figure.getByRole("code")).toContainText(
      "export function greet(name: string): string",
    );
    await expect(figure.getByRole("button", { name: "Copy ts code block" })).toBeVisible();
  });

  await test.step("tables, blockquotes and rules render", async () => {
    const log = messages(page);
    const table = log.getByRole("table");
    await expect(table.getByRole("columnheader")).toHaveText(["Column", "Value"]);
    await expect(table.getByRole("row", { name: "alpha 1" }).getByRole("cell")).toHaveText([
      "alpha",
      "1",
    ]);
    await expect(table.getByRole("row", { name: "beta 2" })).toBeVisible();
    await expect(log.getByRole("blockquote")).toHaveText("A quoted line.");
    await expect(log.getByRole("separator")).toHaveCount(1);
    await expect(log.getByRole("paragraph").last()).toHaveText("Final paragraph.");
  });
});
