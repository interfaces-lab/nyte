import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FIXTURES } from "./baseline.ts";
import { expect, test } from "./fixtures.ts";
import { chatPane, openChat, primaryKey } from "./ui.ts";
import type { Locator, Page } from "@playwright/test";

test.use({ chapter: "workbench" });

function workbench(page: Page): Locator {
  return page.getByRole("complementary", { name: "Workbench" });
}

function workbenchTabs(page: Page): Locator {
  return page.getByRole("tablist", { name: "Workbench tabs" });
}

async function closeTab(tabs: Locator, tab: Locator): Promise<void> {
  const label = await tab.getAttribute("aria-label");
  const count = await tabs.getByRole("tab").count();
  await tab.hover({ position: { x: 8, y: 8 } });
  await tabs.getByRole("button", { name: `Close ${label} tab` }).click();
  await expect(tabs.getByRole("tab")).toHaveCount(count - 1);
}

async function openWorkbenchTab(page: Page, kind: string): Promise<void> {
  await page.getByRole("button", { name: "New workbench tab" }).click();
  await page
    .getByRole("menu", { name: "New workbench tab" })
    .getByRole("menuitem", { name: kind })
    .click();
}

const NOTES = `---
title: Field notes
tags: [e2e, markdown]
---

# Field notes

The quick brown fox jumps.

- [x] Render the document
- [ ] Edit in place

See [the guide](guide.md).

\`\`\`mermaid
graph LR
  Draft --> Ship
\`\`\`
`;

function samplePdf(lines: readonly string[]): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${lines.map((_, index) => `${4 + index * 2} 0 R`).join(" ")}] /Count ${lines.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...lines.flatMap((line, index) => {
      const content = `BT /F1 48 Tf 72 680 Td (${line}) Tj ET`;

      return [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
        `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      ];
    }),
  ];

  const parts = ["%PDF-1.4\n"];
  const offsets: number[] = [];

  for (const [index, object] of objects.entries()) {
    offsets.push(parts.join("").length);
    parts.push(`${index + 1} 0 obj\n${object}\nendobj\n`);
  }

  const xref = parts.join("").length;
  const entries = offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`);

  parts.push(
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries.join("")}`,
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  );

  return Buffer.from(parts.join(""), "latin1");
}

test("the workbench journey", async ({ desktop }) => {
  const { page } = desktop;
  const notesPath = join(desktop.home, "notes.md");
  await writeFile(notesPath, NOTES);
  await writeFile(join(desktop.home, "guide.md"), "# Guide\n");
  await writeFile(join(desktop.home, "field-guide.pdf"), samplePdf(["First", "Second", "Third"]));

  await test.step("the rail opens into a panel with an empty tab strip", async () => {
    await openChat(page, FIXTURES.beta);
    const rail = workbench(page).getByRole("navigation", { name: "Workbench navigation" });
    await expect(rail.getByRole("button")).toContainText([
      "Editor",
      "Changes",
      "New Browser",
      "New Terminal",
    ]);
    await page.getByRole("button", { name: "Open workbench panel" }).click();
    await expect(page.getByRole("button", { name: "Close workbench panel" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(workbenchTabs(page).getByRole("tab")).toHaveCount(0);
    await expect(
      workbench(page).getByRole("separator", { name: "Resize workbench" }),
    ).toBeVisible();
  });

  await test.step("New workbench tab offers Editor, Changes, Browser and Terminal", async () => {
    await page.getByRole("button", { name: "New workbench tab" }).click();
    await expect(
      page.getByRole("menu", { name: "New workbench tab" }).getByRole("menuitem"),
    ).toHaveText(["Editor", "Changes", "Browser", "Terminal"]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu", { name: "New workbench tab" })).toBeHidden();
  });

  await test.step("Editor opens on the Start page over the home folder", async () => {
    await openWorkbenchTab(page, "Editor");
    await expect(workbenchTabs(page).getByRole("tab", { name: "Editor" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    const editorPanel = workbench(page)
      .getByRole("tabpanel", { name: "Editor" })
      .getByRole("region", { name: "Editor", exact: true });

    await expect(editorPanel.getByRole("navigation", { name: "File path" })).toHaveText("Editor");
    await expect(editorPanel.getByRole("combobox", { name: "Go to file" })).toBeVisible();
    const start = editorPanel.getByRole("region", { name: "Start" });
    await expect(start.getByRole("button", { name: "Show Explorer" })).toBeVisible();
    await expect(
      start.getByRole("button", { name: `Search in Files ${primaryKey} F` }),
    ).toBeVisible();
  });

  await test.step("a markdown file opens as a document, edits in place and saves only the edit", async () => {
    const editorPanel = workbench(page).getByRole("region", { name: "Editor", exact: true });
    await editorPanel.getByRole("button", { name: "Show Explorer" }).click();
    await editorPanel.getByRole("treeitem", { name: /notes\.md/u }).click();
    const editor = editorPanel.getByRole("textbox", { name: "notes.md" });
    await expect(editor.getByRole("heading", { name: "Field notes", level: 1 })).toBeVisible();
    await expect(editorPanel.getByRole("definition")).toHaveText([
      "Field notes",
      "[e2e, markdown]",
    ]);
    await expect(editor.getByRole("checkbox")).toHaveCount(2);
    const diagram = editor.getByRole("figure", { name: "Mermaid diagram" }).locator("svg");
    await expect(diagram).toBeVisible();
    await expect(diagram).toContainText("Ship");

    const paragraph = editor.getByRole("paragraph").filter({ hasText: "The quick brown fox" });
    const box = await paragraph.boundingBox();
    const caretPlaced = page.evaluate(
      () =>
        new Promise<void>((done) => {
          document.addEventListener("selectionchange", () => done(), { once: true });
        }),
    );
    await paragraph.click({ position: { x: (box?.width ?? 8) - 4, y: (box?.height ?? 8) / 2 } });
    await caretPlaced;
    for (let count = 0; count < "jumps.".length; count += 1) await page.keyboard.press("Backspace");
    await page.keyboard.type("leaps.");
    await page.keyboard.press("ControlOrMeta+s");
    await expect(editorPanel.getByText("Saved", { exact: true })).toBeVisible();
    await expect.poll(() => readFile(notesPath, "utf8")).toBe(NOTES.replace("jumps.", "leaps."));

    await editorPanel.getByRole("button", { name: "File options" }).click();
    await page.getByRole("menuitem", { name: "View Source" }).click();
    await expect(editorPanel.getByText("title: Field notes")).toBeVisible();
    await expect(editor.getByRole("heading")).toHaveCount(0);
    await editorPanel.getByRole("button", { name: "File options" }).click();
    await page.getByRole("menuitem", { name: "View Document" }).click();
    await expect(editor.getByRole("heading", { name: "Field notes", level: 1 })).toBeVisible();

    await editor.getByRole("link", { name: "the guide" }).click({ modifiers: ["ControlOrMeta"] });
    await expect(
      editorPanel
        .getByRole("textbox", { name: "guide.md" })
        .getByRole("heading", { name: "Guide" }),
    ).toBeVisible();

    const tabs = workbenchTabs(page);
    await closeTab(tabs, tabs.getByRole("tab", { name: "guide.md" }));
    await closeTab(tabs, tabs.getByRole("tab", { name: "notes.md" }));
  });

  await test.step("a PDF opens with its first page drawn, its page count and a zoom control", async () => {
    const editorPanel = workbench(page).getByRole("region", { name: "Editor", exact: true });
    await editorPanel.getByRole("treeitem", { name: /field-guide\.pdf/u }).click();
    const document = editorPanel.getByRole("region", { name: "field-guide.pdf" });
    await expect(document.getByRole("img")).toHaveCount(3);
    await expect(editorPanel.getByText("Page 1 of 3")).toBeVisible();

    const canvas = document.getByRole("img", { name: "Page 1", exact: true }).locator("canvas");

    await expect
      .poll(() =>
        canvas.evaluate((element) => {
          if (!(element instanceof HTMLCanvasElement)) return false;

          const pixels = element
            .getContext("2d")
            ?.getImageData(0, 0, element.width, element.height);

          return pixels?.data.some((channel) => channel < 128) ?? false;
        }),
      )
      .toBe(true);

    await editorPanel.getByRole("button", { name: "Zoom in" }).click();
    await expect(editorPanel.getByText("125%")).toBeVisible();

    const tabs = workbenchTabs(page);
    await closeTab(tabs, tabs.getByRole("tab", { name: "field-guide.pdf" }));
  });

  await test.step("Changes reports that the home folder is not a repository", async () => {
    await openWorkbenchTab(page, "Changes");

    const changes = workbench(page)
      .getByRole("tabpanel", { name: "Changes" })
      .getByRole("region", { name: "Workspace changes" });

    await expect(changes.getByRole("button", { name: "Uncommitted 0 files" })).toBeVisible();
    await expect(changes.getByRole("status")).toHaveText(
      "Couldn't read changes. Check that this folder is a Git repository.",
    );
    await expect(workbenchTabs(page).getByRole("tab")).toHaveText(["Editor", "Changes"]);
  });

  await test.step("Terminal opens a shell tab with a focused input", async () => {
    await openWorkbenchTab(page, "Terminal");
    const tab = workbenchTabs(page).getByRole("tab", { selected: true });
    await expect(tab).not.toHaveText(/^(Editor|Changes|Browser)$/u);

    const terminal = workbench(page)
      .getByRole("tabpanel")
      .getByRole("region", { name: "Terminal" });

    await expect(terminal.getByRole("textbox", { name: "Terminal input" })).toBeVisible();
    await expect(terminal.getByRole("status")).toHaveCount(0);
    await terminal.getByRole("textbox", { name: "Terminal input" }).focus();
    await page.keyboard.type("exit\r");
    await expect(terminal.getByRole("status")).toHaveText(/Shell exited/u);
  });

  await test.step("Browser opens empty with its navigation disabled", async () => {
    await openWorkbenchTab(page, "Browser");

    const browser = workbench(page)
      .getByRole("tabpanel", { name: "Browser" })
      .getByRole("region", { name: "Browser" });

    await expect(browser.getByRole("button", { name: "Go back" })).toBeDisabled();
    await expect(browser.getByRole("button", { name: "Go forward" })).toBeDisabled();
    await expect(browser.getByRole("button", { name: "Reload page" })).toBeDisabled();
    await expect(browser.getByRole("combobox", { name: "Address" })).toBeVisible();
    await expect(browser.getByText("Type an address or a search")).toBeVisible();
    await expect(workbenchTabs(page).getByRole("tab")).toHaveCount(4);
  });

  await test.step("Expand workbench hides the chat into a tab panel and restores the split", async () => {
    await page.getByRole("button", { name: "Expand workbench" }).click();
    const restore = page.getByRole("button", { name: "Restore split view" });
    await expect(restore).toBeVisible();
    const chatTab = workbenchTabs(page).getByRole("tab", { name: FIXTURES.beta });
    const resize = workbench(page).getByRole("separator", { name: "Resize workbench" });
    await expect(chatTab).toBeVisible();
    await expect(resize).toBeHidden();
    await restore.click();
    await expect(page.getByRole("button", { name: "Expand workbench" })).toBeVisible();
    await expect(chatTab).toHaveCount(0);
    await expect(resize).toBeVisible();
    await expect(chatPane(page)).toBeVisible();
  });

  await test.step("the rail lists each open tab once and only the launchers that add one", async () => {
    await page.getByRole("button", { name: "Close workbench panel" }).click();

    const rows = workbench(page)
      .getByRole("navigation", { name: "Workbench navigation" })
      .getByRole("button");

    for (const label of ["Editor", "Changes", "Browser", "New Browser", "New Terminal"]) {
      await expect(rows.filter({ hasText: new RegExp(`^${label}$`, "u") })).toHaveCount(1);
    }

    await rows.filter({ hasText: /^New Terminal$/u }).click();
    await expect(workbenchTabs(page).getByRole("tab")).toHaveCount(5);

    const terminal = workbench(page)
      .getByRole("tabpanel")
      .getByRole("region", { name: "Terminal" });

    await terminal.getByRole("textbox", { name: "Terminal input" }).focus();
    await page.keyboard.type("exit\r");
    await expect(terminal.getByRole("status")).toHaveText(/Shell exited/u);
  });

  await test.step("closing every tab collapses the panel and brings the rail back", async () => {
    const tabs = workbenchTabs(page);

    for (const name of ["Browser", "Changes", "Editor"]) {
      await closeTab(tabs, tabs.getByRole("tab", { name, exact: true }));
    }

    await tabs.getByRole("tab").first().press("Delete");
    await expect(tabs.getByRole("tab")).toHaveCount(1);
    await tabs.getByRole("tab").first().press("Delete");
    await expect(tabs.getByRole("tab")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open workbench panel" })).toBeVisible();
    await expect(
      workbench(page)
        .getByRole("navigation", { name: "Workbench navigation" })
        .getByRole("button", { name: "Editor" }),
    ).toBeVisible();
  });
});

test("saved v7 workbench tabs reopen as Editor", async ({ desktop }, testInfo) => {
  const page = desktop.page;

  for (const selection of [
    { active: "files", label: "Editor", capture: "editor-selected" },
    { active: "kept-document", label: "migration-notes.md", capture: "document-selected" },
  ]) {
    await test.step(`v7 restores ${selection.capture} as v8 and survives another reload`, async () => {
      const path = join(desktop.home, "migration-notes.md");
      const preview = join(desktop.home, "migration-preview.ts");
      await writeFile(path, "# Preserved document\n");
      await writeFile(preview, "export const preserved = true;\n");

      const documents = [
        { id: "kept-document", kind: "file", path, preview: false },
        { id: "kept-preview", kind: "file", path: preview, preview: true },
      ];

      const view = {
        key: desktop.home,
        tabs: [{ id: "files", kind: "files" }, ...documents],
        active: selection.active,
        expanded: true,
        maximized: false,
        width: 640,
      };

      const before = { version: 7, views: [view] };

      const expected = {
        version: 8,
        views: [{ ...view, tabs: [{ id: "files", kind: "editor" }, ...documents] }],
      };

      await testInfo.attach(`${selection.capture}-v7`, {
        body: JSON.stringify(before, null, 2),
        contentType: "application/json",
      });
      await page.evaluate((value) => {
        localStorage.setItem("nyte:desktop:workbench:v7", JSON.stringify(value));
      }, before);

      for (const reload of [1, 2]) {
        await page.reload();
        await page.locator("[data-nyte-shell]").waitFor({ state: "visible" });
        await openChat(page, FIXTURES.beta);
        const tabs = workbenchTabs(page);
        await expect(tabs.getByRole("tab")).toHaveText([
          "Editor",
          "migration-notes.md",
          "migration-preview.ts",
        ]);
        await expect(tabs.getByRole("tab", { name: selection.label, exact: true })).toHaveAttribute(
          "aria-selected",
          "true",
        );
        await expect(tabs.getByRole("tab", { name: "Editor", exact: true })).toHaveAttribute(
          "id",
          `${desktop.home}-tab-files`,
        );
        await expect(
          tabs.getByRole("tab", { name: "migration-notes.md", exact: true }),
        ).toHaveAttribute("id", `${desktop.home}-tab-kept-document`);
        const editorPanel = workbench(page).getByRole("region", { name: "Editor", exact: true });
        await expect(editorPanel).toBeVisible();

        if (selection.active === "files")
          await expect(editorPanel.getByRole("combobox", { name: "Go to file" })).toBeVisible();
        else
          await expect(
            editorPanel
              .getByRole("textbox", { name: "migration-notes.md" })
              .getByRole("heading", { name: "Preserved document" }),
          ).toBeVisible();

        const written = await page.evaluate(() =>
          localStorage.getItem("nyte:desktop:workbench:v7"),
        );

        expect(written).toBe(JSON.stringify(expected));
        await testInfo.attach(`${selection.capture}-reload-${reload}-v8`, {
          body: written ?? "",
          contentType: "application/json",
        });
        const capture = testInfo.outputPath(`${selection.capture}-reload-${reload}.png`);
        await page.screenshot({ path: capture });
        await testInfo.attach(`${selection.capture}-reload-${reload}`, {
          path: capture,
          contentType: "image/png",
        });
        await testInfo.attach(`${selection.capture}-reload-${reload}-accessibility`, {
          body: await workbench(page).ariaSnapshot(),
          contentType: "text/plain",
        });
      }
    });
  }
});
