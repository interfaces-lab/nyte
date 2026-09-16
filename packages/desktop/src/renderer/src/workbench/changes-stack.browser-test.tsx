/**
 * Drives the stacked diff in a real renderer: per-file collapse, the panel's
 * collapse-all and expand-all over files the window has never rendered, and the
 * jump-to-file scroll. Collapse state is the panel's, so the fixture holds it
 * the way the panel does and re-renders.
 */
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { parseUnifiedPatch } from "../conversation/tool-detail.ts";
import { ChangesStack, changesStackItem } from "./changes-stack.tsx";
import { STACKED_HEADER_HEIGHT } from "./stacked-diff.ts";
import "../theme/tokens.css";

const PATHS = Array.from({ length: 12 }, (_, index) => `src/file-${String(index)}.ts`);

function patchOf(path: string, lines: number): string {
  const added = Array.from({ length: lines }, (_, index) => `+line ${String(index)}`);
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1 +1,${String(lines + 1)} @@`,
    " keep",
    ...added,
    "",
  ].join("\n");
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const frame = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });

/** Lets the resize observers report and their re-render land. */
async function settle(): Promise<void> {
  for (let pass = 0; pass < 4; pass += 1) await frame();
  await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
  await frame();
}

export async function run(): Promise<string> {
  const container = document.createElement("div");
  container.style.cssText = "display:flex;height:420px;width:760px";
  document.body.append(container);
  const root = createRoot(container);

  const items = PATHS.map((path, index) => {
    const patch = patchOf(path, 6 + index * 2);
    return changesStackItem(
      { kind: "diff", path, patch },
      { added: 6 + index * 2, removed: 0 },
      parseUnifiedPatch(patch),
    );
  });

  let collapsedPaths: readonly string[] = [];
  let scrollTop = 0;
  let focusPath: string | undefined = undefined;
  let focusRevision = 0;
  const toggled: string[] = [];
  const activePaths: string[] = [];

  const render = (): void =>
    flushSync(() =>
      root.render(
        <ChangesStack
          items={items}
          collapsedPaths={collapsedPaths}
          onToggleCollapsed={(path) => {
            toggled.push(path);
            collapsedPaths = collapsedPaths.includes(path)
              ? collapsedPaths.filter((entry) => entry !== path)
              : [...collapsedPaths, path];
            render();
          }}
          scrollTop={scrollTop}
          focusPath={focusPath}
          focusRevision={focusRevision}
          layout="unified"
          wordWrap={false}
          viewedState={() => "unviewed"}
          onViewedChange={() => undefined}
          onScrollTop={(top) => {
            scrollTop = top;
          }}
          onActivePath={(path) => {
            activePaths.push(path);
          }}
        />,
      ),
    );

  const scrollport = (): HTMLElement => {
    const found = container.querySelector("[data-nyte-scrollport]");
    if (!(found instanceof HTMLElement)) throw new Error("Missing scrollport");
    return found;
  };
  const headerOf = (path: string): HTMLButtonElement => {
    const found = container.querySelector(`[data-change-path="${path}"] button[aria-expanded]`);
    if (!(found instanceof HTMLButtonElement)) throw new Error(`Missing header for ${path}`);
    return found;
  };
  const renderedPaths = (): readonly string[] =>
    Array.from(container.querySelectorAll("[data-change-path]")).map(
      (section) => section.getAttribute("data-change-path") ?? "",
    );
  const expandedPaths = (): readonly string[] =>
    Array.from(container.querySelectorAll('[data-change-path] button[aria-expanded="true"]')).map(
      (header) => header.closest("[data-change-path]")?.getAttribute("data-change-path") ?? "",
    );
  const contentHeight = (): number => scrollport().scrollHeight;
  const scrollTo = async (top: number): Promise<void> => {
    scrollport().scrollTop = top;
    scrollport().dispatchEvent(new Event("scroll"));
    await settle();
    render();
    await settle();
  };

  try {
    render();
    await settle();
    render();
    await settle();

    check(renderedPaths().length > 0, "The stack renders sections");
    check(
      renderedPaths().length < PATHS.length,
      `The stack windows its sections: ${String(renderedPaths().length)} of ${String(PATHS.length)}`,
    );
    check(
      expandedPaths().length === renderedPaths().length,
      "Every rendered section starts expanded",
    );
    const expandedHeight = contentHeight();

    // One header collapses its own file and nothing else.
    headerOf(PATHS[0] ?? "").click();
    await settle();
    check(toggled.join("|") === PATHS[0], `The header reports its path: ${toggled.join("|")}`);
    check(!expandedPaths().includes(PATHS[0] ?? ""), "The clicked file collapses");
    check(expandedPaths().length === renderedPaths().length - 1, "Its neighbours stay expanded");
    check(
      contentHeight() < expandedHeight,
      "A collapsed file gives its height back to the scroll range",
    );

    headerOf(PATHS[0] ?? "").click();
    await settle();
    check(expandedPaths().includes(PATHS[0] ?? ""), "Clicking again expands the file");

    // Collapse all: the panel sets the whole order at once, with no repeated
    // passes over the sections the window happens to hold.
    collapsedPaths = PATHS;
    render();
    await settle();
    check(expandedPaths().length === 0, "Collapse all leaves no expanded section on screen");
    check(
      renderedPaths().length === PATHS.length,
      `Every collapsed file fits the window: ${String(renderedPaths().length)}`,
    );
    const collapsedHeight = contentHeight();
    check(
      collapsedHeight < expandedHeight,
      `Collapsed content is shorter: ${String(collapsedHeight)} vs ${String(expandedHeight)}`,
    );
    check(
      Array.from(container.querySelectorAll("[data-change-path]")).every(
        (section) => section.getBoundingClientRect().height <= STACKED_HEADER_HEIGHT + 4,
      ),
      "A collapsed section is only its header",
    );

    // The file the window never reached while expanded is collapsed too.
    await scrollTo(collapsedHeight);
    const last = PATHS.at(-1) ?? "";
    check(
      renderedPaths().includes(last),
      "The last file is reachable while everything is collapsed",
    );
    check(headerOf(last).getAttribute("aria-expanded") === "false", "The last file is collapsed");

    // Expand all restores every body and the scroll range it needs.
    await scrollTo(0);
    collapsedPaths = [];
    render();
    await settle();
    check(
      expandedPaths().length === renderedPaths().length,
      "Expand all restores every section on screen",
    );
    check(
      Math.abs(contentHeight() - expandedHeight) < 8,
      `Expanding restores the scroll range: ${String(contentHeight())} vs ${String(expandedHeight)}`,
    );

    // Jump-to-file still lands on the section it names.
    focusPath = PATHS[5];
    focusRevision = 1;
    render();
    await settle();
    render();
    await settle();
    const target = container
      .querySelector(`[data-change-path="${PATHS[5] ?? ""}"]`)
      ?.getBoundingClientRect();
    const port = scrollport().getBoundingClientRect();
    check(target !== undefined, "The focused file is rendered");
    check(
      Math.abs((target?.top ?? 0) - port.top) < 4,
      `Jumping scrolls the file to the top: ${String((target?.top ?? 0) - port.top)}`,
    );
    check(scrollTop > 0, "The jump is reported back to the panel");

    // Scrolling reports which file is on screen.
    await scrollTo(0);
    check(activePaths.length > 0, "Scrolling reports an active file");

    return "passed";
  } finally {
    root.unmount();
    container.remove();
  }
}
