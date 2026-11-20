import "../../../test/window-bridge.ts";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { ChangesStack } from "./changes-stack.tsx";
import type { ChangesStackItem } from "./changes-stack-code-view.ts";
import { patchDigest } from "../../diff/changes-viewed.ts";
import { parsePatchFiles } from "@nyte-ai/ui/diffs";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import "../../theme/tokens.stylex.ts";

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
    files: parsePatchFiles(patch, { cacheKeyPrefix: digest }).flatMap((parsed) => parsed.files),
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

async function until(done: () => boolean, what: string): Promise<void> {
  const deadline = performance.now() + 10_000;

  while (!done()) {
    if (performance.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await frame();
  }
}

function deepText(root: ParentNode): string {
  return [...root.querySelectorAll("*")]
    .map((element) =>
      element.shadowRoot === null
        ? ""
        : `${element.shadowRoot.textContent} ${deepText(element.shadowRoot)}`,
    )
    .join(" ");
}

const RESTORED_SCROLL = 48;

async function mountedScroll(hidden: boolean): Promise<number> {
  const container = document.createElement("div");
  container.style.cssText = `display:${hidden ? "none" : "flex"};height:420px;width:760px`;
  document.body.append(container);
  const root = createRoot(container);

  const render = (visible: boolean): void =>
    flushSync(() =>
      root.render(
        <ChangesStack
          visible={visible}
          items={ITEMS}
          collapsedPaths={[]}
          onToggleCollapsed={() => undefined}
          onExpand={() => undefined}
          scrollTop={RESTORED_SCROLL}
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

  const scrollport = (): HTMLElement => {
    const found = container.querySelector("[data-nyte-scrollport]");

    if (!(found instanceof HTMLElement)) throw new Error("Missing scrollport");

    return found;
  };

  try {
    render(!hidden);
    await frame();
    container.style.display = "flex";
    render(true);
    await until(() => scrollport().scrollTop > 0, "the stack to restore its scroll");

    return scrollport().scrollTop;
  } finally {
    root.unmount();
    container.remove();
  }
}

export async function run(): Promise<string> {
  const shown = await mountedScroll(false);
  const hidden = await mountedScroll(true);
  check(shown > 0, "A stack mounted visible restores its scroll");
  check(
    hidden === shown,
    `A stack mounted hidden restores its scroll once shown: ${String(hidden)}, not ${String(shown)}`,
  );
  const container = document.createElement("div");
  container.style.cssText = "display:flex;height:420px;width:760px";
  document.body.append(container);
  const root = createRoot(container);
  let collapsedPaths: readonly string[] = [];

  const render = (): void =>
    flushSync(() =>
      root.render(
        <ChangesStack
          visible
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
    await frame();
    render();
    await until(
      () => deepText(container).includes("alpha 15") && deepText(container).includes("beta 15"),
      "both diffs",
    );
    const expandedHeight = height();

    header("src/alpha.ts").click();
    await until(
      () =>
        header("src/alpha.ts").getAttribute("aria-expanded") === "false" &&
        height() < expandedHeight,
      "alpha to collapse",
    );
    check(header("src/alpha.ts").getAttribute("aria-expanded") === "false", "Alpha collapses");
    check(header("src/beta.ts").getAttribute("aria-expanded") === "true", "Beta stays expanded");
    check(height() < expandedHeight, "Collapsing alpha removes its body from the stack");

    container.style.width = "520px";
    await frame();
    await frame();
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
    await until(
      () =>
        header("src/alpha.ts").getAttribute("aria-expanded") === "true" &&
        Math.abs(height() - expandedHeight) < 8,
      "alpha to expand again",
    );
    check(header("src/alpha.ts").getAttribute("aria-expanded") === "true", "Alpha expands again");
    check(Math.abs(height() - expandedHeight) < 8, "Expanding alpha restores its body");
    container.style.width = "760px";
    await frame();
    await frame();
    check(
      container.querySelector("[data-nyte-scrollport]")?.getBoundingClientRect().width === 760,
      "The diff follows the restored container width",
    );

    header("src/alpha.ts").click();
    await until(
      () => header("src/alpha.ts").getAttribute("aria-expanded") === "false",
      "alpha to collapse again",
    );
    const scrollport = container.querySelector("[data-nyte-scrollport]");

    if (!(scrollport instanceof HTMLElement)) throw new Error("Missing scrollport");
    scrollport.focus();
    scrollport.dispatchEvent(
      new KeyboardEvent("keydown", { key: "f", code: "KeyF", ctrlKey: true, bubbles: true }),
    );
    await until(
      () => container.querySelector('input[aria-label="Find in changes"]') !== null,
      "Ctrl+F to open find",
    );
    const find = container.querySelector('input[aria-label="Find in changes"]');

    if (!(find instanceof HTMLInputElement)) throw new Error("Ctrl+F in the stack opens find");
    check(document.activeElement === find, "Find takes focus");

    document.execCommand("insertText", false, "alpha 9");

    const count = (): string =>
      container.querySelector('[role="search"] [aria-live]')?.textContent ?? "";

    await until(
      () =>
        count() === "1 of 1" &&
        header("src/alpha.ts").getAttribute("aria-expanded") === "true" &&
        CSS.highlights.get("diffs-search-current")?.size === 1,
      "find to reveal the match inside collapsed alpha",
    );

    check(count() === "1 of 1", `Find counts the match inside collapsed alpha, not ${count()}`);
    check(
      header("src/alpha.ts").getAttribute("aria-expanded") === "true",
      "Revealing the match unfolds alpha",
    );
    check(
      CSS.highlights.get("diffs-search-current")?.size === 1,
      "The current match is highlighted",
    );
    check(
      container
        .querySelector('[data-change-path="src/alpha.ts"]')
        ?.closest("[data-nyte-scrollport]") === scrollport,
      "The header stays in the stack",
    );

    find.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await until(
      () =>
        container.querySelector('[role="search"]') === null &&
        CSS.highlights.get("diffs-search-current")?.size === 0,
      "Escape to close find",
    );
    check(container.querySelector('[role="search"]') === null, "Escape closes find");
    check(CSS.highlights.get("diffs-search-current")?.size === 0, "Closing find clears highlights");

    return "passed";
  } finally {
    root.unmount();
    container.remove();
  }
}

applyDisplayMode("light");
