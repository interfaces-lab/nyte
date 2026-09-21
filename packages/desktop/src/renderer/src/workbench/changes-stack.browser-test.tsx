import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { ChangesStack } from "./changes-stack.tsx";
import type { ChangesStackItem } from "./changes-stack-code-view.ts";
import "../theme/tokens.css";

function patchOf(path: string, prefix: string): string {
  const added = Array.from({ length: 16 }, (_, index) => `+${prefix} ${String(index)}`);
  return [`--- a/${path}`, `+++ b/${path}`, "@@ -1 +1,17 @@", " keep", ...added, ""].join("\n");
}

const ITEMS = [
  {
    kind: "diff",
    path: "src/alpha.ts",
    patch: patchOf("src/alpha.ts", "alpha"),
    added: 16,
    removed: 0,
  },
  {
    kind: "diff",
    path: "src/beta.ts",
    patch: patchOf("src/beta.ts", "beta"),
    added: 16,
    removed: 0,
  },
] satisfies readonly ChangesStackItem[];

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
    await settle();
    const expandedHeight = height();

    header("src/alpha.ts").click();
    await settle();
    check(header("src/alpha.ts").getAttribute("aria-expanded") === "false", "Alpha collapses");
    check(header("src/beta.ts").getAttribute("aria-expanded") === "true", "Beta stays expanded");
    check(height() < expandedHeight, "Collapsing alpha removes its body from the stack");

    header("src/alpha.ts").click();
    await settle();
    check(header("src/alpha.ts").getAttribute("aria-expanded") === "true", "Alpha expands again");
    check(Math.abs(height() - expandedHeight) < 8, "Expanding alpha restores its body");

    return "passed";
  } finally {
    root.unmount();
    container.remove();
  }
}
