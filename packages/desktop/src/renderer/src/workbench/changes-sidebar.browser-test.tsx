import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { ChangesSidebar } from "./changes-sidebar.tsx";
import type { ChangesSidebarFile } from "./changes-sidebar.tsx";
import type { ViewedState } from "./changes-viewed.ts";
import "../theme/tokens.css";

const PATHS = ["src/alpha.ts", "src/beta.ts", "docs/guide.md", "docs/notes.md"] as const;

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function settle(): Promise<void> {
  for (let index = 0; index < 3; index += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

export async function run(): Promise<string> {
  const container = document.createElement("div");
  container.style.cssText = "display:flex;height:400px;width:320px";
  document.body.append(container);
  const root = createRoot(container);
  const viewed = new Map<string, ViewedState>(PATHS.map((path) => [path, "unviewed"]));
  const marks: string[] = [];
  const revealed: string[] = [];
  let activePath = "src/alpha.ts";
  let added = 2;
  const files = (): readonly ChangesSidebarFile[] =>
    PATHS.map((path) => ({
      path,
      status: path.endsWith(".md") ? "added" : "modified",
      added,
      removed: 1,
      viewed: viewed.get(path) ?? "unviewed",
    }));
  const render = (): void =>
    flushSync(() =>
      root.render(
        <ChangesSidebar
          files={files()}
          visible
          activePath={activePath}
          onRevealPath={(path) => {
            revealed.push(path);
          }}
          onAllViewedChange={(paths, next) => {
            marks.push(`all(${paths.join(",")})=${String(next)}`);
            for (const path of paths) viewed.set(path, next ? "viewed" : "unviewed");
          }}
        />,
      ),
    );
  const tree = (): ShadowRoot => {
    const shadow = container.querySelector("file-tree-container")?.shadowRoot;
    if (shadow === undefined || shadow === null) throw new Error("Missing Pierre file tree");
    return shadow;
  };
  const rows = (): readonly string[] =>
    Array.from(tree().querySelectorAll('[role="treeitem"]')).map(
      (row) => row.getAttribute("data-item-path") ?? "",
    );
  const row = (path: string): HTMLElement => {
    const found = Array.from(tree().querySelectorAll('[role="treeitem"]')).find(
      (row) => row.getAttribute("data-item-path") === path,
    );
    if (!(found instanceof HTMLElement)) throw new Error(`Missing tree row ${path}`);
    return found;
  };
  const master = (): HTMLElement => {
    const found = container.querySelector('[role="checkbox"]');
    if (!(found instanceof HTMLElement)) throw new Error("Missing master checkbox");
    return found;
  };
  const search = async (value: string): Promise<void> => {
    const input = container.querySelector('input[aria-label="Filter changed files"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("Missing search field");
    input.focus();
    input.select();
    document.execCommand(value === "" ? "delete" : "insertText", false, value);
    await settle();
  };
  try {
    render();
    await settle();
    check(
      container.textContent?.includes("4 Files Changed") === true,
      "The header reports all files",
    );
    check(revealed.length === 0, "Synchronizing selection does not reveal a file");
    row("src/beta.ts").click();
    check(revealed.at(-1) === "src/beta.ts", "Native selection reveals that file");
    activePath = "docs/guide.md";
    render();
    await settle();
    check(
      row(activePath).getAttribute("aria-selected") === "true",
      "The active diff selects its tree row",
    );
    check(revealed.length === 1, "Scroll-driven selection does not jump back to a diff");
    await search("alpha");
    check(rows().join("|") === "src/|src/alpha.ts", `Filtered rows: ${rows().join("|")}`);
    check(
      container.textContent?.includes("1 of 4 Files Changed") === true,
      "The filter reports its count",
    );
    await search("zzz");
    check(rows().length === 0, `An unmatched query clears the tree: ${rows().join("|")}`);
    check(
      container.textContent?.includes("No files match this filter") === true,
      "Empty search is explained",
    );
    await search("");
    master().click();
    render();
    await settle();
    check(marks.at(-1) === `all(${PATHS.join(",")})=true`, "Bulk review marks the visible files");
    check(master().getAttribute("aria-checked") === "true", "Bulk review state is shown");
    master().click();
    render();
    await settle();
    check(master().getAttribute("aria-checked") === "false", "Bulk review can be cleared");
    const host = container.querySelector("file-tree-container");
    row("src/").click();
    await settle();
    check(row("src/").getAttribute("aria-expanded") === "false", "Native folders collapse");
    added = 9;
    render();
    await settle();
    check(
      container.querySelector("file-tree-container") === host,
      "A status update retains the tree",
    );
    check(
      row("src/").getAttribute("aria-expanded") === "false",
      "A status update retains collapsed folders",
    );
    check(!rows().includes("src/alpha.ts"), "Updating stats does not reopen a folder");
    return "passed";
  } catch (error) {
    return error instanceof Error ? (error.stack ?? error.message) : String(error);
  } finally {
    root.unmount();
    container.remove();
  }
}
