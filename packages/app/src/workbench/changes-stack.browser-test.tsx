import "../../test/window-bridge.ts";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { ChangesStack } from "./changes-stack.tsx";
import type { ChangesStackItem } from "./changes-stack-code-view.ts";
import { patchDigest } from "./changes-viewed.ts";
import { parsePatchFiles } from "@pierre/diffs";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import "../theme/tokens.stylex.ts";

function buildPatch(path: string, prefix: string): string {
  const added = Array.from({ length: 16 }, (_, index) => `+${prefix} ${String(index)}`);

  return [`--- a/${path}`, `+++ b/${path}`, "@@ -1 +1,17 @@", " keep", ...added, ""].join("\n");
}

function buildItem(path: string, prefix: string): ChangesStackItem {
  const patch = buildPatch(path, prefix);
  const digest = patchDigest(patch);

  return {
    kind: "diff",
    path,
    patch,
    digest,
    files: parsePatchFiles(patch, digest).flatMap((parsed) => parsed.files),
    stat: { kind: "text", added: 16, removed: 0 },
  };
}

const ITEMS = [buildItem("src/alpha.ts", "alpha"), buildItem("src/beta.ts", "beta")];

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const frame = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });

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
  let collapsedPaths: readonly string[] = [];

  const render = (): void =>
    flushSync(() =>
      root.render(
        <ChangesStack
          items={ITEMS}
          collapsedPaths={collapsedPaths}
          onToggleCollapsed={(path) => {
            collapsedPaths = collapsedPaths.includes(path)
              ? collapsedPaths.filter((entry) => entry !== path)
              : [...collapsedPaths, path];
            render();
          }}
          onExpand={(path) => {
            collapsedPaths = collapsedPaths.filter((entry) => entry !== path);
            render();
          }}
          scrollTop={0}
          focusPath={undefined}
          focusRevision={0}
          layout="unified"
          wordWrap={false}
          viewedState={() => "unviewed"}
          onViewedChange={() => undefined}
          onScrollTop={() => undefined}
          onActivePath={() => undefined}
        />,
      ),
    );

  const header = (path: string): HTMLButtonElement => {
    const found = container.querySelector(`[data-change-path="${path}"] button[aria-expanded]`);

    if (!(found instanceof HTMLButtonElement)) throw new Error(`Missing header for ${path}`);

    return found;
  };

  const height = (): number => {
    const scrollport = container.querySelector("[data-nyte-scrollport]");

    if (!(scrollport instanceof HTMLElement)) throw new Error("Missing scrollport");

    return scrollport.scrollHeight;
  };

  try {
    render();
    await settle();
    render();
    const deadline = performance.now() + 10_000;

    while (container.querySelector('[data-change-path="src/beta.ts"]') === null) {
      if (performance.now() > deadline) throw new Error("Timed out waiting for the headers");
      await settle();
    }

    await settle();
    const expandedHeight = height();

    header("src/alpha.ts").click();
    await settle();
    check(header("src/alpha.ts").getAttribute("aria-expanded") === "false", "Alpha collapses");
    check(header("src/beta.ts").getAttribute("aria-expanded") === "true", "Beta stays expanded");
    check(height() < expandedHeight, "Collapsing alpha removes its body from the stack");

    container.style.width = "520px";
    await settle();
    check(
      header("src/alpha.ts").getAttribute("aria-expanded") === "false",
      "Resize keeps alpha collapsed",
    );
    check(
      header("src/beta.ts").getAttribute("aria-expanded") === "true",
      "Resize keeps beta expanded",
    );
    check(
      container.querySelector("[data-nyte-scrollport]")?.getBoundingClientRect().width === 520,
      "The diff follows its container width",
    );

    header("src/alpha.ts").click();
    await settle();
    check(header("src/alpha.ts").getAttribute("aria-expanded") === "true", "Alpha expands again");
    check(Math.abs(height() - expandedHeight) < 8, "Expanding alpha restores its body");
    container.style.width = "760px";
    await settle();
    check(
      container.querySelector("[data-nyte-scrollport]")?.getBoundingClientRect().width === 760,
      "The diff follows the restored container width",
    );

    header("src/alpha.ts").click();
    await settle();
    const scrollport = container.querySelector("[data-nyte-scrollport]");

    if (!(scrollport instanceof HTMLElement)) throw new Error("Missing scrollport");
    scrollport.focus();
    scrollport.dispatchEvent(
      new KeyboardEvent("keydown", { key: "f", code: "KeyF", ctrlKey: true, bubbles: true }),
    );
    await settle();
    const find = container.querySelector('input[aria-label="Find in changes"]');

    if (!(find instanceof HTMLInputElement)) throw new Error("Ctrl+F in the stack opens find");
    check(document.activeElement === find, "Find takes focus");

    document.execCommand("insertText", false, "alpha 9");
    await settle();
    await settle();

    const count = (): string =>
      container.querySelector('[role="search"] [aria-live]')?.textContent ?? "";

    check(count() === "1 of 1", `Find counts the match inside collapsed alpha, not ${count()}`);
    check(
      header("src/alpha.ts").getAttribute("aria-expanded") === "true",
      "Revealing the match unfolds alpha",
    );
    check(CSS.highlights.get("diffs-search-focus")?.size === 1, "The current match is highlighted");
    check(
      container
        .querySelector('[data-change-path="src/alpha.ts"]')
        ?.closest("[data-nyte-scrollport]") === scrollport,
      "The header stays in the stack",
    );

    find.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await settle();
    check(container.querySelector('[role="search"]') === null, "Escape closes find");
    check(CSS.highlights.get("diffs-search-focus")?.size === 0, "Closing find clears highlights");

    return "passed";
  } finally {
    root.unmount();
    container.remove();
  }
}

applyDisplayMode("light");
