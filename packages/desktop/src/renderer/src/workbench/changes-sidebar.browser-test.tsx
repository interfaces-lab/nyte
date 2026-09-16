/**
 * Drives the changed-files rail in a real renderer: searching, filtering,
 * per-file review marks, and the master checkbox. The rail is presentational,
 * so the fixture holds the review marks the panel would hold and re-renders.
 */
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { ChangesSidebar } from "./changes-sidebar.tsx";
import type { ChangesSidebarFile } from "./changes-sidebar.tsx";
import type { ViewedState } from "./changes-viewed.ts";
import "../theme/tokens.css";

const FONTS = { ui: "12px Helvetica", xs: "11px Helvetica" };

const PATHS = ["src/alpha.ts", "src/beta.ts", "docs/guide.md", "docs/notes.md"] as const;

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** Types into the field the way a reader does, so React sees a real edit. */
function setSearch(input: HTMLInputElement, value: string): void {
  input.focus();
  input.select();
  if (value === "") {
    document.execCommand("delete");
    return;
  }
  document.execCommand("insertText", false, value);
}

export async function run(): Promise<string> {
  const container = document.createElement("div");
  container.style.cssText = "display:flex;height:400px;width:320px";
  document.body.append(container);
  const root = createRoot(container);

  const viewed = new Map<string, ViewedState>(PATHS.map((path) => [path, "unviewed"]));
  const marks: string[] = [];
  const reverts: string[] = [];
  let revertable = true;

  const files = (): readonly ChangesSidebarFile[] =>
    PATHS.map((path) => ({
      path,
      status: path.endsWith(".md") ? "added" : "modified",
      tone: path.endsWith(".md") ? "added" : "modified",
      added: 2,
      removed: 1,
      viewed: viewed.get(path) ?? "unviewed",
    }));

  const render = (): void =>
    flushSync(() =>
      root.render(
        <ChangesSidebar
          files={files()}
          visible
          activePath="src/alpha.ts"
          statsKey="uncommitted"
          fonts={FONTS}
          onRevealPath={() => undefined}
          onRevertPath={
            revertable
              ? (path) => {
                  reverts.push(path);
                }
              : undefined
          }
          onViewedChange={(path, next) => {
            marks.push(`${path}=${String(next)}`);
            viewed.set(path, next ? "viewed" : "unviewed");
          }}
          onAllViewedChange={(paths, next) => {
            marks.push(`all(${paths.join(",")})=${String(next)}`);
            for (const path of paths) viewed.set(path, next ? "viewed" : "unviewed");
          }}
        />,
      ),
    );

  const rows = (): readonly string[] =>
    Array.from(container.querySelectorAll('[role="treeitem"]')).map(
      (row) => row.getAttribute("title") ?? "",
    );
  const heading = (): string =>
    container.querySelector('[role="tree"] > div')?.textContent?.trim() ?? "";
  const master = (): HTMLElement => {
    const found = container.querySelector('[role="tree"] > div [role="checkbox"]');
    if (!(found instanceof HTMLElement)) throw new Error("Missing master checkbox");
    return found;
  };
  const rowCheckbox = (path: string): HTMLElement => {
    const row = Array.from(container.querySelectorAll('[role="treeitem"]')).find(
      (item) => item.getAttribute("title") === path,
    );
    const found = row?.querySelector('[role="checkbox"]');
    if (!(found instanceof HTMLElement)) throw new Error(`Missing checkbox for ${path}`);
    return found;
  };
  const search = (): HTMLInputElement => {
    const found = container.querySelector('input[aria-label="Filter changed files"]');
    if (!(found instanceof HTMLInputElement)) throw new Error("Missing search field");
    return found;
  };
  const revertButton = (path: string): HTMLButtonElement => {
    const found = container.querySelector(`button[aria-label="Revert ${path}"]`);
    if (!(found instanceof HTMLButtonElement)) throw new Error(`Missing revert button for ${path}`);
    return found;
  };

  try {
    render();
    check(heading().startsWith("4 Files Changed"), `Unfiltered heading: ${heading()}`);
    check(
      rows().join("|") === "docs/|docs/guide.md|docs/notes.md|src/|src/alpha.ts|src/beta.ts",
      `Grouped rows: ${rows().join("|")}`,
    );
    check(master().getAttribute("aria-checked") === "false", "Nothing is viewed yet");

    setSearch(search(), "alpha");
    check(
      rows().join("|") === "src/|src/alpha.ts",
      `A query keeps only matching files and their group: ${rows().join("|")}`,
    );
    check(heading().startsWith("1 of 4 Files Changed"), `Filtered heading: ${heading()}`);

    setSearch(search(), "zzz");
    check(rows().length === 0, "A query matching nothing renders no rows");
    check(
      container.textContent?.includes("No files match this filter") === true,
      "An empty result explains itself",
    );
    check(heading().startsWith("0 of 4 Files Changed"), `Empty heading: ${heading()}`);

    setSearch(search(), "");
    rowCheckbox("src/alpha.ts").click();
    render();
    check(
      marks.at(-1) === "src/alpha.ts=true",
      `Marking reports the path: ${String(marks.at(-1))}`,
    );
    check(
      rowCheckbox("src/alpha.ts").getAttribute("aria-checked") === "true",
      "A viewed file reads as checked",
    );
    check(master().getAttribute("aria-checked") === "mixed", "A partial review is indeterminate");

    master().click();
    render();
    check(
      marks.at(-1) === `all(${PATHS.join(",")})=true`,
      `The master marks every shown file: ${String(marks.at(-1))}`,
    );
    check(master().getAttribute("aria-checked") === "true", "Everything is viewed");
    check(
      PATHS.every((path) => rowCheckbox(path).getAttribute("aria-checked") === "true"),
      "Every row follows the master",
    );

    master().click();
    render();
    check(
      marks.at(-1) === `all(${PATHS.join(",")})=false`,
      `The master clears every shown file: ${String(marks.at(-1))}`,
    );
    check(master().getAttribute("aria-checked") === "false", "Nothing is viewed again");

    // A patch that moved on after it was reviewed: the mark is stale, so the row
    // must not claim the file was read.
    viewed.set("src/beta.ts", "changed");
    render();
    const stale = rowCheckbox("src/beta.ts");
    check(stale.getAttribute("aria-checked") === "false", "A stale mark is not a check");
    check(
      stale.getAttribute("data-viewed-state") === "changed",
      "A stale mark reads as changed rather than unviewed",
    );
    stale.click();
    render();
    check(marks.at(-1) === "src/beta.ts=true", "Clicking a stale mark reviews the new patch");
    check(
      rowCheckbox("src/beta.ts").getAttribute("aria-checked") === "true",
      "Reviewing a changed file checks it",
    );

    // A directory row has no file to revert, and a row's revert reports its own path.
    check(
      container.querySelector('button[aria-label="Revert src/"]') === null,
      "Only files carry a revert affordance",
    );
    check(!revertButton("docs/guide.md").disabled, "A revertable rail offers the affordance");
    revertButton("docs/guide.md").click();
    check(
      reverts.join("|") === "docs/guide.md",
      `Reverting reports the row's path: ${reverts.join("|")}`,
    );
    check(marks.at(-1) === "src/beta.ts=true", "Reverting is not a review mark");

    // Without a handler the rail still shows what it cannot do, rather than hiding it.
    revertable = false;
    render();
    check(revertButton("docs/guide.md").disabled, "A scope with nothing to revert to disables it");
    revertButton("docs/guide.md").click();
    check(reverts.length === 1, "A disabled revert reports nothing");

    return "passed";
  } catch (error) {
    return error instanceof Error ? (error.stack ?? error.message) : String(error);
  } finally {
    root.unmount();
    container.remove();
  }
}
